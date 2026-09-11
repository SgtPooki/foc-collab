#!/usr/bin/env node
/**
 * Arcade sponsor setup: the one-time, owner-side steps that give the site
 * a data set any visitor may write to as a guest.
 *
 *   1. deploy contracts/authorizer ArcadeAuthorizer with a policy
 *      (or reuse AUTHORIZER_ADDRESS)
 *   2. create the arcade data set from PRIVATE_KEY's wallet
 *      (or reuse ARCADE_DATA_SET); the wallet that runs this owns the
 *      data set for good, there is no reassigning a payer
 *   3. FilecoinWarmStorageService.setDataSetAuthorizer(dataSet, authorizer)
 *   4. verify: a guest key minted in memory writes one piece through
 *      games/lib/transport-byow.js appendSponsored()
 *
 * Prints the page config fragment to stdout; progress on stderr.
 * Prereqs: `set -a; . ./config.env; . ./.env; set +a`, a funded wallet
 * (tFIL for gas, Filecoin Pay deposit + operator approval done), and
 * `forge build` in contracts/authorizer. Allow ~10 minutes.
 *
 * Policy env (epochs are 30s on calibration):
 *   SPONSOR_COOLDOWN   epochs between one guest's writes   (default 4, two minutes)
 *   SPONSOR_MAX_PIECES pieces per operation                 (default 1)
 *   SPONSOR_BUDGET     pieces per window across all guests (default 200)
 *   SPONSOR_WINDOW     window length in epochs              (default 2880, one day)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { calibration } from '@filoz/synapse-core/chains'
import { Synapse } from '@filoz/synapse-sdk'
import { createWalletClient, custom, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createByowTransport } from '../games/lib/transport-byow.js'
import { generateIdentity, signPiece } from '../games/lib/identity.js'
import { homeLog } from '../games/lib/byow-engine.js'
import { tagsFor } from '../games/lib/discover.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const MIN_PIECE_BYTES = 127
const { PRIVATE_KEY, AUTHORIZER_ADDRESS, ARCADE_DATA_SET } = process.env
if (!PRIVATE_KEY) {
  console.error('usage: PRIVATE_KEY=0x.. node scripts/sponsor-setup.mjs')
  process.exit(2)
}
const policy = {
  cooldownEpochs: BigInt(process.env.SPONSOR_COOLDOWN ?? 4),
  maxPiecesPerOp: BigInt(process.env.SPONSOR_MAX_PIECES ?? 1),
  budgetPerWindow: BigInt(process.env.SPONSOR_BUDGET ?? 200),
  windowEpochs: BigInt(process.env.SPONSOR_WINDOW ?? 2880),
  paused: false,
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
  const artifact = JSON.parse(fs.readFileSync(path.join(root, 'contracts/authorizer/out/ArcadeAuthorizer.sol/ArcadeAuthorizer.json'), 'utf8'))
  log(`deploying ArcadeAuthorizer from ${owner.address}: cooldown ${policy.cooldownEpochs} epochs, ${policy.maxPiecesPerOp} piece/op, ${policy.budgetPerWindow} pieces per ${policy.windowEpochs} epochs`)
  const hash = await client.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [fwss, policy] })
  log('deploy tx', hash)
  const r = await receipt(hash)
  if (r.status !== 'success' || !r.contractAddress) throw new Error('deploy failed')
  authorizer = r.contractAddress
  log('authorizer at', authorizer, 'block', r.blockNumber)
} else {
  log('reusing authorizer', authorizer)
}

// 2. the arcade data set
const synapse = Synapse.create({
  account: owner,
  chain: calibration,
  transport: custom({ request: transport({ chain: calibration, retryCount: 0 }).request }),
  source: 'foc-collab-arcade',
})
let dataSetId = ARCADE_DATA_SET
if (!dataSetId) {
  log('creating the arcade data set (the provider submits the transaction)...')
  const ctx = await retry('create context', () => synapse.storage.createContext({}))
  if (ctx.dataSetId == null) {
    const genesis = JSON.stringify({ v: 2, type: 'genesis', purpose: 'foc-collab arcade: sponsored writes', wallet: owner.address })
    await retry('genesis upload', () => ctx.upload(new TextEncoder().encode(genesis.padEnd(MIN_PIECE_BYTES, ' '))))
  }
  dataSetId = String(ctx.dataSetId)
}
log('arcade data set', dataSetId, 'payer', owner.address)

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
  log('attached in block', r.blockNumber)
}

// 4. a guest writes through the library, exactly as a page would
const sponsored = { ds: dataSetId, payer: owner.address }
const byow = await createByowTransport({ me: null, sponsored })
const identity = await generateIdentity()
const piece = await signPiece({ v: 2, app: 'foc-arcade', log: homeLog(dataSetId), type: 'hello', text: 'first guest write' }, identity)
const guest = await byow.guestAddress()
log(`guest ${guest} (no wallet, no session key) writes one piece...`)
const t0 = Date.now()
await byow.appendSponsored(piece, (stage) => log(`  ${stage}`), tagsFor('foc-arcade', 'setup', 'hello'))
log(`guest write submitted after ${Math.round((Date.now() - t0) / 1000)}s`)

console.log(JSON.stringify({ sponsored, authorizer, policy: Object.fromEntries(Object.entries(policy).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])) }, null, 2))
