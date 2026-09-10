/**
 * BYOW transport: bring your own wallet, write to your own data set.
 *
 * Every player has a home data set on Filecoin Onchain Cloud that their
 * own wallet pays for, plus an AddPieces-only session key for it. The
 * transport writes only there. It reads every data set it has been told
 * about (own, the opponent's, any discovered through invites, ratification
 * moves, or chain events) with no key at all, and returns the union
 * annotated with `src` (data set id) and `pieceId` so the v2 fold can
 * apply the seat-owner sequencing rules. The transport never interprets
 * pieces beyond parsing JSON.
 *
 * Discovery needs no publisher and no key: uploads carry metadata tags,
 * FOC emits them in PieceAdded events, and discover() scans those events
 * (see discover.js). The page carries nothing but public config.
 *
 * Config:
 *   {
 *     me?:       { ds, wallet, sessionKey }   omit for a read-only spectator
 *     peers?:    [ds, ...]                    data sets to read from the start
 *     storage?:  { get(key), set(key, value) } cache; localStorage in browsers
 *     logRpcs?:  [url, ...]  RPCs for eth_getLogs scans, tried in order. The
 *                default glif endpoint fails browser CORS on log responses
 *                over ~100 KB (2026-09-10), so scans default to filfox then
 *                drpc; everything else stays on the SDK's default RPC.
 *   }
 *
 * Works in node and browsers (fetch, WebCrypto, BigInt). The browser build
 * rewrites './foc-deps.js' to the bundled './vendor-foc.js'.
 */
import {
  AddPiecesPermission, calibration, createPublicClient, custom, fromSecp256k1,
  getActivePiecesByCursor, getDataSet, getExpirations, getPDPProvider, http, Synapse,
} from './foc-deps.js'
import { scan, TAG_APP, TAG_GAME, TAG_TYPE } from './discover.js'
import { homeLog } from './fold-byow.js'

const MIN_PIECE_BYTES = 127 // MIN_UPLOAD_SIZE: smaller uploads are rejected
const MAX_PIECE_BYTES = 8192 // a game piece is ~300 bytes; refuse griefer blobs before buffering
const RPC = calibration.rpcUrls.default.http[0]
const DEFAULT_LOG_RPCS = ['https://calibration.filfox.info/rpc/v1', 'https://filecoin-calibration.drpc.org']

function encodePiece(piece) {
  let json = JSON.stringify(piece)
  if (json.length < MIN_PIECE_BYTES) json = json.padEnd(MIN_PIECE_BYTES, ' ')
  return new TextEncoder().encode(json)
}

function memoryStorage() {
  const map = new Map()
  return { get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v) }
}

function defaultStorage() {
  if (typeof document === 'undefined' || typeof localStorage === 'undefined') return memoryStorage()
  return {
    get: (k) => localStorage.getItem(k),
    set: (k, v) => {
      try {
        localStorage.setItem(k, v)
      } catch { /* quota or blocked: cache stays in memory for this session */ }
    },
  }
}

async function fetchBounded(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const length = Number(res.headers.get('content-length') ?? 0)
  if (length > MAX_PIECE_BYTES) throw new Error('oversized piece')
  const reader = res.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > MAX_PIECE_BYTES) {
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
  return bytes
}

/** Keyless reader for one data set: chain listing in piece-id order plus provider retrieval. */
async function openReader(client, ds) {
  const dataSetId = BigInt(ds)
  const info = await getDataSet(client, { dataSetId })
  if (info == null) throw new Error(`data set ${ds} does not exist`)
  const provider = await getPDPProvider(client, { providerId: info.providerId })
  if (provider == null) throw new Error(`data set ${ds}: provider ${info.providerId} not in registry`)
  const serviceURL = provider.pdp.serviceURL
  return {
    ds: String(ds),
    payer: info.payer,
    serviceURL,
    async entries() {
      const out = []
      let cursor
      for (;;) {
        const page = await getActivePiecesByCursor(client, { dataSetId, cursor, limit: 100n })
        for (const item of page.items) out.push({ pieceId: item.id, cid: String(item.cid) })
        if (page.nextCursor == null) break
        cursor = page.nextCursor
      }
      out.sort((a, b) => {
        if (a.pieceId < b.pieceId) return -1
        if (a.pieceId > b.pieceId) return 1
        return 0
      })
      return out
    },
    pieceUrl: (cid) => new URL(`piece/${cid}`, serviceURL).toString(),
  }
}

