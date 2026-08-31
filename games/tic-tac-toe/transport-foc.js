/**
 * Shared-storage transport: every piece in the log is one piece in a data
 * set on Filecoin Onchain Cloud, written with a session key. list()
 * enumerates pieces in piece-id order — the chain assigns ids in a single
 * total order, so every client folds the same log. Pieces are immutable,
 * so fetched bodies are cached forever by CID.
 *
 * Config comes from the page's embedded block (see transport.js):
 * { dataset, wallet, sessionKey? }. When no sessionKey is embedded, the
 * player pastes one once; it stays in localStorage, never in a URL.
 */
import { Synapse } from 'https://esm.sh/@filoz/synapse-sdk@1.2.1'
import { calibration } from 'https://esm.sh/@filoz/synapse-core@0.8.1/chains'
import { AddPiecesPermission, fromSecp256k1, getExpirations } from 'https://esm.sh/@filoz/synapse-core@0.8.1/session-key'
import { createPublicClient, custom, http } from 'https://esm.sh/viem@2.56.1'

const MIN_PIECE_BYTES = 127 // MIN_UPLOAD_SIZE: smaller uploads are rejected

function getSessionKey(config) {
  if (config.sessionKey) return config.sessionKey
  let key = localStorage.getItem('foc-session-key')
  if (!key) {
    key = prompt('Paste your session key (0x…, stays in this browser):')?.trim()
    if (key) localStorage.setItem('foc-session-key', key)
  }
  if (!key) throw new Error('a session key is required to play on shared storage')
  return key
}

function encodePiece(piece) {
  let json = JSON.stringify(piece)
  // JSON parsers accept trailing whitespace; pad up to the minimum piece size.
  if (json.length < MIN_PIECE_BYTES) json = json.padEnd(MIN_PIECE_BYTES, ' ')
  return new TextEncoder().encode(json)
}

export async function createFocTransport(config) {
  const dataSetId = Number(config.dataset)
  const wallet = config.wallet
  if (!Number.isInteger(dataSetId) || !wallet) {
    throw new Error('foc config needs { dataset, wallet }')
  }

  const transport = http(calibration.rpcUrls.default.http[0])
  // The session address has no on-chain actor (it only ever signs), and
  // Filecoin RPC rejects eth_calls *from* a nonexistent account — which is
  // what sessionKey.syncExpirations() would issue. Fetch the grant
  // expirations with a plain public client instead and hand them over.
  const sessionPrivateKey = getSessionKey(config)
  const sessionKey = fromSecp256k1({
    privateKey: sessionPrivateKey,
    root: wallet,
    chain: calibration,
    transport,
  })
  const expirations = await getExpirations(
    createPublicClient({ chain: calibration, transport }),
    { address: wallet, sessionKeyAddress: sessionKey.account.address, permissions: [AddPiecesPermission] },
  )
  const refreshed = fromSecp256k1({
    privateKey: sessionPrivateKey,
    root: wallet,
    chain: calibration,
    transport,
    expirations,
  })

  // A bare-address account requires a custom() transport wrap (SDK quirk).
  const synapse = Synapse.create({
    account: wallet,
    chain: calibration,
    transport: custom({ request: transport({ chain: calibration, retryCount: 0 }).request }),
    sessionKey: refreshed,
    source: 'foc-collab-tictactoe',
    // The key is add-only by design; default validation demands all four.
    requiredPermissions: [AddPiecesPermission],
  })
  const ctx = await synapse.storage.createContext({ dataSetId })

  const bodyCache = new Map() // pieceCid -> parsed piece (immutable)

  return {
    label: `shared data set #${dataSetId}`,
    pollMs: 8000,
    async append(piece) {
      await ctx.upload(encodePiece(piece))
    },
    async list() {
      const entries = []
      for await (const piece of ctx.getPieces({ batchSize: 100n })) {
        entries.push(piece)
      }
      entries.sort((a, b) => (a.pieceId < b.pieceId ? -1 : 1))
      const pieces = []
      for (const { pieceCid } of entries) {
        const key = String(pieceCid)
        if (!bodyCache.has(key)) {
          try {
            const bytes = await ctx.download({ pieceCid })
            bodyCache.set(key, JSON.parse(new TextDecoder().decode(bytes)))
          } catch {
            bodyCache.set(key, null) // non-JSON piece: fold ignores it
          }
        }
        pieces.push(bodyCache.get(key))
      }
      return pieces
    },
  }
}
