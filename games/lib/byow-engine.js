/**
 * BYOW fold engine (schema v2): seat-owner sequencing over per-player data
 * sets, generic over the board rules. Pure and synchronous. No I/O, no
 * clocks, no hashing. Each game supplies `rules`:
 *
 *   rules.initial(game)         -> the game's own initial state (board, next, seq, winner, ...)
 *   rules.legal(state, piece)   -> true when the move piece is playable on this board
 *   rules.place(state, seat, piece) -> the state after the move (board, next, seq, winner)
 *
 * and gets back the same seat-owner sequencing for free.
 *
 * Each player writes only to their own Filecoin Onchain Cloud data set, so
 * there is no single log to order by piece id. What FOC does give is a
 * chain-assigned total order INSIDE each data set. This fold uses only
 * that plus signed fields:
 *
 *   - A game is identified by (game, root): the data set the creator wrote
 *     the `create` piece to. Lowest piece id `create` in the root wins X.
 *   - Any other data set appends `join` with prev = ref(create). Every
 *     such join is a candidate for O.
 *   - X's first move (seq 0) ratifies O: prev = ref(join), and `o`
 *     repeats the join's { token, ds } so a reader who only knows the root
 *     can discover O's data set. Lowest piece id among X's qualifying
 *     seq-0 pieces wins, and cannot be undercut later: ids only grow.
 *   - Move k is accepted only from the seat whose turn it is, from that
 *     seat's home data set, with prev = ref(accepted move k-1), if the
 *     board move is legal; lowest piece id among qualifying pieces wins.
 *   - Home binding is signed: log must equal `byow:<src>` where src is
 *     the data set the transport read the piece from. Replaying someone's
 *     signed piece into another data set changes nothing.
 *
 * A seat is owned by a home data set, not by a signing token. Writing to
 * a data set already requires its owner's session key, so the data set is
 * the player; the token only proves the piece was not altered in flight.
 * The same wallet in a new browser (new token, same data set) is still the
 * same player. `seats` keeps the token that wrote each seat's first piece
 * for display; `homes` is what ownership checks use.
 *
 * Annotations expected from outside the signed body (added by the
 * transport and by signature verification, never by the author):
 *   src      data set id the piece was listed from (string)
 *   pieceId  the chain-assigned id inside that data set (bigint-able)
 *   ref      sha256 of the canonical signed body (see identity.js)
 *
 * Solo games: a `create` piece may carry `cpu`, the token of a second
 * identity in the same browser that plays O. Both seats then live in the
 * root data set, where piece id is a total order, and the fold tells the
 * two writers apart by token. No join, no ratification, no second data
 * set: a solo game costs only its own pieces.
 *
 * Resigning: a `resign` piece from a seat's home data set ends the game.
 * After ratification the other seat wins (`resigned` names who left);
 * before it, a resign from the root closes the game (`closed: true`,
 * winner 'closed') so lobbies can drop it. The log keeps everything;
 * nothing is deleted, the fold just knows the game is over.
 *
 * Piece shapes:
 *   { v: 2, app, log, type: 'create', game, token, name?, cpu? }
 *   { v: 2, app, log, type: 'resign', game, token }
 *   { v: 2, app, log, type: 'join',   game, token, prev }
 *   { v: 2, app, log, type: 'move',   game, token, seq, prev, cell, o? }
 *     o = { token, ds } only on seq 0 (the ratification)
 *   { v: 2, app, log, type: 'announce', game, token, root, ds, role }
 *     discovery only, written to a rendezvous data set; never folded
 */
export const V = 2

/** The `log` value a piece must carry to count as written to data set `ds`. */
export function homeLog(ds) {
  return `byow:${ds}`
}

export function initialByowState(game, root, rules) {
  return {
    ...rules.initial(game),
    v: V,
    root: String(root),
    homes: { X: String(root), O: null }, // data set ids
    joins: [], // candidate joiners before ratification: { token, ds, ref }
    hints: [], // data sets named by X's ratification pieces; a root-only reader must fetch them
    solo: false, // O is a bot identity in the creator's browser, writing to the same data set
    closed: false, // the creator resigned before anyone was seated
    resigned: null, // the seat that resigned a ratified game
    ratified: false,
    lastRef: null,
  }
}

function idOf(piece) {
  try {
    return BigInt(piece.pieceId)
  } catch {
    return null
  }
}

function compareIds(a, b) {
  const x = idOf(a)
  const y = idOf(b)
  if (x < y) return -1
  if (x > y) return 1
  return 0
}

function bySrcThenId(a, b) {
  if (a.src < b.src) return -1
  if (a.src > b.src) return 1
  return compareIds(a, b)
}

/** True when a piece carries everything the v2 rules need and is bound to its own data set. */
export function usable(piece, game) {
  if (piece == null || typeof piece !== 'object') return false
  if (piece.v !== V || piece.game !== game) return false
  if (piece.type === 'announce') return false // discovery only, never folded
  if (typeof piece.src !== 'string' || piece.src === '' || idOf(piece) == null) return false
  if (typeof piece.ref !== 'string' || piece.ref === '') return false
  if (typeof piece.token !== 'string' || piece.token === '') return false
  return piece.log === homeLog(piece.src)
}

function placeMove(state, seat, piece, rules) {
  return {
    ...rules.place(state, seat, piece),
    lastRef: piece.ref,
    applied: state.applied + 1,
  }
}

function joinMatchesRatification(join, move) {
  if (join == null || move.o == null || typeof move.o !== 'object') return false
  return String(move.o.ds) === join.ds
}