/** Writer for the caller's own data set, signing AddPieces with the session key. */
async function openWriter(transport, me, source) {
  const dataSetId = Number(me.ds)
  const sessionKey = fromSecp256k1({ privateKey: me.sessionKey, root: me.wallet, chain: calibration, transport })
  // The session address has no on-chain actor, so its expirations are read
  // with a plain public client and handed over (see transport-foc.js).
  const expirations = await getExpirations(
    createPublicClient({ chain: calibration, transport }),
    { address: me.wallet, sessionKeyAddress: sessionKey.account.address, permissions: [AddPiecesPermission] },
  )
  const synapse = Synapse.create({
    account: me.wallet,
    chain: calibration,
    transport: custom({ request: transport({ chain: calibration, retryCount: 0 }).request }),
    sessionKey: fromSecp256k1({ privateKey: me.sessionKey, root: me.wallet, chain: calibration, transport, expirations }),
    source,
    requiredPermissions: [AddPiecesPermission],
  })
  const ctx = await synapse.storage.createContext({ dataSetId })
  return {
    writeExpiry: Number(expirations[AddPiecesPermission] ?? 0n) * 1000,
    async append(piece, onProgress, tags) {
      onProgress?.('uploading to your data set')
      // Resolve once stored and the AddPieces transaction is submitted: the
      // piece is then effectively irrevocable. The poll loop observes truth.
      await new Promise((resolve, reject) => {
        ctx.upload(encodePiece(piece), {
          pieceMetadata: tags, // emitted in PieceAdded; how others find this data set
          onStored: () => onProgress?.('stored by your provider'),
          onPiecesAdded: () => {
            onProgress?.('submitted on-chain')
            resolve()
          },
        }).then(() => onProgress?.('confirmed'), reject)
      })
    },
  }
}

