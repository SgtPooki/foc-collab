/**
 * The jukebox: coins are Filecoin Pay deposits into the jukebox's till
 * (its own account); picks are signed pieces in the jukebox's sponsored data set.
 * Pure, no I/O.
 *
 * Inputs
 *   deposits  [{ from, amount (bigint), epoch }] from games/lib/coins.js
 *   pieces    the data set's pieces, verified (identity.js) and with
 *             wallet signatures checked (wallet-sig.js sets walletOk)
 *
 * Rules
 *   - credits(wallet) = floor(sum of that wallet's deposits / price)
 *   - a pick is { v: 2, app: 'foc-jukebox', log, type: 'pick', box, track, title?, wallet, walletSig, token }
 *     with track { kind: 'youtube', id } or { kind: 'url', url }
 *   - picks are walked in piece-id order (one data set, so that order is
 *     exact); a pick counts when its wallet signature verified and the
 *     wallet still has a credit; each counted pick spends one
 *   - the same wallet signature counts once, whatever piece id carries it:
 *     a re-appended pick is not a second play
 *   - the queue is the counted picks in piece-id order; there is no
 *     shared clock, so "now playing" is each listener's head of the
 *     queue among tracks they have not heard
 *
 * Annotations from outside the signed body: src, pieceId, ref, walletOk.
 */
export const V = 2
export const APP = 'foc-jukebox'
export const PRICE = 10n ** 18n // 1 USDFC a coin
export const MAX_TITLE = 80

const YT_ID = /^[A-Za-z0-9_-]{11}$/

function idOf(piece) {
  try {
    return BigInt(piece.pieceId)
  } catch {
    return null
  }
}

export function usableTrack(track) {
  if (track == null || typeof track !== 'object') return false
  if (track.kind === 'youtube') return typeof track.id === 'string' && YT_ID.test(track.id)
  if (track.kind === 'url') {
    if (typeof track.url !== 'string' || track.url.length > 2048) return false
    try {
      const u = new URL(track.url)
      return u.protocol === 'https:'
    } catch {
      return false
    }
  }
  return false
}

/** A usable pick for `box` from data set `ds` (wallet signature checked separately). */
export function usablePick(piece, box, ds) {
  if (piece == null || typeof piece !== 'object') return false
  if (piece.v !== V || piece.app !== APP || piece.type !== 'pick' || piece.box !== box) return false
  if (typeof piece.src !== 'string' || piece.src !== String(ds) || idOf(piece) == null) return false
  if (typeof piece.ref !== 'string' || typeof piece.token !== 'string' || piece.token === '') return false
  if (piece.log !== `byow:${piece.src}`) return false
  if (typeof piece.wallet !== 'string' || typeof piece.walletSig !== 'string') return false
  if (piece.title != null && (typeof piece.title !== 'string' || piece.title.length > MAX_TITLE)) return false
  return usableTrack(piece.track)
}

/** Credits per wallet (lowercased) from deposits at `price`. */
export function creditsOf(deposits, price = PRICE) {
  const paid = new Map()
  for (const d of deposits) {
    if (d == null || typeof d.from !== 'string' || typeof d.amount !== 'bigint' || d.amount <= 0n) continue
    const w = d.from.toLowerCase()
    paid.set(w, (paid.get(w) ?? 0n) + d.amount)
  }
  const credits = new Map()
  for (const [w, sum] of paid) credits.set(w, Number(sum / price))
  return credits
}

export function foldJukebox(box, ds, deposits, pieces, price = PRICE) {
  const named = pieces.filter((p) => p != null && typeof p === 'object' && p.box === box)
  const picks = named.filter((p) => usablePick(p, box, ds)).sort((a, b) => (idOf(a) < idOf(b) ? -1 : 1))
  const credits = creditsOf(deposits, price)
  const spent = new Map()
  const seenSig = new Set()
  const queue = []
  const unpaid = []
  for (const p of picks) {
    const w = p.wallet.toLowerCase()
    const sig = p.walletSig.toLowerCase()
    if (p.walletOk !== true || seenSig.has(sig)) continue
    seenSig.add(sig)
    const left = (credits.get(w) ?? 0) - (spent.get(w) ?? 0)
    if (left <= 0) {
      unpaid.push({ pieceId: String(p.pieceId), wallet: p.wallet })
      continue
    }
    spent.set(w, (spent.get(w) ?? 0) + 1)
    queue.push({
      pieceId: String(p.pieceId),
      ref: p.ref,
      wallet: p.wallet,
      track: p.track,
      title: typeof p.title === 'string' && p.title.trim() !== '' ? p.title.trim() : null,
    })
  }
  const balances = new Map()
  for (const [w, c] of credits) balances.set(w, c - (spent.get(w) ?? 0))
  return {
    box,
    ds: String(ds),
    queue,
    balances, // wallet (lowercase) -> credits left
    coins: deposits.length,
    applied: queue.length,
    ignored: named.length - queue.length,
    unpaid: unpaid.length,
  }
}
