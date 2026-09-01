#!/usr/bin/env node
/**
 * Spike 2 (Notion mini-plan step 2, node-first): enumerate a data set's
 * pieces in piece-id order, fetch each body, and print the fold input.
 * Read-only: needs no key at all, only the owner address and data set id.
 *
 * Usage:
 *   set -a; . ./config.env; . ./.env; set +a
 *   node scripts/spike-list-pieces.mjs <dataSetId>
 */
import { calibration } from '@filoz/synapse-core/chains'
import { Synapse } from '@filoz/synapse-sdk'
import { custom, http } from 'viem'

const dataSetId = Number(process.argv[2])
const { WALLET_ADDRESS } = process.env
if (!Number.isInteger(dataSetId) || !WALLET_ADDRESS) {
  console.error('usage: WALLET_ADDRESS=0x.. node scripts/spike-list-pieces.mjs <dataSetId>')
  process.exit(1)
}

const transport = http(calibration.rpcUrls.default.http[0])
const synapse = Synapse.create({
  account: WALLET_ADDRESS,
  chain: calibration,
  transport: custom({ request: transport({ chain: calibration, retryCount: 0 }).request }),
  source: 'foc-collab-spike',
})
const ctx = await synapse.storage.createContext({ dataSetId })

const pieces = []
// Cursor-based traversal: sidesteps the getActivePieceCount OOG (filecoin-pin #691).
for await (const piece of ctx.getPieces({ batchSize: 100n })) pieces.push(piece)
pieces.sort((a, b) => (a.pieceId < b.pieceId ? -1 : 1))

console.log(`${pieces.length} pieces`)
for (const { pieceId, pieceCid } of pieces) {
  const bytes = await ctx.download({ pieceCid })
  let body
  try {
    body = JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    body = `<non-JSON, ${bytes.length} bytes>`
  }
  console.log(pieceId, String(pieceCid), body)
}
