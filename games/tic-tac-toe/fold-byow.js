/**
 * Tic-tac-toe under the BYOW engine: the board rules plus the shared
 * seat-owner sequencing from games/lib/byow-engine.js. Pure, no I/O.
 *
 * Move pieces: { v: 2, app, log, type: 'move', game, token, seq, prev, cell: 0..8, o? }
 */
import { foldByow as engine, lobbyByow as engineLobby } from '../lib/byow-engine.js'
import { initialState, winnerOf } from './fold.js'

export { dataSetsOf, homeLog, usable, V } from '../lib/byow-engine.js'

export const RULES = {
  initial: (game) => initialState(game),
  legal(state, piece) {
    const cell = piece.cell
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return false
    return state.board[cell] == null
  },
  place(state, seat, piece) {
    const board = state.board.slice()
    board[piece.cell] = seat
    return { ...state, board, next: seat === 'X' ? 'O' : 'X', seq: state.seq + 1, winner: winnerOf(board) }
  },
}

export const foldByow = (game, root, pieces) => engine(game, root, pieces, RULES)
export const lobbyByow = (pieces) => engineLobby(pieces, RULES)
