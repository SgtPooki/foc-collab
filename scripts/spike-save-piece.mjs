#!/usr/bin/env node
/**
 * Spike 1 (Notion mini-plan step 1, node-first): save one JSON piece to a
 * data set using a session key — no server, session identity only.
 *
 * Usage:
 *   set -a; . ./config.env; . ./.env; set +a
 *   node scripts/spike-save-piece.mjs <dataSetId> '<json>'
 *
 * Env: WALLET_ADDRESS (owner), SESSION_KEY (session private key, from
 * `npx filecoin-pin session create`).
 */
import { fromSecp256k1 } from '@filoz/synapse-core/session-key'
import { Synapse } from '@filoz/synapse-sdk'
import { custom, http } from 'viem'

const MIN_PIECE_BYTES = 127
const [dataSetIdArg, jsonArg] = process.argv.slice(2)
const dataSetId = Number(dataSetIdArg)
const { WALLET_ADDRESS, SESSION_KEY } = process.env
if (!Number.isInteger(dataSetId) || !jsonArg || !WALLET_ADDRESS || !SESSION_KEY) {
  console.error('usage: WALLET_ADDRESS=0x.. SESSION_KEY=0x.. node scripts/spike-save-piece.mjs <dataSetId> \'{"hello":1}\'')
  process.exit(1)
}

const transport = http()
const sessionKey = fromSecp256k1({ privateKey: SESSION_KEY, root: WALLET_ADDRESS, transport })
await sessionKey.syncExpirations()

const synapse = Synapse.create({
  account: WALLET_ADDRESS,
  transport: custom({ request: transport({ retryCount: 0 }).request }),
  sessionKey,
  source: 'foc-collab-spike',
})
const ctx = await synapse.storage.createContext({ dataSetId })

const bytes = new TextEncoder().encode(JSON.stringify(JSON.parse(jsonArg)).padEnd(MIN_PIECE_BYTES, ' '))
const result = await ctx.upload(bytes, {
  onPiecesAdded: (tx) => console.log('pieces added, tx:', tx),
})
console.log('stored piece:', String(result.pieceCid))
