/**
 * Connect four under the BYOW engine: the board rules plus the shared
 * seat-owner sequencing from games/lib/byow-engine.js. Pure, no I/O.
 *
 * Move pieces: { v: 2, app, log, type: 'move', game, token, seq, prev, col: 0..6, o? }
 */
import { foldByow as engine, lobbyByow as engineLobby } from '../lib/byow-engine.js'
import { COLS, ROWS, initialState, landingRow, resultOf } from './fold.js'

export { dataSetsOf, homeLog, seatOfHome, usable, V } from '../lib/byow-engine.js'

const idx = (col, row) => col * ROWS + row

export const RULES = {
  initial: (game) => initialState(game),
  legal(state, piece) {
    const col = piece.col
    if (!Number.isInteger(col) || col < 0 || col >= COLS) return false
    return landingRow(state.board, col) >= 0
  },
  place(state, seat, piece) {
    const board = state.board.slice()
    board[idx(piece.col, landingRow(board, piece.col))] = seat
    const { winner, winLine } = resultOf(board)
    return { ...state, board, next: seat === 'X' ? 'O' : 'X', seq: state.seq + 1, winner, winLine }
  },
}

export const foldByow = (game, root, pieces) => engine(game, root, pieces, RULES)
export const lobbyByow = (pieces) => engineLobby(pieces, RULES)
