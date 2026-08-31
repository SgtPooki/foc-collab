#!/usr/bin/env node
/**
 * One-shot owner setup for a shared game log:
 *   1. generates a fresh session keypair
 *   2. authorizes it with ONLY the AddPieces permission, time-bound
 *   3. creates the games data set (owner-side; the session key cannot)
 *      by uploading a genesis piece
 *   4. prints the foc-config block to embed in the published page
 *
 * The printed session key is destined for a public page: it is public by
 * construction. AddPieces-only means a holder can append pieces to the
 * owner's data sets (and spend storage) until expiry — nothing else.
 *
 * Usage:
 *   set -a; . ./config.env; . ./.env; set +a
 *   node scripts/setup-game-log.mjs [validity-days]   (default 14)
 */
import { calibration } from '@filoz/synapse-core/chains'
import { AddPiecesPermission, loginSync } from '@filoz/synapse-core/session-key'
import { Synapse } from '@filoz/synapse-sdk'
import { createWalletClient, custom, http, publicActions } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const MIN_PIECE_BYTES = 127
const validityDays = Number(process.argv[2] ?? 14)
const { PRIVATE_KEY } = process.env
if (!PRIVATE_KEY || !Number.isFinite(validityDays) || validityDays <= 0) {
  console.error('usage: PRIVATE_KEY=0x.. node scripts/setup-game-log.mjs [validity-days]')
  process.exit(1)
}

const owner = privateKeyToAccount(PRIVATE_KEY)
const transport = http(calibration.rpcUrls.default.http[0])
const synapse = Synapse.create({
  account: owner,
  chain: calibration,
  transport: custom({ request: transport({ chain: calibration, retryCount: 0 }).request }),
  source: 'foc-collab-setup',
})
const client = createWalletClient({
  account: owner,
  chain: calibration,
  transport,
}).extend(publicActions)

// 1-2. mint + authorize the add-only session key
const sessionPrivateKey = generatePrivateKey()
const sessionAddress = privateKeyToAccount(sessionPrivateKey).address
const expiresAt = BigInt(Math.floor(Date.now() / 1000) + validityDays * 86400)
console.error(`authorizing ${sessionAddress} for AddPieces only, ${validityDays} days...`)
const { receipt } = await loginSync(client, {
  address: sessionAddress,
  permissions: [AddPiecesPermission],
  expiresAt,
  onHash: (hash) => console.error('login tx:', hash),
})
console.error('authorized in block', receipt.blockNumber)

// 3. create the games data set with a genesis piece (owner-signed upload)
console.error('creating games data set...')
const ctx = await synapse.storage.createContext({})
const genesis = JSON.stringify({ v: 1, type: 'genesis', purpose: 'foc-collab game log' })
await ctx.upload(new TextEncoder().encode(genesis.padEnd(MIN_PIECE_BYTES, ' ')))
console.error('data set id:', ctx.dataSetId)

// 4. the embeddable config
console.log(JSON.stringify(
  { dataset: Number(ctx.dataSetId), wallet: owner.address, sessionKey: sessionPrivateKey },
  null, 2,
))
console.error(`\nsession key expires ${new Date(Number(expiresAt) * 1000).toISOString()}`)
