/**
 * Reading contract event logs from public Filecoin RPCs: the one place
 * for which RPC to scan with and how. The jukebox till (coins.js), the
 * corgi (apps/corgi/chain.js), and discovery (transport-byow.js) all
 * read through here, so a change in an RPC's behavior is fixed once.
 *
 * No one public RPC serves both old and recent logs (probed 2026-09-28
 * on calibration):
 *   filfox  all history in 2000-block chunks, but its head lagged ~500
 *           blocks (4 h) behind the chain and it errors past its head;
 *           times out when an indexed `token` is in the topic filter
 *   Glif    current head, 360 blocks per call, nothing older than ~30k
 *   ankr    current head, under 360 per call, nothing older than 24 h
 *   drpc    current head, ~100 blocks per call on the free plan
 * So logs are read through logClient over all of them: the head is the
 * highest any reports, and each chunk goes to the first RPC that serves
 * it. getLogsChunked halves a chunk when every RPC refuses it, which is
 * how the recent tail lands on Glif after filfox runs out. tokenLogs
 * checks the token on the returned logs, never in the filter.
 *
 * No imports: callers build the viem clients, so the corgi's separate
 * bundle takes nothing extra from this file.
 */

/** RPCs to scan logs with, by chain id, in preference order (history first). Mainnet keeps the SDK default until probed. */
export const LOG_RPCS = {
  314159: [
    'https://calibration.filfox.info/rpc/v1',
    'https://api.calibration.node.glif.io/rpc/v1',
    'https://rpc.ankr.com/filecoin_testnet',
    'https://filecoin-calibration.drpc.org',
  ],
}
export const LOG_RPC_TIMEOUT_MS = 60_000 // a 2k-block getLogs regularly outlasts viem's 10s default
export const REORG_MARGIN = 120 // blocks rescanned on every load, since the tip can reorg
const LOG_CHUNK = 2000
const MIN_CHUNK = 250 // below this an error is the RPC's, not the range's

/**
 * One log reader over several viem clients (build them with retryCount 0,
 * so a refusal moves on at once). getBlockNumber is the highest head any
 * of them reports, so a lagging RPC cannot hide recent blocks; getLogs
 * returns the first client's answer that is not an error.
 */
export function logClient(clients) {
  return {
    async getBlockNumber() {
      const heads = await Promise.allSettled(clients.map((c) => c.getBlockNumber({ cacheTime: 0 })))
      const ok = heads.filter((h) => h.status === 'fulfilled').map((h) => h.value)
      if (ok.length === 0) throw heads[0].reason
      return ok.reduce((a, b) => (b > a ? b : a))
    },
    async getLogs(args) {
      let lastError
      for (const c of clients) {
        try {
          return await c.getLogs(args)
        } catch (err) {
          lastError = err
        }
      }
      throw lastError
    },
  }
}

/**
 * Every log for `args` in [from, to], in chunks that halve on an RPC error
 * down to MIN_CHUNK. Chunks stay under RPC range caps rather than relying
 * on the error: some backends answer an oversized range with an empty
 * result, which reads as "nothing happened" (a corgi with no deposits is
 * dead). A chunk that still fails at MIN_CHUNK throws, so a caller never
 * caches a partial scan as the whole history. `onProgress` gets
 * { scanned, total } in blocks.
 */
export async function getLogsChunked(client, args, from, to, onProgress) {
  const out = []
  let span = LOG_CHUNK
  let cursor = from
  while (cursor <= to) {
    const end = Math.min(cursor + span - 1, to)
    try {
      out.push(...await client.getLogs({ ...args, fromBlock: BigInt(cursor), toBlock: BigInt(end) }))
      cursor = end + 1
      onProgress?.({ scanned: cursor - from, total: to - from + 1 })
    } catch (err) {
      if (span <= MIN_CHUNK) throw err
      span = Math.floor(span / 2)
    }
  }
  return out
}

/** getLogsChunked for an event with an indexed `token`, keeping only `token`'s logs (see above: never in the filter). */
export async function tokenLogs(client, args, token, from, to, onProgress) {
  const logs = await getLogsChunked(client, args, from, to, onProgress)
  return logs.filter((l) => l.args.token.toLowerCase() === String(token).toLowerCase())
}
