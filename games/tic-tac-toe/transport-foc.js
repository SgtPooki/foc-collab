/**
 * Shared-storage transport: every move is one piece in a data set on
 * Filecoin Onchain Cloud, written with a session key. list() enumerates
 * pieces in piece-id order — the chain assigns ids in a single total
 * order, so every client folds the same log. Pieces are immutable, so
 * fetched move bodies are cached forever by CID.
 *
 * URL params: ?transport=foc&dataset=<id>&wallet=<owner-address>&game=<id>
 * The session key (a private key) is never in the URL or the HTML; it is
 * pasted once and kept in localStorage.
 */
import { Synapse } from 'https://esm.sh/@filoz/synapse-sdk@1.2.1'
import { fromSecp256k1 } from 'https://esm.sh/@filoz/synapse-core/session-key'
import { custom, http } from 'https://esm.sh/viem'

const MIN_PIECE_BYTES = 127 // MIN_UPLOAD_SIZE: smaller uploads are rejected

function getSessionKey() {
  let key = localStorage.getItem('foc-session-key')
  if (!key) {
    key = prompt('Paste your session key (0x…, stays in this browser):')?.trim()
    if (key) localStorage.setItem('foc-session-key', key)
  }
  if (!key) throw new Error('a session key is required for the foc transport')
  return key
}

function encodeMove(move) {
  let json = JSON.stringify(move)
  // JSON parsers accept trailing whitespace; pad up to the minimum piece size.
  if (json.length < MIN_PIECE_BYTES) json = json.padEnd(MIN_PIECE_BYTES, ' ')
  return new TextEncoder().encode(json)
}

export async function createFocTransport(params) {
  const dataSetId = Number(params.get('dataset'))
  const wallet = params.get('wallet')
  if (!Number.isInteger(dataSetId) || !wallet) {
    throw new Error('foc transport needs ?dataset=<id>&wallet=<owner-address>')
  }

  const transport = http() // chain default RPC
  const sessionKey = fromSecp256k1({
    privateKey: getSessionKey(),
    root: wallet,
    transport,
  })
  await sessionKey.syncExpirations()

  // A bare-address account requires a custom() transport wrap (SDK quirk).
  const synapse = Synapse.create({
    account: wallet,
    transport: custom({ request: transport({ retryCount: 0 }).request }),
    sessionKey,
    source: 'foc-collab-tictactoe',
  })
  const ctx = await synapse.storage.createContext({ dataSetId })

  const bodyCache = new Map() // pieceCid -> parsed move (pieces are immutable)

  return {
    label: `foc data set #${dataSetId}`,
    pollMs: 8000,
    async append(_game, move) {
      await ctx.upload(encodeMove(move))
    },
    async list() {
      const entries = []
      for await (const piece of ctx.getPieces({ batchSize: 100n })) {
        entries.push(piece)
      }
      entries.sort((a, b) => (a.pieceId < b.pieceId ? -1 : 1))
      const moves = []
      for (const { pieceCid } of entries) {
        if (!bodyCache.has(String(pieceCid))) {
          try {
            const bytes = await ctx.download({ pieceCid })
            bodyCache.set(String(pieceCid), JSON.parse(new TextDecoder().decode(bytes)))
          } catch {
            bodyCache.set(String(pieceCid), null) // non-JSON piece: fold ignores it
          }
        }
        moves.push(bodyCache.get(String(pieceCid)))
      }
      return moves
    },
  }
}
