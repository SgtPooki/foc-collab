/**
 * Pure fold over an ordered move log. No mutation of prior state, no I/O.
 *
 * A move is a small JSON piece appended to shared storage by one player's
 * key. Every client fetches the same pieces, sorts them the same way, and
 * computes the same board. Illegal or out-of-turn moves are ignored by the
 * fold, so a misbehaving writer cannot corrupt anyone's board. Conflicts
 * (two pieces claiming the same turn) resolve first-by-ordering.
 *
 * Move piece shape:
 *   { game: string, seq: number, player: 'X' | 'O', cell: 0..8 }
 */

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6], // diagonals
]

export function initialState(game) {
  return {
    game,
    board: Array(9).fill(null),
    next: 'X',
    seq: 0,
    winner: null, // 'X' | 'O' | 'draw' | null
    applied: [],
    ignored: [],
  }
}

/** Returns true when the move is legal in this state. */
export function isLegal(state, move) {
  if (move == null || typeof move !== 'object') return false
  if (move.game !== state.game) return false
  if (state.winner != null) return false
  if (move.player !== state.next) return false
  if (move.seq !== state.seq) return false
  if (!Number.isInteger(move.cell) || move.cell < 0 || move.cell > 8) return false
  if (state.board[move.cell] != null) return false
  return true
}

function winnerOf(board) {
  for (const [a, b, c] of LINES) {
    if (board[a] != null && board[a] === board[b] && board[a] === board[c]) return board[a]
  }
  if (board.every((cell) => cell != null)) return 'draw'
  return null
}

/** Applies one move, returning new state. Illegal moves are recorded and skipped. */
export function apply(state, move) {
  if (!isLegal(state, move)) {
    return { ...state, ignored: [...state.ignored, move] }
  }
  const board = state.board.slice()
  board[move.cell] = move.player
  return {
    ...state,
    board,
    next: move.player === 'X' ? 'O' : 'X',
    seq: state.seq + 1,
    winner: winnerOf(board),
    applied: [...state.applied, move],
  }
}

/** Folds an ordered list of moves into a board state. */
export function fold(game, moves) {
  return moves.reduce(apply, initialState(game))
}
