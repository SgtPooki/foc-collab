/**
 * The computer's move picker for tic-tac-toe: full minimax, so it never
 * loses. Pure: board in, cell out. This is the seam a learned picker
 * replaces later (issue #2); the page only calls pickMove(state).
 */
import { winnerOf } from './fold.js'

const other = (seat) => (seat === 'X' ? 'O' : 'X')

function score(board, me, turn, depth) {
  const w = winnerOf(board)
  if (w === me) return 10 - depth
  if (w === 'draw') return 0
  if (w != null) return depth - 10
  let best = turn === me ? -Infinity : Infinity
  for (let i = 0; i < 9; i++) {
    if (board[i] != null) continue
    board[i] = turn
    const s = score(board, me, other(turn), depth + 1)
    board[i] = null
    best = turn === me ? Math.max(best, s) : Math.min(best, s)
  }
  return best
}

/** The cell the computer plays for `state.next`, or null when the game is over. */
export function pickMove(state) {
  if (state.winner != null) return null
  const me = state.next
  const board = state.board.slice()
  let bestCell = null
  let bestScore = -Infinity
  for (let i = 0; i < 9; i++) {
    if (board[i] != null) continue
    board[i] = me
    const s = score(board, me, other(me), 1)
    board[i] = null
    if (s > bestScore) {
      bestScore = s
      bestCell = i
    }
  }
  return bestCell == null ? null : { cell: bestCell }
}
