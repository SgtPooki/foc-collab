/**
 * A chat room as a fold over piece logs. Pure, no I/O.
 *
 * A room is named by the `game` tag its pieces carry (so a game id is a
 * room, and "lobby" is the site-wide one). Anyone may post: a wallet
 * player writes to their own data set; a guest writes to the arcade's
 * sponsored data set through its authorizer. The fold does not care
 * which; it only needs the transport's annotations (src, pieceId) and
 * the verified signing token.
 *
 * Ordering. Inside one data set piece id is exact and is the only order
 * the fold uses: a post's `seq` is its rank among that author's posts in
 * that room. Across data sets the fold makes no claim; `displayOrder`
 * below interleaves authors by the PieceAdded block number the page got
 * from discovery, which is a hint for reading, never fold input.
 *
 * Piece shapes (schema v2, app 'foc-chat'):
 *   { v: 2, app: 'foc-chat', log, type: 'post', room, text, name?, token }
 *   { v: 2, app: 'foc-chat', log, type: 'link', wallet, walletSig, token }
 *
 * A link binds a signing token to a wallet: the wallet signs the body
 * (wallet-sig.js) and the fold trusts the `walletOk` annotation that
 * verification adds. From then on that (data set, token)'s posts carry
 * the wallet. It costs the guest one wallet prompt and one piece, no
 * session key and no data set. Links are not room-scoped.
 *
 * Annotations expected from outside the signed body: src, pieceId, ref,
 * walletOk. An author is (src, token): the data set plus the signing
 * identity, so guests sharing the sponsored data set are still distinct.
 */
export const V = 2
export const APP = 'foc-chat'
export const MAX_TEXT = 280
export const MAX_NAME = 24

function idOf(piece) {
  try {
    return BigInt(piece.pieceId)
  } catch {
    return null
  }
}

/** A usable post for `room`: right schema, bound to its own data set, with text. */
export function usablePost(piece, room) {
  if (piece == null || typeof piece !== 'object') return false
  if (piece.v !== V || piece.app !== APP || piece.type !== 'post' || piece.room !== room) return false
  if (typeof piece.src !== 'string' || piece.src === '' || idOf(piece) == null) return false
  if (typeof piece.ref !== 'string' || typeof piece.token !== 'string' || piece.token === '') return false
  if (piece.log !== `byow:${piece.src}`) return false
  if (typeof piece.text !== 'string' || piece.text.trim() === '' || piece.text.length > MAX_TEXT) return false
  if (piece.name != null && (typeof piece.name !== 'string' || piece.name.length > MAX_NAME)) return false
  return true
}

export function authorKey(piece) {
  return `${piece.src}:${piece.token}`
}

/** A usable link: right schema, bound to its data set, wallet signature verified. */
export function usableLink(piece) {
  if (piece == null || typeof piece !== 'object') return false
  if (piece.v !== V || piece.app !== APP || piece.type !== 'link') return false
  if (typeof piece.src !== 'string' || piece.src === '' || idOf(piece) == null) return false
  if (typeof piece.token !== 'string' || piece.token === '' || piece.log !== `byow:${piece.src}`) return false
  if (typeof piece.wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(piece.wallet)) return false
  return piece.walletOk === true
}

/** author key -> wallet, the lowest piece id link per author winning (ids only grow, so it cannot be undercut). */
export function linksOf(pieces) {
  const links = new Map()
  const best = new Map()
  for (const p of pieces) {
    if (!usableLink(p)) continue
    const key = authorKey(p)
    const id = idOf(p)
    if (!best.has(key) || id < best.get(key)) {
      best.set(key, id)
      links.set(key, p.wallet)
    }
  }
  return links
}

/**
 * Folds pieces into a room: posts grouped per author in piece-id order,
 * each with its rank (`seq`) among that author's posts. `ignored` counts
 * pieces that named this room but did not qualify.
 */
export function foldRoom(room, pieces) {
  const links = linksOf(pieces)
  const named = pieces.filter((p) => p != null && typeof p === 'object' && p.room === room)
  const posts = named.filter((p) => usablePost(p, room))
  const byAuthor = new Map()
  for (const p of posts) {
    const key = authorKey(p)
    if (!byAuthor.has(key)) byAuthor.set(key, [])
    byAuthor.get(key).push(p)
  }
  const messages = []
  for (const [author, list] of byAuthor) {
    list.sort((a, b) => (idOf(a) < idOf(b) ? -1 : 1))
    list.forEach((p, i) => messages.push({
      author,
      src: p.src,
      token: p.token,
      pieceId: String(p.pieceId),
      ref: p.ref,
      seq: i,
      name: typeof p.name === 'string' && p.name.trim() !== '' ? p.name.trim() : null,
      wallet: links.get(author) ?? null,
      text: p.text,
    }))
  }
  return { room, messages, authors: byAuthor.size, applied: posts.length, ignored: named.length - posts.length, links: links.size }
}

/**
 * Display order across authors: by the block number the page learned
 * for (src, pieceId) from PieceAdded events, then by data set and piece
 * id so the result is stable. Unknown blocks sort last. A hint for
 * reading; it changes nothing in the fold.
 */
export function displayOrder(messages, blockOf) {
  const key = (m) => {
    const b = blockOf?.(m.src, m.pieceId)
    return b == null ? Infinity : Number(b)
  }
  return messages.slice().sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    if (ka !== kb) return ka - kb
    if (a.src !== b.src) return a.src < b.src ? -1 : 1
    return BigInt(a.pieceId) < BigInt(b.pieceId) ? -1 : 1
  })
}

/** Every room seen in these pieces, with post counts, most posts first. */
export function rooms(pieces) {
  const counts = new Map()
  for (const p of pieces) {
    if (p == null || typeof p !== 'object' || typeof p.room !== 'string') continue
    if (!usablePost(p, p.room)) continue
    counts.set(p.room, (counts.get(p.room) ?? 0) + 1)
  }
  return [...counts].map(([room, posts]) => ({ room, posts })).sort((a, b) => b.posts - a.posts || (a.room < b.room ? -1 : 1))
}
