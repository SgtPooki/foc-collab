/**
 * Bring your own wallet, from the page. Turns a connected browser wallet
 * (any EIP-1193 provider: MetaMask, Rabby, ...) on Filecoin calibration
 * into a player descriptor { ds, wallet, sessionKey, expiresAt } with no
 * scripts and no pasting:
 *
 *   1. connect, switch or add the calibration chain
 *   2. make sure the wallet has a Filecoin Pay deposit and has approved the
 *      storage service (one permit signature plus one transaction, only
 *      when missing)
 *   3. reuse this browser's session key for the wallet if the chain still
 *      shows it authorized for AddPieces; otherwise mint a fresh secp256k1
 *      key in the page and authorize it, time-bound (one transaction)
 *   4. reuse the player's game data set (from the saved descriptor or by
 *      this app's metadata tag), or create one (one typed-data signature;
 *      the provider submits the chain transaction)
 *   5. keep the descriptor in IndexedDB for this browser
 *
 * Every step that costs a signature is skipped when its result is already
 * in place, and the descriptor is saved after each step, so a flow that
 * fails or is abandoned halfway resumes instead of paying again. The
 * session key can only append pieces to this wallet's data sets; it
 * cannot move funds or delete anything. Every step reports progress and
 * every failure surfaces as an error with the step it happened in.
 */
import {
  AddPiecesPermission, calibration, createWalletClient, custom, generatePrivateKey, getExpirations, loginSync,
  parseUnits, privateKeyToAccount, publicActions, Synapse,
} from './foc-deps.js'

const MIN_PIECE_BYTES = 127
const MAX_ALLOWANCE = 2n ** 256n - 1n
const CHAIN_HEX = `0x${calibration.id.toString(16)}`
const SOURCE = 'foc-collab-byow' // data set metadata: lets createContext reuse this app's data set

const DB = 'ttt-byow'
const STORE = 'player'
const KEY = 'descriptor'

function idb(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function openDb() {
  const request = indexedDB.open(DB, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(STORE)
  return idb(request)
}
/** Whatever is saved, complete or not (a flow that stopped before the data set step). */
async function loadSaved() {
  if (typeof indexedDB === 'undefined') return null
  const db = await openDb()
  const saved = await idb(db.transaction(STORE).objectStore(STORE).get(KEY))
  return saved != null && typeof saved === 'object' ? saved : null
}
/** A complete player descriptor, or null. */
export async function loadDescriptor() {
  const saved = await loadSaved()
  if (saved?.ds && saved?.wallet && saved?.sessionKey) return saved
  return null
}
export async function saveDescriptor(descriptor) {
  const db = await openDb()
  await idb(db.transaction(STORE, 'readwrite').objectStore(STORE).put(descriptor, KEY))
}
export async function clearDescriptor() {
  const db = await openDb()
  await idb(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY))
}

export function hasWallet() {
  return typeof window !== 'undefined' && window.ethereum != null
}

async function ensureChain(provider) {
  const current = await provider.request({ method: 'eth_chainId' })
  if (current?.toLowerCase() === CHAIN_HEX) return
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_HEX }] })
  } catch (err) {
    if (err?.code !== 4902) throw err
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [{
        chainId: CHAIN_HEX,
        chainName: calibration.name,
        nativeCurrency: calibration.nativeCurrency,
        rpcUrls: calibration.rpcUrls.default.http,
        blockExplorerUrls: calibration.blockExplorers?.default?.url ? [calibration.blockExplorers.default.url] : [],
      }],
    })
  }
}

function step(name, err) {
  const message = err?.shortMessage ?? err?.message ?? String(err)
  const out = new Error(`${name}: ${message.slice(0, 200)}`)
  out.step = name
  out.cause = err
  return out
}

/**
 * Runs the whole flow against `provider` and returns the descriptor.
 * `onProgress(stage)` gets short human strings for the UI.
 */
