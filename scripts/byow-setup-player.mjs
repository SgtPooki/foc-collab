#!/usr/bin/env node
/**
 * One-shot BYOW player setup, run once per player with THEIR wallet:
 *   1. generates a fresh session keypair
 *   2. authorizes it with ONLY the AddPieces permission, time-bound
 *   3. creates the player's own game data set with a genesis piece
 *   4. prints the player descriptor JSON the page needs
 *
 * The descriptor is { ds, wallet, sessionKey }. The session key can only
 * append pieces to this wallet's data sets until expiry; the wallet pays
 * for its own writes. That is what "bring your own wallet" means here.
 *
 * Usage:
 *   set -a; . ./config.env; . ./.env; set +a
 *   node scripts/byow-setup-player.mjs [validity-days]        (uses PRIVATE_KEY)
 *   PRIVATE_KEY=$PLAYER_B_PRIVATE_KEY node scripts/byow-setup-player.mjs
 */
import { calibration } from '@filoz/synapse-core/chains'
import { AddPiecesPermission, loginSync } from '@filoz/synapse-core/session-key'
import { Synapse } from '@filoz/synapse-sdk'
import { createWalletClient, custom, http, publicActions } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const MIN_PIECE_BYTES = 127
const validityDays = Number(process.argv[2] ?? 2)
const { PRIVATE_KEY } = process.env
if (!PRIVATE_KEY || !Number.isFinite(validityDays) || validityDays <= 0) {
  console.error('usage: PRIVATE_KEY=0x.. node scripts/byow-setup-player.mjs [validity-days]')
  process.exit(1)
}

const owner = privateKeyToAccount(PRIVATE_KEY)
const transport = http(calibration.rpcUrls.default.http[0])
const synapse = Synapse.create({
  account: owner,
  chain: calibration,
  transport: custom({ request: transport({ chain: calibration, retryCount: 0 }).request }),
  source: 'foc-collab-byow',
})
const client = createWalletClient({ account: owner, chain: calibration, transport }).extend(publicActions)

async function retry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= 4) throw err
      console.error(`${label}: attempt ${attempt} failed (${err?.shortMessage ?? err?.message}); retrying`)
      await new Promise((r) => setTimeout(r, 5000 * attempt))
    }
  }
}

const sessionPrivateKey = generatePrivateKey()
const sessionAddress = privateKeyToAccount(sessionPrivateKey).address
const expiresAt = BigInt(Math.floor(Date.now() / 1000) + validityDays * 86400)
console.error(`wallet ${owner.address}: authorizing session ${sessionAddress} for AddPieces only, ${validityDays} days...`)
const { receipt } = await retry('login', () => loginSync(client, {
  address: sessionAddress,
  permissions: [AddPiecesPermission],
  expiresAt,
  onHash: (hash) => console.error('login tx:', hash),
}))
console.error('authorized in block', receipt.blockNumber)

console.error('creating this player\'s game data set...')
const ctx = await retry('create context', () => synapse.storage.createContext({}))
const genesis = JSON.stringify({ v: 2, type: 'genesis', purpose: 'foc-collab BYOW player log', wallet: owner.address })
await retry('genesis upload', () => ctx.upload(new TextEncoder().encode(genesis.padEnd(MIN_PIECE_BYTES, ' '))))
console.error('data set id:', ctx.dataSetId)

console.log(JSON.stringify({ ds: String(ctx.dataSetId), wallet: owner.address, sessionKey: sessionPrivateKey }))
console.error(`session key expires ${new Date(Number(expiresAt) * 1000).toISOString()}`)
