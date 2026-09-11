/**
 * Coins: Filecoin Pay deposits into an app's payer account, read from
 * DepositRecorded events and written with approve + deposit from a
 * browser wallet. The corgi (apps/corgi/chain.js) folds the same events
 * as feeding; here a deposit is a coin in a machine. Reading needs no
 * key; inserting a coin needs the visitor's wallet and nothing else (no
 * session key, no data set).
 *
 * Reads are chunked under the RPC's eth_getLogs cap and checkpointed in
 * storage so a reload scans only new blocks; a chunk that fails throws,
 * so a partial scan is never cached as the whole history.
 */
import {
  approve, balance, calibration, createPublicClient, createWalletClient, custom, deposit, http, parseAbiItem, parseEventLogs,
} from './foc-deps.js'

export const DEPOSIT_EVENT = parseAbiItem(
  'event DepositRecorded(address indexed token, address indexed from, address indexed to, uint256 amount)',
)
const LOG_CHUNK = 2000 // Glif calibration caps eth_getLogs at 2880 blocks
const MIN_CHUNK = 250
const REORG_MARGIN = 120

function storageFor(storage) {
  if (storage != null) return storage
  if (typeof localStorage === 'undefined') return { getItem: () => null, setItem: () => {} }
  return localStorage
}

async function getLogsChunked(client, args, from, to) {
  const out = []
  let span = LOG_CHUNK
  let cursor = from
  while (cursor <= to) {
    const end = Math.min(cursor + span - 1, to)
    try {
      out.push(...await client.getLogs({ ...args, fromBlock: BigInt(cursor), toBlock: BigInt(end) }))
      cursor = end + 1
    } catch (err) {
      if (span <= MIN_CHUNK) throw err
      span = Math.floor(span / 2)
    }
  }
  return out
}

/**
 * Deposits into `payer` since `fromBlock`, oldest first:
 * [{ from, amount (bigint), epoch, txHash, logIndex }]. Cached per
 * (chain, payer, fromBlock) in `storage`.
 */
export async function readCoins(client, { payer, fromBlock, token = calibration.contracts.usdfc.address, storage } = {}) {
  const store = storageFor(storage)
  const key = `coins:v1:${calibration.id}:${calibration.contracts.filecoinPay.address.toLowerCase()}:${fromBlock}:${String(payer).toLowerCase()}`
  let cached = null
  try {
    const raw = store.getItem(key)
    if (raw) cached = JSON.parse(raw)
  } catch {
    cached = null
  }
  const head = Number(await client.getBlockNumber({ cacheTime: 0 }))
  const start = cached ? Math.max(Number(fromBlock), cached.toBlock - REORG_MARGIN) : Number(fromBlock)
  const keep = cached ? cached.deposits.filter((d) => d.epoch < start) : []
  const logs = await getLogsChunked(client, {
    address: calibration.contracts.filecoinPay.address,
    event: DEPOSIT_EVENT,
    args: { token, to: payer },
  }, start, head)
  const fresh = logs.map((l) => ({ from: l.args.from, amount: l.args.amount.toString(), epoch: Number(l.blockNumber), txHash: l.transactionHash, logIndex: Number(l.logIndex) }))
  const seen = new Set()
  const deposits = [...keep, ...fresh]
    .filter((d) => { const id = `${d.txHash}:${d.logIndex}`; if (seen.has(id)) return false; seen.add(id); return true })
    .sort((a, b) => a.epoch - b.epoch || a.logIndex - b.logIndex)
  try {
    store.setItem(key, JSON.stringify({ toBlock: head, deposits }))
  } catch {
    // storage full or unavailable: the next load rescans
  }
  return { head, deposits: deposits.map((d) => ({ ...d, amount: BigInt(d.amount) })) }
}

/** A public client on calibration for reads. */
export function coinClient() {
  return createPublicClient({ chain: calibration, transport: http() })
}

/**
 * Inserts a coin: approve USDFC for Filecoin Pay if the allowance is
 * short, then deposit(token, to: payer, amount) from the connected
 * wallet. `onStage` gets 'approve:sign' | 'approve:pending' |
 * 'deposit:sign' | 'deposit:pending' | 'done'. Resolves with the
 * DepositRecorded coordinates { epoch, txHash }.
 */
export async function insertCoin({ provider, address, payer, amount, token = calibration.contracts.usdfc.address, onStage = () => {} }) {
  const transport = custom(provider)
  const wallet = createWalletClient({ account: address, chain: calibration, transport })
  const client = createPublicClient({ chain: calibration, transport })
  const b = await balance(client, { address, token })
  if (b.value < amount) throw new Error(`this wallet holds ${Number(b.value) / 1e18} USDFC; a coin is ${Number(amount) / 1e18}`)
  if (b.allowance < amount) {
    onStage('approve:sign')
    const hash = await approve(wallet, { token, amount, spender: calibration.contracts.filecoinPay.address })
    onStage('approve:pending')
    await waitForReceipt(client, hash)
  }
  onStage('deposit:sign')
  const hash = await deposit(wallet, { token, to: payer, amount })
  onStage('deposit:pending')
  const receipt = await waitForReceipt(client, hash)
  if (receipt.status !== 'success') throw new Error('deposit transaction reverted')
  const [event] = parseEventLogs({ abi: [DEPOSIT_EVENT], logs: receipt.logs })
  onStage('done')
  return { epoch: Number(receipt.blockNumber), txHash: event?.transactionHash ?? receipt.transactionHash }
}

// Filecoin null rounds make viem's receipt waiter fail on getBlock; poll receipts only.
async function waitForReceipt(client, hash, { timeoutMs = 10 * 60_000, pollMs = 4000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await client.getTransactionReceipt({ hash }).catch(() => null)
    if (r != null) return r
    await new Promise((res) => setTimeout(res, pollMs))
  }
  throw new Error(`no receipt for ${hash} after ${Math.round(timeoutMs / 60_000)} minutes`)
}
