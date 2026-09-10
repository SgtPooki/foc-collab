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
// Bundled locally by scripts/build-page.mjs — the published page carries
// its dependencies instead of trusting a CDN at runtime.
import {
  AddPiecesPermission, calibration, createPublicClient, custom,
  fromSecp256k1, getExpirations, http, Synapse,
} from './vendor-foc.js'

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

  // pieceCid -> parsed piece. Pieces are immutable, so cache entries never
  // expire; persisting them means a reload only downloads NEW pieces.
  const bodyCache = new Map()
  const CACHE_KEY = `ttt:piece-cache:${dataSetId}`
  try {
    for (const [cid, body] of JSON.parse(localStorage.getItem(CACHE_KEY) ?? '[]')) {
      bodyCache.set(cid, body)
    }
  } catch { /* corrupt cache: start cold */ }
  let persistQueued = false
  function persistCache() {
    if (persistQueued) return
    persistQueued = true
    setTimeout(() => {
      persistQueued = false
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify([...bodyCache]))
      } catch { /* storage full or blocked: cache stays in-memory */ }
    }, 250)
  }

  const writeExpiry = Number(expirations[AddPiecesPermission] ?? 0n) * 1000
  return {
    label: `shared data set #${dataSetId}`,
    logId: `foc:${dataSetId}`, // stamped into signed pieces for domain separation
    writeExpiry, // ms epoch when the embedded write key dies; 0 if unknown
    pollMs: 8000,
    async append(piece, onProgress) {
      onProgress?.('uploading')
      // Resolve once the piece is stored and its transaction submitted —
      // the move is then effectively irrevocable. Final confirmation
      // continues in the background; the poll loop observes the truth.
      await new Promise((resolve, reject) => {
        ctx.upload(encodePiece(piece), {
          onStored: () => onProgress?.('stored by provider'),
          onPiecesAdded: () => {
            onProgress?.('submitted on-chain')
            resolve()
          },
        }).then(() => onProgress?.('confirmed'), reject)
      })
    },
    async list() {
      const entries = []
      for await (const piece of ctx.getPieces({ batchSize: 100n })) {
        entries.push(piece)
      }
      entries.sort((a, b) => (a.pieceId < b.pieceId ? -1 : 1))
      const missing = entries.filter(({ pieceCid }) => !bodyCache.has(String(pieceCid)))
      // Fetch uncached bodies concurrently (small JSON pieces, capped batch).
      const BATCH = 8
      for (let i = 0; i < missing.length; i += BATCH) {
        await Promise.all(missing.slice(i, i + BATCH).map(async ({ pieceCid }) => {
          try {
            // Junk-piece guard: a game piece is ~200 bytes. Fetch by URL and
            // refuse oversized bodies BEFORE buffering them, so a griefer's
            // gigabyte piece cannot OOM every client. Signature verification
            // downstream covers integrity, which ctx.download would have.
            const res = await fetch(ctx.getPieceUrl(pieceCid))
            if (!res.ok) throw new Error(`fetch ${res.status}`)
            const length = Number(res.headers.get('content-length') ?? 0)
            if (length > 8192) throw new Error('oversized piece')
            const reader = res.body.getReader()
            const chunks = []
            let total = 0
            for (;;) {
              const { done, value } = await reader.read()
              if (done) break
              total += value.length
              if (total > 8192) {
                await reader.cancel()
                throw new Error('oversized piece')
              }
              chunks.push(value)
            }
            const bytes = new Uint8Array(total)
            let offset = 0
            for (const c of chunks) {
              bytes.set(c, offset)
              offset += c.length
            }
            bodyCache.set(String(pieceCid), JSON.parse(new TextDecoder().decode(bytes)))
          } catch {
            bodyCache.set(String(pieceCid), null) // junk piece: fold ignores it
          }
        }))
      }
      if (missing.length > 0) persistCache()
      return entries.map(({ pieceCid }) => bodyCache.get(String(pieceCid)))
    },
  }
}
