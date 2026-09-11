/**
 * Everything async lives here: chain reads before the fold, and the two
 * wallet transactions that feed the corgi. Nothing in this file interprets
 * game state; it produces the fold's input and reports progress.
 *
 * Read path
 *   - account: FilecoinPayV1.accounts(token, payer) + head block, projected
 *     to "unreserved funds" exactly as synapse-core's resolveAccountState
 *     does (synapse-core/src/pay/resolve-account-state.ts), except left
 *     unclamped so the fold can reconstruct history through a deficit.
 *   - deposits: eth_getLogs for DepositRecorded(token, from, to=payer)
 *     (FilecoinPayV1.sol, event at ~:109, emitted by deposit() ~:482) in
 *     chunks, because Filecoin RPCs cap the block range per call. Scanned
 *     logs are cached in localStorage so a reload only scans new blocks.
 *
 * Write path
 *   - feed: ERC20 approve (if needed) then FilecoinPayV1.deposit(token,
 *     to=payer, amount). Plain deposit, not depositWithPermit, so the event
 *     carries the feeder's address as `from`.
 */
import * as sdk from './deps.js' // build.mjs rewrites this to the bundled vendor.js

export const CHAINS = { calibration: sdk.calibration, mainnet: sdk.mainnet }
export const EPOCH_SECONDS = 30
export const DEPOSIT_EVENT = sdk.parseAbiItem(
  'event DepositRecorded(address indexed token, address indexed from, address indexed to, uint256 amount)',
)
// withdraw() emits from = msg.sender = the payer (FilecoinPayV1.sol WithdrawRecorded)
export const WITHDRAW_EVENT = sdk.parseAbiItem(
  'event WithdrawRecorded(address indexed token, address indexed from, address indexed to, uint256 amount)',
)

// Glif calibration caps eth_getLogs at 2880 blocks (probed 2026-09-11; it
// took 10k on 2026-09-02). Stay under the cap rather than rely on the
// error: some Glif backends answer an oversized range with an empty result
// instead, which would read as "no deposits" and declare the corgi dead.
const LOG_CHUNK = 2000
const MIN_CHUNK = 250 // below this an error is the RPC's, not the range's
const RPC_TIMEOUT_MS = 60_000 // a 2k-block getLogs on Glif regularly takes longer than viem's 10s default
const REORG_MARGIN = 120 // rescan this many recent blocks on every load

export function chainOf(name) {
  const chain = CHAINS[name]
  if (chain == null) throw new Error(`unknown chain "${name}"`)
  return chain
}

export function publicClient(chain, rpcUrl) {
  return sdk.createPublicClient({ chain, transport: sdk.http(rpcUrl, { timeout: RPC_TIMEOUT_MS }) })
}

export function tokenOf(chain, token) {
  return token ?? chain.contracts.usdfc.address
}

/** Account snapshot for the fold. `unreserved` may be negative in deficit. */
export async function readAccount(client, { payer, token }) {
  const epoch = await client.getBlockNumber({ cacheTime: 0 })
  const info = await sdk.accounts(client, { address: payer, token, blockNumber: epoch })
  const { funds, lockupCurrent, lockupRate, lockupLastSettledAt } = info
  const unreserved = funds - lockupCurrent - lockupRate * (epoch - lockupLastSettledAt)
  const state = sdk.resolveAccountState({ funds, lockupCurrent, lockupRate, lockupLastSettledAt, currentEpoch: epoch })
  return {
    epoch,
    ratePerEpoch: lockupRate,
    unreserved,
    funds,
    availableFunds: state.availableFunds,
    runwayInEpochs: state.runwayInEpochs,
    grossCoverageInEpochs: state.grossCoverageInEpochs,
  }
}

// The key names everything that defines the scan, so a page built against
// another contract or start block never resumes from this one's log.
function cacheKey(chain, payer, fromBlock) {
  return `corgi:log:v3:${chain.id}:${chain.contracts.filecoinPay.address.toLowerCase()}:${fromBlock}:${payer.toLowerCase()}`
}

/** Drops the cached scan so the next load reads the whole range again. */
export function clearLogCache(storage, { chain, payer, fromBlock }) {
  try {
    storage?.removeItem(cacheKey(chain, payer, Number(fromBlock ?? 0)))
  } catch {
    // unavailable storage has nothing cached
  }
}

