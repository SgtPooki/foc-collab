/**
 * A shared photo album as a fold over pieces. Pure, no I/O.
 *
 * Pieces reach the fold already opened (seal.open with the album key)
 * and signature-checked, so membership is implicit: a piece that did
 * not decrypt under the album key never arrives. The fold decides only
 * which of those pieces count.
 *
 * An album is (root, id): `root` is the data set of the wallet that
 * created it, `id` is random. Contributors write to their own data sets.
 *
 * Piece shapes (schema v2, app 'foc-album', signed inside the sealed box):
 *   { type: 'album', album, title }                  counts only in root; lowest piece id wins
 *   { type: 'photo', album, blob, thumb, w, h, caption? }
 *       blob: PieceCID of the sealed full-size photo (fetched on demand)
 *       thumb: base64url JPEG, small enough to ride in the log piece
 *   { type: 'remove', album, target }                target = a photo's ref
 *
 * Annotations expected from outside the signed body: src, pieceId, ref,
 * token. An author is (src, token). A photo is removed by its author or
 * by the album's owner (any identity writing in root).
 *
 * Order. Inside one data set piece id is exact; across data sets the fold
 * makes no claim. Photos come out grouped by data set (numerically) and in
 * piece id order within each; the page reorders them for display by block
 * hint, which is never fold input.
 */
export const APP = 'foc-album'
const MAX_TITLE = 80
const MAX_CAPTION = 200
const MAX_THUMB = 96 * 1024 // base64url characters; a 320px JPEG is ~20 KB

const isText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max
const byPieceId = (a, b) => Number(a.pieceId) - Number(b.pieceId)

export function usablePhoto(p, id) {
  if (p?.type !== 'photo' || p.album !== id) return false
  if (!isText(p.blob, 200) || !/^baf[a-z0-9]+$/.test(p.blob)) return false
  if (!isText(p.thumb, MAX_THUMB) || !/^[A-Za-z0-9_-]+$/.test(p.thumb)) return false
  if (!Number.isInteger(p.w) || !Number.isInteger(p.h) || p.w <= 0 || p.h <= 0) return false
  return p.caption === undefined || isText(p.caption, MAX_CAPTION)
}

/**
 * The album as the page shows it:
 *   { exists, title, photos: [{ ref, src, pieceId, token, blob, thumb, w, h, caption }], ignored }
 */
export function foldAlbum({ root, id }, pieces) {
  const mine = pieces.filter((p) => p != null && p.app === APP && p.v === 2 && p.album === id)
  const creation = mine.filter((p) => p.type === 'album' && p.src === String(root) && isText(p.title, MAX_TITLE)).sort(byPieceId)[0]
  const photos = mine.filter((p) => usablePhoto(p, id))
  const removals = mine.filter((p) => p.type === 'remove' && typeof p.target === 'string')

  const removed = new Set()
  for (const r of removals) {
    const photo = photos.find((p) => p.ref === r.target)
    if (photo == null) continue
    const byAuthor = r.src === photo.src && r.token === photo.token
    const byOwner = r.src === String(root)
    if (byAuthor || byOwner) removed.add(photo.ref)
  }

  const kept = photos
    .filter((p) => !removed.has(p.ref))
    .sort((a, b) => Number(a.src) - Number(b.src) || byPieceId(a, b))
    .map(({ ref, src, pieceId, token, blob, thumb, w, h, caption }) => ({ ref, src, pieceId, token, blob, thumb, w, h, caption }))
  const counted = (creation == null ? 0 : 1) + photos.length + removals.length
  return { exists: creation != null, title: creation?.title ?? null, photos: kept, ignored: mine.length - counted }
}
