#!/usr/bin/env node
/**
 * Authorizer spike (issue #4): prove that a data set authorizer on calibration
 * lets a key that holds NO session key add pieces to someone else's data set,
 * under contract-enforced rules, and that the same contract refuses a second
 * write inside the cooldown.
 *
 * Steps, each printed as it happens:
 *   1. deploy contracts/authorizer CooldownAuthorizer(fwss, cooldown, maxPieces)
 *      from PRIVATE_KEY (or reuse AUTHORIZER_ADDRESS)
 *   2. create a scratch data set owned by PRIVATE_KEY (or reuse SPIKE_DATA_SET)
 *   3. FilecoinWarmStorageService.setDataSetAuthorizer(dataSet, authorizer)
 *      as the payer (hand-rolled ABI: the SDK does not know this function)
 *   4. write one piece signed by a fresh random secp256k1 key, through the
 *      unmodified SDK, with local expirations faked so it does not consult
 *      the session key registry: expected to land (PieceAdded)
 *   5. write again with the same key inside the cooldown: expected to be
 *      refused by the chain
 *
 * Prereqs: `set -a; . ./config.env; . ./.env; set +a`, a funded PRIVATE_KEY
 * (tFIL for gas, USDFC deposit + operator approval already done), and
 * `forge build` in contracts/authorizer. Allow ~10 minutes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calibration } from '@filoz/synapse-core/chains'
import { AddPiecesPermission, fromSecp256k1 } from '@filoz/synapse-core/session-key'
import { Synapse } from '@filoz/synapse-sdk'
import { createWalletClient, custom, http, publicActions } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const MIN_PIECE_BYTES = 127
const COOLDOWN_EPOCHS = Number(process.env.SPIKE_COOLDOWN ?? 20)
const MAX_PIECES = 1
const { PRIVATE_KEY, AUTHORIZER_ADDRESS, SPIKE_DATA_SET } = process.env
if (!PRIVATE_KEY) {
  console.error('usage: PRIVATE_KEY=0x.. node scripts/spike-authorizer.mjs')
  process.exit(2)
}

const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a)
const owner = privateKeyToAccount(PRIVATE_KEY)
const transport = http(calibration.rpcUrls.default.http[0])
const client = createWalletClient({ account: owner, chain: calibration, transport }).extend(publicActions)
const fwss = calibration.contracts.fwss.address

async function retry(label, fn, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= attempts) throw err
      log(`${label}: attempt ${attempt} failed (${err?.shortMessage ?? err?.message}); retrying`)
      await new Promise((r) => setTimeout(r, 5000 * attempt))
    }
  }
}

// Filecoin null rounds make viem's receipt waiter fail on getBlock; poll receipts only.
async function receipt(hash, timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await client.getTransactionReceipt({ hash }).catch(() => null)
    if (r != null) return r
    await new Promise((r) => setTimeout(r, 4000))
  }
  throw new Error(`no receipt for ${hash}`)
}

// 1. authorizer
let authorizer = AUTHORIZER_ADDRESS
if (!authorizer) {
  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'contracts/authorizer/out/CooldownAuthorizer.sol/CooldownAuthorizer.json'), 'utf8'))
  log(`deploying CooldownAuthorizer(fwss=${fwss}, cooldown=${COOLDOWN_EPOCHS} epochs, maxPieces=${MAX_PIECES}) from ${owner.address}`)
  const hash = await client.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [fwss, BigInt(COOLDOWN_EPOCHS), BigInt(MAX_PIECES)],
  })
  log('deploy tx', hash)
  const r = await receipt(hash)
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`deploy failed: ${JSON.stringify(r.status)}`)
  authorizer = r.contractAddress
  log('authorizer deployed at', authorizer, 'block', r.blockNumber)
} else {
  log('reusing authorizer', authorizer)
}

// 2. scratch data set
const synapseOwner = Synapse.create({
  account: owner,
  chain: calibration,
  transport: custom({ request: transport({ chain: calibration, retryCount: 0 }).request }),
  source: 'foc-collab-authorizer-spike',
})
let dataSetId = SPIKE_DATA_SET
if (!dataSetId) {
  log('creating a scratch data set (provider submits the transaction)...')
  const ctx = await retry('create context', () => synapseOwner.storage.createContext({}))
  if (ctx.dataSetId == null) {
    const genesis = JSON.stringify({ v: 2, type: 'genesis', purpose: 'foc-collab authorizer spike', wallet: owner.address })
    await retry('genesis upload', () => ctx.upload(new TextEncoder().encode(genesis.padEnd(MIN_PIECE_BYTES, ' '))))
  }
  dataSetId = String(ctx.dataSetId)
}
log('data set', dataSetId)

// 3. attach
const setAbi = [{
  type: 'function', name: 'setDataSetAuthorizer', stateMutability: 'nonpayable',
  inputs: [{ name: 'dataSetId', type: 'uint256' }, { name: 'authorizer', type: 'address' }], outputs: [],
}]
{
  const hash = await client.writeContract({ address: fwss, abi: setAbi, functionName: 'setDataSetAuthorizer', args: [BigInt(dataSetId), authorizer] })
  log('setDataSetAuthorizer tx', hash)
  const r = await receipt(hash)
  if (r.status !== 'success') throw new Error('setDataSetAuthorizer reverted')
  log('authorizer attached in block', r.blockNumber)
}

// 4. a stranger writes. The key below was generated a moment ago and has
//    never been near the session key registry; only the authorizer lets it in.
const strangerKey = generatePrivateKey()
const strangerAddress = privateKeyToAccount(strangerKey).address
const farFuture = { [AddPiecesPermission]: 2n ** 40n }
const stranger = Synapse.create({
  account: owner.address,
  chain: calibration,
  transport: custom({ request: transport({ chain: calibration, retryCount: 0 }).request }),
  sessionKey: fromSecp256k1({ privateKey: strangerKey, root: owner.address, chain: calibration, transport, expirations: farFuture }),
  source: 'foc-collab-authorizer-spike',
  requiredPermissions: [AddPiecesPermission],
})
const strangerCtx = await retry('stranger context', () => stranger.storage.createContext({ dataSetId: Number(dataSetId) }))

async function strangerWrite(label) {
  const body = JSON.stringify({ v: 2, type: 'spike', label, by: strangerAddress, at: Date.now() })
  let piecesAdded = false
  const t0 = Date.now()
  await strangerCtx.upload(new TextEncoder().encode(body.padEnd(MIN_PIECE_BYTES, ' ')), {
    onStored: () => log(`${label}: stored by provider`),
    onPiecesAdded: () => { piecesAdded = true; log(`${label}: PieceAdded on-chain after ${Math.round((Date.now() - t0) / 1000)}s`) },
  })
  return piecesAdded
}

log(`stranger ${strangerAddress} (no session key anywhere) writes piece 1 through the authorizer...`)
const first = await strangerWrite('first')
log('first write:', first ? 'ACCEPTED' : 'no PieceAdded seen')

// 5. inside the cooldown
log(`stranger writes piece 2 immediately (cooldown is ${COOLDOWN_EPOCHS} epochs)...`)
let second = 'refused'
try {
  const ok = await Promise.race([
    strangerWrite('second'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6 * 60_000)),
  ])
  second = ok ? 'ACCEPTED (unexpected)' : 'no PieceAdded seen'
} catch (err) {
  second = `refused (${err?.shortMessage ?? err?.message?.slice(0, 160) ?? err})`
}
log('second write:', second)

console.log(JSON.stringify({ authorizer, dataSetId, payer: owner.address, stranger: strangerAddress, cooldownEpochs: COOLDOWN_EPOCHS, first: first ? 'accepted' : 'unclear', second }, null, 2))