/** The seat whose home data set is `ds`, or null. This is how a BYOW page learns who it is. */
export function seatOfHome(state, ds) {
  if (ds == null || state?.homes == null) return null
  const home = String(ds)
  if (state.homes.X === home) return 'X'
  if (state.homes.O === home) return 'O'
  return null
}

/** Folds pieces from any number of data sets into one game's state under `rules`. */
export function foldByow(game, root, pieces, rules) {
  const rootId = String(root)
  let state = initialByowState(game, rootId, rules)
  const all = pieces.filter((p) => usable(p, game)).sort(bySrcThenId)
  const finish = (s) => ({ ...s, ignored: all.length - s.applied })

  const create = all.find((p) => p.type === 'create' && p.src === rootId)
  if (create == null) return finish(state)
  state = {
    ...state,
    name: typeof create.name === 'string' ? create.name : null,
    seats: { X: create.token, O: null },
    lastRef: create.ref,
    applied: 1,
  }

  if (soloOpponent(create) != null) {
    state = {
      ...state,
      seats: { X: create.token, O: create.cpu },
      homes: { X: rootId, O: rootId },
      solo: true,
      ratified: true,
    }
    return finish(withResign(state, all, rules))
  }

  const joins = all
    .filter((p) => p.type === 'join' && p.prev === create.ref && p.src !== rootId)
    .map((p) => ({ token: p.token, ds: p.src, ref: p.ref }))
  state = { ...state, joins, applied: state.applied + joins.length }

  const ratifications = all.filter((p) => p.type === 'move' && p.src === rootId && p.seq === 0)
  const hints = ratifications
    .map((p) => (typeof p.o?.ds === 'string' || typeof p.o?.ds === 'number' ? String(p.o.ds) : null))
    .filter((ds) => ds != null && ds !== '')
  state = { ...state, hints: [...new Set(hints)] }
  for (const move of ratifications) {
    const join = joins.find((j) => j.ref === move.prev)
    if (!joinMatchesRatification(join, move) || !rules.legal(state, move)) continue
    state = {
      ...state,
      seats: { X: create.token, O: join.token },
      homes: { X: rootId, O: join.ds },
      joins: [join],
      ratified: true,
      applied: 1 + 1, // create + the ratified join; other joins are now ignored
    }
    state = placeMove(state, 'X', move, rules)
    break
  }
  if (!state.ratified) return finish(closed(state, all))
  return finish(withResign(state, all, rules))
}

/** An unratified game whose creator resigned from the root is closed. */
function closed(state, all) {
  const quit = all.find((p) => p.type === 'resign' && p.src === state.root)
  if (quit == null) return state
  return { ...state, closed: true, winner: 'closed', applied: state.applied + 1 }
}

/**
 * Plays a ratified game, honoring a resign. The first resign from either
 * home (by token when both seats share a home) takes effect at its piece
 * id: that seat's later pieces do not count, and if the board is not
 * already decided the other seat wins.
 */
function withResign(state, all, rules) {
  const seatOfPiece = (p) => {
    if (state.homes.X === state.homes.O) return p.token === state.seats.X ? 'X' : (p.token === state.seats.O ? 'O' : null)
    if (p.src === state.homes.X) return 'X'
    return p.src === state.homes.O ? 'O' : null
  }
  const quit = all.find((p) => p.type === 'resign' && seatOfPiece(p) != null)
  if (quit == null) return playMoves(state, all, rules)
  const seat = seatOfPiece(quit)
  const before = all.filter((p) => !(seatOfPiece(p) === seat && idOf(p) > idOf(quit)))
  const played = playMoves(state, before, rules)
  if (played.winner != null) return played
  return { ...played, winner: seat === 'X' ? 'O' : 'X', resigned: seat, applied: played.applied + 1 }
}

/** The bot token of a solo create piece, or null. It must differ from the creator's. */
function soloOpponent(create) {
  if (typeof create.cpu !== 'string' || create.cpu === '' || create.cpu === create.token) return null
  return create.cpu
}

/**
 * Applies moves in turn order from the ratified position. A move counts
 * only from the seat's home data set; when both seats share one data set
 * (solo games) the signing token tells them apart as well.
 */
function playMoves(state, all, rules) {
  const shared = state.homes.X === state.homes.O
  for (;;) {
    if (state.winner != null) break
    const seat = state.next
    const move = all.find((p) => p.type === 'move' && p.src === state.homes[seat]
      && (!shared || p.token === state.seats[seat])
      && p.seq === state.seq && p.prev === state.lastRef && rules.legal(state, p))
    if (move == null) break
    state = placeMove(state, seat, move, rules)
  }
  return state
}

/** Every game whose create piece is in one of the listed data sets, creation order per data set. */
export function lobbyByow(pieces, rules) {
  const roots = new Map()
  for (const p of [...pieces].filter((p) => usable(p, p?.game) && p.type === 'create').sort(bySrcThenId)) {
    const key = `${p.game}@${p.src}`
    if (!roots.has(key)) roots.set(key, { game: p.game, root: p.src })
  }
  return [...roots.values()].map(({ game, root }) => foldByow(game, root, pieces, rules))
}

/**
 * Data sets a reader must list to follow this game. A reader that knows
 * only the root sees X's ratification piece, which names O's data set
 * (`hints`); after listing that, the join itself is visible and the fold
 * ratifies. Two polls, no side channel.
 */
export function dataSetsOf(state) {
  const sets = new Set([state.root])
  if (state.homes.O != null) sets.add(state.homes.O)
  for (const join of state.joins) sets.add(join.ds)
  for (const ds of state.hints) sets.add(ds)
  return [...sets]
}
