/**
 * Durable caches for pieces. A piece's bytes never change for its CID, so
 * anything fetched once can be kept for good.
 *
 * - bodyStore: the transport's parsed JSON bodies by CID (or the null /
 *   refused-cap markers described at needsFetch in transport-byow.js), in
 *   IndexedDB, one record per CID. They used to live in one localStorage
 *   string, which hits the ~5 MB origin quota once apps carry sealed
 *   thumbnails, after which caching silently stopped.
 * - cachedFetch: raw piece bytes (sealed photos) in the Cache API, keyed
 *   by piece URL, so a photo is downloaded once per browser.
 *
 * Both fall back to memory where the browser API is missing (node) or
 * refuses (some private modes): slower, never wrong.
 */
import { idbRequest } from './identity.js'

const DB = 'foc-collab-pieces'
const STORE = 'bodies'
const BLOBS = 'foc-collab-blobs'

/** { all(): Promise<Map<cid, body>>, put(cid, body): Promise } kept in memory only. */
export function memoryBodyStore() {
  const map = new Map()
  return {
    all: async () => new Map(map),
    put: async (cid, body) => {
      map.set(cid, body)
    },
  }
}

/** The same interface over IndexedDB; falls back to memory when it cannot open. */
export function idbBodyStore(idb = globalThis.indexedDB) {
  if (idb == null) return memoryBodyStore()
  let fallback = null
  const db = (async () => {
    const request = idb.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    return idbRequest(request)
  })().catch(() => {
    fallback = memoryBodyStore()
    return null
  })
  return {
    async all() {
      const d = await db
      if (d == null) return fallback.all()
      const store = d.transaction(STORE).objectStore(STORE)
      const [keys, values] = await Promise.all([idbRequest(store.getAllKeys()), idbRequest(store.getAll())])
      return new Map(keys.map((k, i) => [k, values[i]]))
    },
    async put(cid, body) {
      const d = await db
      if (d == null) return fallback.put(cid, body)
      await idbRequest(d.transaction(STORE, 'readwrite').objectStore(STORE).put(body, cid))
    },
  }
}

/**
 * Bytes at `url`, from the Cache API when present, else `fetchBytes(url)`,
 * stored for next time. A cache that fails to open or write is skipped:
 * the bytes still come back.
 */
export async function cachedFetch(url, fetchBytes, cacheStorage = globalThis.caches) {
  const cache = await cacheStorage?.open(BLOBS).catch(() => null)
  const hit = await cache?.match(url)
  if (hit != null) return new Uint8Array(await hit.arrayBuffer())
  const bytes = await fetchBytes(url)
  await cache?.put(url, new Response(bytes)).catch(() => {})
  return bytes
}
