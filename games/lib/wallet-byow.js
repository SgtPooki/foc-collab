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
 *   3. mint a fresh secp256k1 session key in the page and authorize it for
 *      AddPieces only, time-bound (one transaction)
 *   4. create the player's game data set, or reuse the one this app made
 *      before (one typed-data signature; the provider submits the chain
 *      transaction)
 *   5. keep the descriptor in IndexedDB for this browser
 *
 * The wallet signs three or four times and is never needed again until
 * the session key expires. The session key can only append pieces to
 * this wallet's data sets; it cannot move funds or delete anything.
 * Every step reports progress and every failure surfaces as an error
 * with the step it happened in.
 */
import {
  AddPiecesPermission, calibration, createWalletClient, custom, generatePrivateKey, loginSync,
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
export async function loadDescriptor() {
  if (typeof indexedDB === 'undefined') return null
  const db = await openDb()
  const saved = await idb(db.transaction(STORE).objectStore(STORE).get(KEY))
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

  // 3. Session key: minted here, authorized for AddPieces only.
  const sessionKey = generatePrivateKey()
  const sessionAddress = privateKeyToAccount(sessionKey).address
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + validityDays * 86400)
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

  // 4. The player's data set: reuse this app's if the wallet has one.
  let ds
  try {
    onProgress('finding or creating your game data set')
    const ctx = await synapse.storage.createContext({})
    if (ctx.dataSetId == null) onProgress('sign to create your data set (the provider submits the transaction)')
    else onProgress(`sign to confirm data set #${ctx.dataSetId}`)
    const genesis = JSON.stringify({ v: 2, type: 'genesis', purpose: 'foc-collab BYOW player log', wallet: address })
    await ctx.upload(new TextEncoder().encode(genesis.padEnd(MIN_PIECE_BYTES, ' ')), {
      onPiecesAdded: () => onProgress('data set transaction submitted'),
    })
    ds = String(ctx.dataSetId)
  } catch (err) {
    throw step('data set', err)
  }

  const descriptor = { ds, wallet: address, sessionKey, expiresAt: Number(expiresAt) * 1000 }
  await saveDescriptor(descriptor)
  onProgress('ready')
  return descriptor
}