export async function createByowTransport(config = {}) {
  const storage = config.storage ?? defaultStorage()
  const transport = http(RPC)
  const client = createPublicClient({ chain: calibration, transport })
  const me = config.me ?? null

  const readers = new Map() // ds -> reader | Promise<reader>
  const problems = new Map() // ds -> last error message
  const known = new Set([...(config.peers ?? []).map(String)])
  if (me != null) known.add(String(me.ds))

  // Immutable bodies cached by CID, and per data set the ids we have ever
  // seen (id -> cid) so a piece that later disappears from the active list
  // is detected instead of silently rewinding the game.
  const CACHE_KEY = 'ttt:byow:bodies'
  const SEEN_KEY = 'ttt:byow:seen'
  const SCAN_KEY = 'ttt:byow:scan'
  const load = (key) => {
    try {
      return JSON.parse(storage.get(key) ?? '{}')
    } catch {
      return {}
    }
  }
  const bodies = new Map(Object.entries(load(CACHE_KEY)))
  const seen = load(SEEN_KEY) // { [ds]: { [pieceId]: cid } }
  const scans = load(SCAN_KEY) // { [scope]: { scanned: block, hints: [...] } }
  let persistQueued = false
  function persist() {
    if (persistQueued) return
    persistQueued = true
    setTimeout(() => {
      persistQueued = false
      storage.set(CACHE_KEY, JSON.stringify(Object.fromEntries(bodies)))
      storage.set(SEEN_KEY, JSON.stringify(seen))
      storage.set(SCAN_KEY, JSON.stringify(scans))
    }, 250)
  }

  const writer = me == null ? null : await openWriter(transport, me, 'foc-collab-byow')

  // PieceAdded(dataSetId indexed, pieceId indexed, pieceCid, keys, values)
  const pieceAdded = calibration.contracts.fwss.abi.find((e) => e.type === 'event' && e.name === 'PieceAdded')
  const logClients = (config.logRpcs ?? DEFAULT_LOG_RPCS)
    .map((url) => createPublicClient({ chain: calibration, transport: http(url, { retryCount: 0 }) }))
  async function fetchLogs(fromBlock, toBlock) {
    let lastError
    for (const c of logClients) {
      try {
        return await c.getLogs({ address: calibration.contracts.fwss.address, event: pieceAdded, fromBlock, toBlock })
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  }
  const DISCOVER_CHUNK = BigInt(config.discoverChunk ?? 2000)
  const LOBBY_BLOCKS = BigInt(config.lobbyBlocks ?? 4000) // ~33h of calibration history

  /**
   * Scans PieceAdded events from `from` (or the checkpoint) to the head
   * for pieces tagged app + game (or app + type=create for the lobby),
   * remembers the hints, and adds every hinted data set to the read set.
   * Returns { hints, scanned, failed }; failures are reported, not thrown.
   */
  async function discover({ app, game = null, from = null }) {
    const scope = game == null ? `lobby:${app}` : `game:${app}:${game}`
    const head = await client.getBlockNumber()
    const prior = scans[scope] ?? { scanned: null, hints: [] }
    let start
    if (prior.scanned != null) start = BigInt(prior.scanned) + 1n
    else if (from != null) start = BigInt(from)
    else start = head > LOBBY_BLOCKS ? head - LOBBY_BLOCKS : 0n
    const result = start > head
      ? { hints: [], scanned: head, failed: [] }
      : await scan({
        from: start,
        to: head,
        chunk: DISCOVER_CHUNK,
        fetch: fetchLogs,
        match: (t) => t[TAG_APP] === app && (game == null ? t[TAG_TYPE] === 'create' : t[TAG_GAME] === game),
      })
    const hints = [...prior.hints]
    for (const h of result.hints) {
      if (!hints.some((k) => k.ds === h.ds && k.pieceId === h.pieceId)) hints.push(h)
    }
    scans[scope] = { scanned: String(result.scanned), hints }
    persist()
    for (const h of hints) known.add(h.ds)
    return { hints, scanned: result.scanned, failed: result.failed }
  }

  function reader(ds) {
    if (!readers.has(ds)) {
      readers.set(ds, openReader(client, ds).catch((err) => {
        readers.delete(ds)
        throw err
      }))
    }
    return readers.get(ds)
  }

  async function listOne(ds) {
    const r = await reader(ds)
    const entries = await r.entries()
    const missing = entries.filter(({ cid }) => !bodies.has(cid))
    const BATCH = 8
    for (let i = 0; i < missing.length; i += BATCH) {
      await Promise.all(missing.slice(i, i + BATCH).map(async ({ cid }) => {
        try {
          bodies.set(cid, JSON.parse(new TextDecoder().decode(await fetchBounded(r.pieceUrl(cid)))))
        } catch {
          bodies.set(cid, null) // junk piece: the fold ignores nulls
        }
      }))
    }
    const active = new Set()
    seen[ds] ??= {}
    for (const { pieceId, cid } of entries) {
      active.add(String(pieceId))
      seen[ds][String(pieceId)] = cid
    }
    if (missing.length > 0 || entries.length > 0) persist()
    const removed = Object.keys(seen[ds]).filter((id) => !active.has(id))
    const annotate = (id, cid, extra) => {
      const body = bodies.get(cid)
      if (body == null || typeof body !== 'object') return null
      return { ...body, src: ds, pieceId: id, ...extra }
    }
    return {
      pieces: [
        ...entries.map(({ pieceId, cid }) => annotate(String(pieceId), cid, {})),
        ...removed.map((id) => annotate(id, seen[ds][id], { removed: true })),
      ],
      removed: removed.map((id) => ({ src: ds, pieceId: id })),
    }
  }

  let lastDisputes = []
  return {
    label: me == null ? 'BYOW spectator (read-only)' : `BYOW: your data set #${me.ds}`,
    logId: me == null ? null : homeLog(me.ds), // signed into every piece: home binding
    writeExpiry: writer?.writeExpiry ?? 0,
    pollMs: 8000,
    me: me == null ? null : { ds: String(me.ds), wallet: me.wallet },
    blockNumber: () => client.getBlockNumber(),
    discover,

    /** Start reading another player's data set (idempotent). */
    addDataSet(ds) {
      known.add(String(ds))
    },
    dataSets: () => [...known],
    /** Data sets that failed to list on the last poll: { ds, error }. */
    problems: () => [...problems].map(([ds, error]) => ({ ds, error })),
    /** Pieces seen earlier that are no longer active in their data set. */
    disputes: () => lastDisputes,

    /** Append to my own data set; `tags` ({ app, game, type }) are emitted on-chain for discovery. */
    async append(piece, onProgress, tags) {
      if (writer == null) throw new Error('read-only: no wallet and session key configured')
      await writer.append(piece, onProgress, tags)
    },
    async list() {
      const results = await Promise.all([...known].map(async (ds) => {
        try {
          const out = await listOne(ds)
          problems.delete(ds)
          return out
        } catch (err) {
          problems.set(ds, err?.message?.slice(0, 160) ?? String(err))
          // Keep what we know: previously seen pieces still count for this reader.
          const cached = Object.entries(seen[ds] ?? {})
          return {
            pieces: cached.map(([id, cid]) => {
              const body = bodies.get(cid)
              return body == null ? null : { ...body, src: ds, pieceId: id }
            }),
            removed: [],
          }
        }
      }))
      lastDisputes = results.flatMap((r) => r.removed)
      return results.flatMap((r) => r.pieces)
    },
    /** Settled view. Identical to list() until a gossip layer exists. */
    async confirmedList() {
      return this.list()
    },
  }
}
