/**
 * Pure fold over an ordered piece log. No mutation of prior state, no I/O.
 *
 * The log holds every game: `create` pieces register a game (the creator's
 * token takes seat X), the first `join` piece from a different token takes
 * seat O, and `move` pieces advance the board. Every client fetches the
 * same pieces in the same total order and computes the same lobby and
 * boards; illegal, out-of-turn, and impostor pieces are ignored by the
 * fold, so a misbehaving writer cannot corrupt anyone's view. Conflicts
 * (two pieces claiming the same turn or seat) resolve first-by-ordering.
 *
 * Piece shapes (token = the author's self-chosen random player id):
 *   { v: 1, type: 'create', game, token, name? }
 *   { v: 1, type: 'join',   game, token }
 *   { v: 1, type: 'move',   game, token, seq, cell: 0..8 }
 */

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6], // diagonals
]

export function initialState(game) {
  return {
    game,
    name: null,
    seats: { X: null, O: null }, // player tokens
    board: Array(9).fill(null),
    next: 'X',
    seq: 0,
    winner: null, // 'X' | 'O' | 'draw' | null
    applied: 0,
    ignored: 0,
  }
}

export function winnerOf(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] != null && board[a] === board[b] && board[a] === board[c]) return board[a]
  }
  if (board.every((cell) => cell != null)) return 'draw'
  return null
}

/** The seat a token owns in this state, or null. */
export function seatOf(state, token) {
  if (token != null && state.seats.X === token) return 'X'
  if (token != null && state.seats.O === token) return 'O'
  return null
}

export function status(state) {
  if (state.seats.X == null) return 'unregistered'
  if (state.winner === 'draw') return 'draw'
  if (state.winner === 'closed') return 'closed'
  if (state.winner != null) return `${state.winner} won${state.resigned != null ? ` (${state.resigned} resigned)` : ''}`
  if (state.seats.O == null) return 'waiting for opponent'
  return `${state.next} to move`
}

/** Applies one piece to one game's state; unrelated or illegal pieces are counted and skipped. */
export function apply(state, piece) {
  if (piece == null || typeof piece !== 'object' || piece.game !== state.game) return state
  if (piece.v !== 1) return { ...state, ignored: state.ignored + 1 }
  const ignore = () => ({ ...state, ignored: state.ignored + 1 })

  if (piece.type === 'create') {
    if (state.seats.X != null || typeof piece.token !== 'string' || piece.token === '') return ignore()
    return {
      ...state,
      name: typeof piece.name === 'string' ? piece.name : null,
      seats: { X: piece.token, O: null },
      applied: state.applied + 1,
    }
  }

  if (piece.type === 'join') {
    if (state.seats.X == null || state.seats.O != null) return ignore()
    if (typeof piece.token !== 'string' || piece.token === '' || piece.token === state.seats.X) return ignore()
    return { ...state, seats: { ...state.seats, O: piece.token }, applied: state.applied + 1 }
  }

  if (piece.type === 'move') {
    const seat = seatOf(state, piece.token)
    if (seat == null || state.seats.O == null) return ignore()
    if (state.winner != null || seat !== state.next || piece.seq !== state.seq) return ignore()
    if (!Number.isInteger(piece.cell) || piece.cell < 0 || piece.cell > 8) return ignore()
    if (state.board[piece.cell] != null) return ignore()
    const board = state.board.slice()
    board[piece.cell] = seat
    return {
      ...state,
      board,
      next: seat === 'X' ? 'O' : 'X',
      seq: state.seq + 1,
      winner: winnerOf(board),
      applied: state.applied + 1,
    }
  }

  return ignore()
}

/** Folds the full piece log into one game's state. */
export function fold(game, pieces) {
  return pieces.reduce(apply, initialState(game))
}

/** Folds the full piece log into every game's state, in creation order. */
export function lobby(pieces) {
  const games = new Map()
  for (const piece of pieces) {
    if (piece == null || typeof piece !== 'object' || typeof piece.game !== 'string') continue
    // Only a create piece allocates lobby state; junk aimed at ghost game
    // ids is dropped without allocating anything.
    if (!games.has(piece.game)) {
      if (piece.type !== 'create') continue
      games.set(piece.game, initialState(piece.game))
    }
    games.set(piece.game, apply(games.get(piece.game), piece))
  }
  return [...games.values()].filter((s) => s.seats.X != null)
}
