/**
 * The computer's move picker for connect four: negamax to a fixed depth
 * with a simple line-count heuristic. Beatable, not trivial. Pure: board
 * in, column out. Same seam as tic-tac-toe/cpu.js; a learned picker can
 * replace it later (issue #2).
 */
import { COLS, ROWS, landingRow, resultOf } from './fold.js'

const DEPTH = 4
const idx = (col, row) => col * ROWS + row
const other = (seat) => (seat === 'X' ? 'O' : 'X')
// Middle columns first: better pruning and a sensible fallback order.
const ORDER = [3, 2, 4, 1, 5, 0, 6]

function lines() {
  const out = []
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      if (row + 3 < ROWS) out.push([idx(col, row), idx(col, row + 1), idx(col, row + 2), idx(col, row + 3)])
      if (col + 3 < COLS) out.push([idx(col, row), idx(col + 1, row), idx(col + 2, row), idx(col + 3, row)])
      if (col + 3 < COLS && row + 3 < ROWS) out.push([idx(col, row), idx(col + 1, row + 1), idx(col + 2, row + 2), idx(col + 3, row + 3)])
      if (col + 3 < COLS && row >= 3) out.push([idx(col, row), idx(col + 1, row - 1), idx(col + 2, row - 2), idx(col + 3, row - 3)])
    }
  }
  return out
}
const LINES = lines()

/** Positive when `me` has more open threats than the opponent. */
function heuristic(board, me) {
  let total = 0
  for (const line of LINES) {
    let mine = 0
    let theirs = 0
    for (const i of line) {
      if (board[i] === me) mine++
      else if (board[i] != null) theirs++
    }
    if (mine > 0 && theirs > 0) continue
    if (mine > 0) total += mine * mine
    if (theirs > 0) total -= theirs * theirs
  }
  return total
}

function negamax(board, me, turn, depth, alpha, beta) {
  const { winner } = resultOf(board)
  if (winner === 'draw') return 0
  if (winner != null) return winner === turn ? 1000 + depth : -(1000 + depth)
  if (depth === 0) return turn === me ? heuristic(board, me) : -heuristic(board, me)
  let best = -Infinity
  for (const col of ORDER) {
    const row = landingRow(board, col)
    if (row < 0) continue
    board[idx(col, row)] = turn
    const s = -negamax(board, me, other(turn), depth - 1, -beta, -alpha)
    board[idx(col, row)] = null
    if (s > best) best = s
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }
  return best
}

/** The column (and landing row) the computer drops in for `state.next`, or null when the game is over. */
export function pickMove(state) {
  if (state.winner != null) return null
  const me = state.next
  const board = state.board.slice()
  let bestCol = null
  let bestScore = -Infinity
  for (const col of ORDER) {
    const row = landingRow(board, col)
    if (row < 0) continue
    board[idx(col, row)] = me
    const s = -negamax(board, me, other(me), DEPTH - 1, -Infinity, Infinity)
    board[idx(col, row)] = null
    if (s > bestScore) {
      bestScore = s
      bestCol = col
    }
  }
  return bestCol == null ? null : { col: bestCol, row: landingRow(board, bestCol) }
}
