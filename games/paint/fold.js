/**
 * Paint war: a shared canvas as a fold over one data set. Pure, no I/O.
 *
 * Every pixel is a signed piece in the arcade's paint data set, written
 * through its authorizer by a guest key minted in each browser (wallet
 * players too: last-writer-wins needs one total order, and only one
 * data set gives that). The authorizer is the cooldown and the budget;
 * the fold is the canvas.
 *
 * Piece shape (schema v2, app 'foc-paint'):
 *   { v: 2, app: 'foc-paint', log: 'byow:<ds>', type: 'pixel', board, x, y, c, token }
 * with x, y in [0, SIZE) and c a palette index in [0, PALETTE.length).
 * Boards are rooms: the `game` metadata tag on the piece is the board.
 *
 * Ordering: the highest piece id for a cell wins; that is the only order
 * the fold uses. A piece annotated `removed: true` (it vanished from the
 * active list after a reader saw it) is kept for the reader that saw it
 * and reported as a dispute, never silently dropped. Annotations from
 * outside the signed body: src, pieceId, ref, removed.
 */
export const V = 2
export const APP = 'foc-paint'
export const SIZE = 64
export const PALETTE = [
  '#ffffff', '#e4e4e4', '#888888', '#222222',
  '#ffa7d1', '#e50000', '#e59500', '#a06a42',
  '#e5d900', '#94e044', '#02be01', '#00d3dd',
  '#0083c7', '#0000ea', '#cf6ee4', '#820080',
]

function idOf(piece) {
  try {
    return BigInt(piece.pieceId)
  } catch {
    return null
  }
}

const isCoord = (n) => Number.isInteger(n) && n >= 0 && n < SIZE
const isColor = (n) => Number.isInteger(n) && n >= 0 && n < PALETTE.length

/** A usable pixel for `board`: right schema, bound to its own data set, in range. */
export function usablePixel(piece, board, ds) {
  if (piece == null || typeof piece !== 'object') return false
  if (piece.v !== V || piece.app !== APP || piece.type !== 'pixel' || piece.board !== board) return false
  if (typeof piece.src !== 'string' || piece.src !== String(ds) || idOf(piece) == null) return false
  if (typeof piece.ref !== 'string' || typeof piece.token !== 'string' || piece.token === '') return false
  if (piece.log !== `byow:${piece.src}`) return false
  return isCoord(piece.x) && isCoord(piece.y) && isColor(piece.c)
}

/**
 * Folds the paint data set's pieces into a board. Only pieces from data
 * set `ds` count. Returns cells (palette index or null), who painted each
 * standing cell, per-token counts of standing pixels, and disputes.
 */
export function foldBoard(board, ds, pieces) {
  const named = pieces.filter((p) => p != null && typeof p === 'object' && p.board === board)
  const pixels = named.filter((p) => usablePixel(p, board, ds))
  const byId = new Map()
  for (const p of pixels) {
    const id = String(idOf(p))
    if (!byId.has(id)) byId.set(id, p) // a duplicate id is the same piece listed twice
  }
  const ordered = [...byId.values()].sort((a, b) => (idOf(a) < idOf(b) ? -1 : 1))
  const cells = Array(SIZE * SIZE).fill(null)
  const owner = Array(SIZE * SIZE).fill(null)
  const disputes = []
  for (const p of ordered) {
    const i = p.y * SIZE + p.x
    cells[i] = p.c
    owner[i] = { token: p.token, pieceId: String(p.pieceId) }
    if (p.removed === true) disputes.push({ x: p.x, y: p.y, pieceId: String(p.pieceId) })
  }
  const standing = new Map()
  for (const o of owner) {
    if (o == null) continue
    standing.set(o.token, (standing.get(o.token) ?? 0) + 1)
  }
  const leaders = [...standing].map(([token, count]) => ({ token, count })).sort((a, b) => b.count - a.count || (a.token < b.token ? -1 : 1))
  return {
    board,
    ds: String(ds),
    cells,
    owner,
    leaders,
    painted: ordered.length,
    applied: ordered.length,
    ignored: named.length - ordered.length,
    disputes,
    lastPieceId: ordered.length > 0 ? String(ordered[ordered.length - 1].pieceId) : null,
  }
}
