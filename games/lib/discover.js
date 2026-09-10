/**
 * Discovery over chain events, no I/O in here.
 *
 * Every piece added to a data set on Filecoin Onchain Cloud emits
 * PieceAdded(dataSetId, pieceId, pieceCid, keys, values) with the piece's
 * metadata. A player tags their own create and join uploads with
 * { app, game, type }; anyone can then find which data sets hold pieces
 * for a game by scanning those events, with no lobby, no publisher key,
 * and no third data set. Tags are hints only: the fold still lists and
 * verifies everything it is pointed at.
 *
 * Public RPCs cap eth_getLogs by block range and result count (Lotus
 * defaults 2,880 epochs and 10,000 results; hosted endpoints often less),
 * so scans go in bounded chunks that shrink on error, and callers
 * checkpoint the last scanned block so a poll only reads new blocks.
 */

export const TAG_APP = 'app'
export const TAG_GAME = 'game'
export const TAG_TYPE = 'type'

/** Metadata to attach to an upload so scanners can find it. Three keys, the FWSS maximum per piece. */
export function tagsFor(app, game, type) {
  return { [TAG_APP]: app, [TAG_GAME]: game, [TAG_TYPE]: type }
}

/** Reads one PieceAdded log's metadata into a plain object. */
export function tagsOf(log) {
  const keys = log?.args?.keys ?? []
  const values = log?.args?.values ?? []
  const out = {}
  keys.forEach((k, i) => { out[k] = values[i] })
  return out
}

/** A hint extracted from a log: which data set holds a tagged piece. */
export function hintOf(log) {
  return {
    ds: String(log.args.dataSetId),
    pieceId: String(log.args.pieceId),
    block: String(log.blockNumber),
    tags: tagsOf(log),
  }
}

/** Splits [from, to] into inclusive chunks of at most `size` blocks. */
export function chunks(from, to, size) {
  const out = []
  let start = BigInt(from)
  const end = BigInt(to)
  const step = BigInt(size)
  while (start <= end) {
    const stop = start + step - 1n < end ? start + step - 1n : end
    out.push([start, stop])
    start = stop + 1n
  }
  return out
}

/**
 * Scans [from, to] with `fetch(fromBlock, toBlock) -> logs[]`, halving the
 * chunk size on failure down to `minChunk`, then giving up on that chunk
 * (reported in `failed`) and continuing. Returns hints for logs that
 * satisfy `match(tags)` and the highest block fully scanned, so the
 * caller can checkpoint even when a chunk failed.
 */
export async function scan({ from, to, fetch, match, chunk = 2000n, minChunk = 250n }) {
  const hints = []
  const failed = []
  let scanned = BigInt(from) - 1n
  let size = BigInt(chunk)
  let cursor = BigInt(from)
  const end = BigInt(to)
  while (cursor <= end) {
    const stop = cursor + size - 1n < end ? cursor + size - 1n : end
    try {
      const logs = await fetch(cursor, stop)
      for (const log of logs) {
        if (match(tagsOf(log))) hints.push(hintOf(log))
      }
      if (failed.length === 0) scanned = stop
      cursor = stop + 1n
    } catch (err) {
      if (size > minChunk) {
        size = size / 2n
        continue
      }
      failed.push({ from: cursor, to: stop, error: err?.shortMessage ?? err?.message ?? String(err) })
      cursor = stop + 1n
    }
  }
  return { hints, scanned, failed }
}
