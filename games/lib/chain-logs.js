/**
 * Reading contract event logs from public Filecoin RPCs: the one place
 * for which RPC to scan with and how. The jukebox till (coins.js), the
 * corgi (apps/corgi/chain.js), and discovery (transport-byow.js) all
 * read through here, so a change in an RPC's behavior is fixed once.
 *
 * Why not the SDK's default (Glif): by 2026-09-28 Glif capped eth_getLogs
 * at 360 blocks and refused blocks older than about 30k ("outside
 * available upstream range"), so any history more than a few days old
 * could not be read at all. filfox answers a 74k-block range in 2k-block
 * chunks (probed 2026-09-28), but times out when an indexed `token` is in
 * the topic filter, so tokenLogs checks the token on the returned logs.
 * drpc is a fallback for discovery, which tolerates a failed chunk.
 *
 * No imports: callers build their own clients (viem's getLogs shape), so
 * the corgi's separate bundle takes nothing extra from this file.
 */

/** RPCs to scan logs with, by chain id, in preference order. Mainnet keeps the SDK default until probed. */
export const LOG_RPCS = {
  314159: ['https://calibration.filfox.info/rpc/v1', 'https://filecoin-calibration.drpc.org'],
}
export const LOG_RPC_TIMEOUT_MS = 60_000 // a 2k-block getLogs regularly outlasts viem's 10s default
export const REORG_MARGIN = 120 // blocks rescanned on every load, since the tip can reorg
const LOG_CHUNK = 2000
const MIN_CHUNK = 250 // below this an error is the RPC's, not the range's

/** The preferred log RPC for a chain id, or undefined (the SDK default). */
export const logRpc = (chainId) => LOG_RPCS[chainId]?.[0]

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
