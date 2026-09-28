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
 *   { type: 'photo', album, blob, thumb, w, h, caption?, meta? }
 *       blob: PieceCID of the sealed full-size photo (fetched on demand)
 *       thumb: base64url JPEG, small enough to ride in the log piece
 *       meta: the EXIF fields its contributor chose to keep (exif.js):
 *             { taken?, camera?, lens?, gps?: { lat, lon } }; the image
 *             bytes themselves carry none (re-encoded through a canvas)
 *   { type: 'remove', album, target }                target = a photo's ref
 *
 * Annotations expected from outside the signed body: src, pieceId, ref,
 * token. An author is (src, token). A photo is removed by its author or
 * by the album's owner (any identity writing in root).
 *
 * Access. A link album seals everything under one album key that anyone
 * with the key holds. A members-only album seals under per-epoch keys that
 * only approved members receive; foldMembers below reads who they are
 * from public pieces, and foldAlbum then counts photos only from the
 * owner's data set and current members' data sets (`onlySrcs`).
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
const META_KEYS = ['taken', 'camera', 'lens', 'gps']

/** A photo's kept metadata: absent, or only known fields, each well formed. */
export function usableMeta(meta) {
  if (meta === undefined) return true
  if (meta == null || typeof meta !== 'object' || Array.isArray(meta)) return false
  if (Object.keys(meta).some((k) => !META_KEYS.includes(k))) return false
  if (meta.taken !== undefined && !(typeof meta.taken === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(meta.taken))) return false
  if (meta.camera !== undefined && !isText(meta.camera, 80)) return false
  if (meta.lens !== undefined && !isText(meta.lens, 80)) return false
  if (meta.gps === undefined) return true
  const { lat, lon } = meta.gps ?? {}
  return Object.keys(meta.gps ?? {}).length === 2 && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}
const byPieceId = (a, b) => Number(a.pieceId) - Number(b.pieceId)

export function usablePhoto(p, id) {
  if (p?.type !== 'photo' || p.album !== id) return false
  if (!isText(p.blob, 200) || !/^baf[a-z0-9]+$/.test(p.blob)) return false
  if (!isText(p.thumb, MAX_THUMB) || !/^[A-Za-z0-9_-]+$/.test(p.thumb)) return false
  if (!Number.isInteger(p.w) || !Number.isInteger(p.h) || p.w <= 0 || p.h <= 0) return false
  if (p.caption !== undefined && !isText(p.caption, MAX_CAPTION)) return false
  return usableMeta(p.meta)
}

/**
 * The album as the page shows it:
 *   { exists, title, photos: [{ ref, src, pieceId, token, blob, thumb, w, h, caption, meta, epoch }], ignored }
 * `epoch` is the membership epoch whose key sealed the photo (members-only
 * albums; the page annotates it from the outer piece), undefined otherwise.
 */
export function foldAlbum({ root, id }, pieces, { onlySrcs = null } = {}) {
  const mine = pieces.filter((p) => p != null && p.app === APP && p.v === 2 && p.album === id && (onlySrcs == null || onlySrcs.has(p.src)))
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
    .map(({ ref, src, pieceId, token, blob, thumb, w, h, caption, meta, epoch }) => ({ ref, src, pieceId, token, blob, thumb, w, h, caption, meta, epoch }))
  const counted = (creation == null ? 0 : 1) + photos.length + removals.length
  return { exists: creation != null, title: creation?.title ?? null, photos: kept, ignored: mine.length - counted }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const B64U_KEY = /^[A-Za-z0-9_-]{43}$/ // a 32-byte key, base64url
const B64U = /^[A-Za-z0-9_-]+$/

/**
 * Membership of a members-only album, from its public pieces. Pure.
 *
 *   { type: 'join', album, ds, wallet, enc, walletSig }   any data set
 *       a wallet asks to join and publishes its X25519 key (`enc`). The
 *       wallet signs the body (wallet-sig.js, annotated walletOk) and it
 *       must name the data set it sits in (`ds` = src), so a copy of
 *       someone's join in another data set counts for nothing.
 *   { type: 'keys', album, epoch, revoke?: [wallet], entries: [{ to, epk, box }] }
 *       root only, applied in piece id order (the one order the fold
 *       trusts); `revoke` removes wallets, each entry grants its `to`
 *       wallet the keyring for epochs 0..epoch. Epochs never go back.
 *
 * Returns { epoch, members, removed, requests, grants, memberSrcs, encOf }:
 *   epoch       the current membership epoch
 *   members     wallets (lowercase) granted and not removed since
 *   removed     wallets removed and not granted since
 *   requests    [{ wallet, enc, src }] joins by wallets never granted or removed
 *   grants      Map wallet -> { epoch, epk, box }: each member's latest grant
 *   memberSrcs  Set of data sets whose photos count: root and members' joins
 *   encOf       Map wallet -> the X25519 key from its first join (for re-granting)
 */
export function foldMembers({ root, id }, pieces) {
  const mine = pieces.filter((p) => p != null && p.app === APP && p.v === 2 && p.album === id)
  const keyPieces = mine
    .filter((p) => p.type === 'keys' && p.src === String(root) && usableKeys(p))
    .sort(byPieceId)
  const status = new Map() // wallet -> 'member' | 'removed'
  const grants = new Map()
  let epoch = 0
  for (const k of keyPieces) {
    if (k.epoch < epoch) continue
    epoch = k.epoch
    for (const w of k.revoke ?? []) {
      status.set(w.toLowerCase(), 'removed')
      grants.delete(w.toLowerCase())
    }
    for (const e of k.entries) {
      status.set(e.to.toLowerCase(), 'member')
      grants.set(e.to.toLowerCase(), { epoch: k.epoch, epk: e.epk, box: e.box })
    }
  }
  const joins = mine
    .filter((p) => p.type === 'join' && p.walletOk === true && ADDRESS.test(p.wallet ?? '') && B64U_KEY.test(p.enc ?? '') && p.ds === p.src)
    .sort((a, b) => Number(a.src) - Number(b.src) || byPieceId(a, b))
  const memberSrcs = new Set([String(root)])
  const requests = []
  const asked = new Set()
  const encOf = new Map()
  for (const j of joins) {
    const w = j.wallet.toLowerCase()
    if (!encOf.has(w)) encOf.set(w, j.enc)
    if (status.get(w) === 'member') memberSrcs.add(j.src)
    if (!status.has(w) && !asked.has(w)) {
      asked.add(w)
      requests.push({ wallet: w, enc: j.enc, src: j.src })
    }
  }
  const walletsWith = (s) => [...status].filter(([, v]) => v === s).map(([w]) => w)
  return { epoch, members: walletsWith('member'), removed: walletsWith('removed'), requests, grants, memberSrcs, encOf }
}

function usableKeys(p) {
  if (!Number.isInteger(p.epoch) || p.epoch < 0 || !Array.isArray(p.entries)) return false
  if (p.revoke !== undefined && !(Array.isArray(p.revoke) && p.revoke.every((w) => ADDRESS.test(w ?? '')))) return false
  return p.entries.every((e) => ADDRESS.test(e?.to ?? '') && B64U_KEY.test(e.epk ?? '') && B64U.test(e.box ?? ''))
}
