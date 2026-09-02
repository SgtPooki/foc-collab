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

const LOG_CHUNK = 10_000 // Glif calibration accepts 10k, rejects 50k (probed 2026-09-02)
const REORG_MARGIN = 120 // rescan this many recent blocks on every load

export function chainOf(name) {
  const chain = CHAINS[name]
  if (chain == null) throw new Error(`unknown chain "${name}"`)
  return chain
}

export function publicClient(chain, rpcUrl) {
  return sdk.createPublicClient({ chain, transport: sdk.http(rpcUrl) })
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

function cacheKey(chain, payer) {
  return `corgi:deposits:${chain.id}:${payer.toLowerCase()}`
}

function revive(entry) {
  return { ...entry, amount: BigInt(entry.amount), epoch: Number(entry.epoch), logIndex: Number(entry.logIndex) }
}

function loadCache(storage, key) {
  try {
    const raw = storage?.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return { toBlock: Number(parsed.toBlock), deposits: parsed.deposits.map(revive) }
  } catch {
    return null
  }
}

function saveCache(storage, key, toBlock, deposits) {
  try {
    storage?.setItem(key, JSON.stringify({
      toBlock: Number(toBlock),
      deposits: deposits.map((d) => ({ ...d, amount: d.amount.toString() })),
    }))
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
      if (span <= 250) throw err
      span = Math.floor(span / 2) // the RPC rejected the range; shrink and retry
    }
  }
  return out
}

/**
 * Attributed deposit log for the payer, oldest first. `fromBlock` bounds the
 * first full scan; later loads resume from the cached position.
 */
export async function readDeposits(client, { chain, payer, token, fromBlock }, { storage, onProgress } = {}) {
  const head = Number(await client.getBlockNumber({ cacheTime: 0 }))
  const key = cacheKey(chain, payer)
  const cached = loadCache(storage, key)
  const start = cached ? Math.max(fromBlock, cached.toBlock - REORG_MARGIN) : fromBlock
  const keep = cached ? cached.deposits.filter((d) => d.epoch < start) : []

  const logs = await getLogsChunked(client, {
    address: chain.contracts.filecoinPay.address,
    event: DEPOSIT_EVENT,
    args: { token, to: payer },
  }, start, head, onProgress)

  const fresh = logs.map((l) => ({
    from: l.args.from,
    amount: l.args.amount,
    epoch: Number(l.blockNumber),
    logIndex: Number(l.logIndex),
    txHash: l.transactionHash,
  }))
  const deposits = sortDeposits(dedupe([...keep, ...fresh]))
  saveCache(storage, key, head, deposits)
  return { deposits, head }
}

/** Seconds since the Unix epoch for a block height, extrapolated from the head block. */
export async function epochClock(client) {
  const block = await client.getBlock({ blockTag: 'latest' })
  const headEpoch = Number(block.number)
  const headTime = Number(block.timestamp)
  return (epoch) => headTime - (headEpoch - epoch) * EPOCH_SECONDS
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
  return { payer, account, deposits: log.deposits, head: log.head, clock, token }
}

// ---------------------------------------------------------------- wallet

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
    const receipt = await client.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error('approve transaction reverted')
  }
  stage('deposit:sign')
  const hash = await sdk.deposit(wallet, { token, to: payer, amount })
  stage('deposit:pending', { hash })
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('deposit transaction reverted')
  stage('done', { hash, epoch: Number(receipt.blockNumber) })
  return { hash, epoch: Number(receipt.blockNumber) }
}

export const { formatUnits, parseUnits } = sdk