function revive(entry) {
  return { ...entry, amount: BigInt(entry.amount), epoch: Number(entry.epoch), logIndex: Number(entry.logIndex) }
}

function loadCache(storage, key) {
  try {
    const raw = storage?.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return { toBlock: Number(parsed.toBlock), deposits: parsed.deposits.map(revive), withdrawals: (parsed.withdrawals ?? []).map(revive) }
  } catch {
    return null
  }
}

function saveCache(storage, key, toBlock, deposits, withdrawals) {
  try {
    const plain = (list) => list.map((d) => ({ ...d, amount: d.amount.toString() }))
    storage?.setItem(key, JSON.stringify({ toBlock: Number(toBlock), deposits: plain(deposits), withdrawals: plain(withdrawals) }))
  } catch {
    // storage full or unavailable: the next load simply rescans
  }
}

function sortDeposits(deposits) {
  return deposits.slice().sort((a, b) => a.epoch - b.epoch || a.logIndex - b.logIndex)
}

function dedupe(deposits) {
  const seen = new Set()
  return deposits.filter((d) => {
    const id = `${d.txHash}:${d.logIndex}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

async function getLogsChunked(client, args, from, to, onProgress) {
  const out = []
  let span = LOG_CHUNK
  let cursor = from
  while (cursor <= to) {
    const end = cursor + span - 1 < to ? cursor + span - 1 : to
    try {
      const logs = await client.getLogs({ ...args, fromBlock: BigInt(cursor), toBlock: BigInt(end) })
      out.push(...logs)
      cursor = end + 1
      onProgress?.({ scanned: cursor - from, total: to - from + 1 })
    } catch (err) {
      if (span <= MIN_CHUNK) throw err
      span = Math.floor(span / 2) // the RPC rejected the range; shrink and retry
    }
  }
  return out
}

function toEntry(l) {
  return { from: l.args.from, to: l.args.to, amount: l.args.amount, epoch: Number(l.blockNumber), logIndex: Number(l.logIndex), txHash: l.transactionHash }
}

/**
 * Attributed deposit log (to = payer) and the payer's withdrawals (from =
 * payer), oldest first. `fromBlock` bounds the first full scan; later loads
 * resume from the cached position. Both scans run in parallel and report
 * combined progress.
 */
export async function readDeposits(client, { chain, payer, token, fromBlock }, { storage, onProgress } = {}) {
  const head = Number(await client.getBlockNumber({ cacheTime: 0 }))
  const key = cacheKey(chain, payer, fromBlock)
  const cached = loadCache(storage, key)
  const start = cached ? Math.max(fromBlock, cached.toBlock - REORG_MARGIN) : fromBlock
  const keepD = cached ? cached.deposits.filter((d) => d.epoch < start) : []
  const keepW = cached ? cached.withdrawals.filter((d) => d.epoch < start) : []

  const progress = [0, 0]
  const report = (i) => ({ scanned, total }) => {
    progress[i] = scanned
    onProgress?.({ scanned: progress[0] + progress[1], total: total * 2 })
  }
  const address = chain.contracts.filecoinPay.address
  const [dLogs, wLogs] = await Promise.all([
    getLogsChunked(client, { address, event: DEPOSIT_EVENT, args: { token, to: payer } }, start, head, report(0)),
    getLogsChunked(client, { address, event: WITHDRAW_EVENT, args: { token, from: payer } }, start, head, report(1)),
  ])

  const deposits = sortDeposits(dedupe([...keepD, ...dLogs.map(toEntry)]))
  const withdrawals = sortDeposits(dedupe([...keepW, ...wLogs.map(toEntry)]))
  // Only reached when every chunk of both scans succeeded: a failed chunk
  // throws above, so a partial scan is never cached as the whole history.
  saveCache(storage, key, head, deposits, withdrawals)
  return { deposits, withdrawals, head }
}

/** Seconds since the Unix epoch for a block height, extrapolated from the head block. */
export async function epochClock(client) {
  const block = await client.getBlock({ blockTag: 'latest' })
  const headEpoch = Number(block.number)
  const headTime = Number(block.timestamp)
  return (epoch) => headTime - (headEpoch - epoch) * EPOCH_SECONDS
}

/**
 * Waits until the RPC's head is past `epoch` by a margin. Filecoin RPCs can
 * return a receipt for a block before eth_getLogs indexes that block, so
 * callers refresh after this rather than straight after the receipt.
 */
export async function waitForEpoch(client, epoch, { margin = 2, pollMs = 4000, timeoutMs = 10 * 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const head = Number(await client.getBlockNumber({ cacheTime: 0 }))
    if (head >= epoch + margin) return head
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(`head did not reach epoch ${epoch + margin}`)
}

/** Everything the fold needs, read in parallel. */
export async function readCorgi(client, config, opts = {}) {
  const chain = chainOf(config.chain)
  const token = tokenOf(chain, config.token)
  const payer = config.payer
  const [account, log, clock] = await Promise.all([
    readAccount(client, { payer, token }),
    readDeposits(client, { chain, payer, token, fromBlock: Number(config.fromBlock ?? 0) }, opts),
    epochClock(client),
  ])
  return { payer, account, deposits: log.deposits, withdrawals: log.withdrawals, head: log.head, clock, token }
}

// ---------------------------------------------------------------- wallet

const RECEIPT_POLL_MS = 4000
const RECEIPT_TIMEOUT_MS = 15 * 60_000

/**
 * Poll for a receipt. viem's own receipt waiter fetches the current block
 * by number while the receipt is missing, and Filecoin null rounds (epochs
 * with no block) make that call fail, so this only asks for the receipt and
 * treats not-found as "keep waiting".
 */
export async function waitForReceipt(client, hash, { timeoutMs = RECEIPT_TIMEOUT_MS, pollMs = RECEIPT_POLL_MS } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      return await client.getTransactionReceipt({ hash })
    } catch (err) {
      if (err?.name !== 'TransactionReceiptNotFoundError') throw err
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  throw new Error(`no receipt for ${hash} after ${Math.round(timeoutMs / 60_000)} minutes`)
}

function hexChainId(chain) {
  return `0x${chain.id.toString(16)}`
}

/** Switches the injected wallet to `chain`, adding it if the wallet lacks it. */
export async function ensureChain(provider, chain) {
  const current = await provider.request({ method: 'eth_chainId' })
  if (Number.parseInt(current, 16) === chain.id) return
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId(chain) }] })
  } catch (err) {
    if (err?.code !== 4902) throw err
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: hexChainId(chain),
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls.default.http,
        blockExplorerUrls: [chain.blockExplorers.default.url],
      }],
    })
  }
}

export async function connectWallet(provider, chain) {
  const [address] = await provider.request({ method: 'eth_requestAccounts' })
  await ensureChain(provider, chain)
  const wallet = sdk.createWalletClient({ account: address, chain, transport: sdk.custom(provider) })
  return { address, wallet }
}

export async function feederBalance(client, { address, token }) {
  const b = await sdk.balance(client, { address, token })
  return { balance: b.value, allowance: b.allowance }
}

/**
 * Feed the corgi: approve USDFC for the Pay contract when the allowance is
 * short, then deposit to the corgi's payer account. `onStage` receives every
 * step so the UI can narrate it.
 */
export async function feed({ wallet, client, chain, token, payer, amount, onStage }) {
  const stage = (name, extra = {}) => onStage?.({ name, ...extra })
  const { allowance } = await feederBalance(client, { address: wallet.account.address, token })
  if (allowance < amount) {
    stage('approve:sign')
    const hash = await sdk.approve(wallet, { token, amount, spender: chain.contracts.filecoinPay.address })
    stage('approve:pending', { hash })
    const receipt = await waitForReceipt(client, hash)
    if (receipt.status !== 'success') throw new Error('approve transaction reverted')
  }
  stage('deposit:sign')
  const hash = await sdk.deposit(wallet, { token, to: payer, amount })
  stage('deposit:pending', { hash })
  const receipt = await waitForReceipt(client, hash)
  if (receipt.status !== 'success') throw new Error('deposit transaction reverted')
  // Filecoin can report a different tx hash in the block than the one
  // eth_sendRawTransaction returned. The DepositRecorded log in the receipt
  // is the record the feed log will show, so report its coordinates.
  const [event] = sdk.parseEventLogs({ abi: [DEPOSIT_EVENT], logs: receipt.logs })
  const result = {
    hash: event?.transactionHash ?? receipt.transactionHash,
    epoch: Number(receipt.blockNumber),
    logIndex: event ? Number(event.logIndex) : null,
  }
  stage('done', result)
  return result
}

export const { formatUnits, parseUnits } = sdk