export async function provisionPlayer({
  provider = globalThis.window?.ethereum,
  onProgress = () => {},
  validityDays = 7,
  depositUsdfc = '5',
} = {}) {
  if (provider == null) throw new Error('no browser wallet found (install MetaMask or another EIP-1193 wallet)')

  onProgress('connecting wallet')
  let address
  try {
    const accounts = await provider.request({ method: 'eth_requestAccounts' })
    address = accounts?.[0]
    if (!address) throw new Error('wallet returned no account')
    await ensureChain(provider)
  } catch (err) {
    throw step('connect', err)
  }

  const transport = custom(provider)
  const wallet = createWalletClient({ account: address, chain: calibration, transport }).extend(publicActions)
  const synapse = Synapse.create({ account: address, chain: calibration, transport, source: SOURCE })

  // 2. Filecoin Pay: deposit + operator approval for the storage service.
  onProgress('checking your storage balance')
  try {
    const [account, approval] = await Promise.all([
      synapse.payments.accountInfo(),
      synapse.payments.serviceApproval({ service: calibration.contracts.fwss.address }),
    ])
    const wanted = parseUnits(depositUsdfc, 18)
    const funded = account.availableFunds >= wanted / 2n
    const approved = approval.isApproved && approval.rateAllowance > 0n && approval.lockupAllowance > 0n
    if (!funded || !approved) {
      const balance = await synapse.payments.walletBalance({ token: 'USDFC' })
      if (balance < wanted) {
        throw new Error(`this wallet holds ${Number(balance) / 1e18} USDFC; it needs at least ${depositUsdfc} (calibration faucet: forest-explorer.chainsafe.dev/faucet/calibnet_usdfc)`)
      }
      onProgress(`sign the permit and confirm the deposit of ${depositUsdfc} USDFC`)
      const hash = await synapse.payments.depositWithPermitAndApproveOperator({
        amount: wanted,
        operator: calibration.contracts.fwss.address,
        rateAllowance: MAX_ALLOWANCE,
        lockupAllowance: MAX_ALLOWANCE,
      })
      onProgress('deposit submitted, waiting for the chain')
      await wallet.waitForTransactionReceipt({ hash })
    }
  } catch (err) {
    throw step('storage balance', err)
  }

  // 3. Session key: this browser's, if the chain still honors it for this
  //    wallet; otherwise minted here and authorized for AddPieces only.
  const prior = await loadSaved().catch(() => null)
  const sameWallet = prior?.wallet != null && String(prior.wallet).toLowerCase() === String(address).toLowerCase()
  let { sessionKey, expiresAt } = sameWallet ? await liveSessionKey(wallet, address, prior, onProgress) : {}
  if (sessionKey == null) {
    sessionKey = generatePrivateKey()
    const sessionAddress = privateKeyToAccount(sessionKey).address
    expiresAt = BigInt(Math.floor(Date.now() / 1000) + validityDays * 86400)
    try {
      onProgress(`confirm the session key (AddPieces only, ${validityDays} days)`)
      await loginSync(wallet, {
        address: sessionAddress,
        permissions: [AddPiecesPermission],
        expiresAt,
        onHash: () => onProgress('session key submitted, waiting for the chain'),
      })
    } catch (err) {
      throw step('session key', err)
    }
  }
  // The key is authorized: remember it now, so a failure in the data set
  // step (or a closed tab) never costs another login transaction.
  const partial = { ds: sameWallet ? prior.ds ?? null : null, wallet: address, sessionKey, expiresAt: Number(expiresAt) * 1000 }
  await saveDescriptor(partial)

  // 4. The player's data set: the saved one, else this app's by metadata
  //    tag, else a new one. Only a new data set needs the genesis upload
  //    (that upload is what makes the provider create it).
  let ds
  try {
    onProgress('finding or creating your game data set')
    const ctx = await synapse.storage.createContext(partial.ds != null ? { dataSetId: Number(partial.ds) } : {})
    if (ctx.dataSetId != null) {
      onProgress(`using data set #${ctx.dataSetId}`)
    } else {
      onProgress('sign to create your data set (the provider submits the transaction)')
      const genesis = JSON.stringify({ v: 2, type: 'genesis', purpose: 'foc-collab BYOW player log', wallet: address })
      await ctx.upload(new TextEncoder().encode(genesis.padEnd(MIN_PIECE_BYTES, ' ')), {
        onPiecesAdded: () => onProgress('data set transaction submitted'),
      })
    }
    ds = String(ctx.dataSetId)
  } catch (err) {
    throw step('data set', err)
  }

  const descriptor = { ...partial, ds }
  await saveDescriptor(descriptor)
  onProgress('ready')
  return descriptor
}

const REUSE_MARGIN_S = 3600 // a key about to expire is not worth reusing

/**
 * The saved session key for `address`, if the chain says it is still
 * authorized for AddPieces with more than an hour left. `expiresAt` comes
 * from the chain, not from the descriptor, so a key revoked or re-issued
 * elsewhere is not trusted here.
 */
async function liveSessionKey(client, address, prior, onProgress) {
  if (typeof prior?.sessionKey !== 'string') return {}
  try {
    onProgress('checking your session key')
    const sessionKeyAddress = privateKeyToAccount(prior.sessionKey).address
    const expirations = await getExpirations(client, { address, sessionKeyAddress, permissions: [AddPiecesPermission] })
    const expiresAt = expirations[AddPiecesPermission] ?? 0n
    if (expiresAt <= BigInt(Math.floor(Date.now() / 1000) + REUSE_MARGIN_S)) return {}
    return { sessionKey: prior.sessionKey, expiresAt }
  } catch (err) {
    console.warn('session key check failed, minting a new one', err)
    return {}
  }
}
