import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickMove } from './cpu.js'
import { initialState, winnerOf } from './fold.js'

const at = (board, next) => ({ ...initialState('g'), board, next })
const _ = null

test('takes a win when it has one', () => {
  assert.deepEqual(pickMove(at(['X', 'X', _, 'O', 'O', _, _, _, _], 'X')), { cell: 2 })
  assert.deepEqual(pickMove(at(['X', 'X', _, 'O', 'O', _, _, _, _], 'O')), { cell: 5 })
})

test('blocks an immediate loss', () => {
  assert.deepEqual(pickMove(at(['X', 'X', _, _, 'O', _, _, _, _], 'O')), { cell: 2 })
})

test('never loses against every legal opponent line (exhaustive as O)', () => {
  let games = 0
  const play = (board, turn) => {
    const w = winnerOf(board)
    if (w != null) { games++; assert.notEqual(w, 'X', `lost on ${board.join('')}`); return }
    if (turn === 'O') {
      const { cell } = pickMove(at(board, 'O'))
      const next = board.slice(); next[cell] = 'O'
      play(next, 'X')
      return
    }
    for (let i = 0; i < 9; i++) {
      if (board[i] != null) continue
      const next = board.slice(); next[i] = 'X'
      play(next, 'O')
    }
  }
  play(Array(9).fill(null), 'X')
  assert.ok(games > 100)
})

test('returns null when the game is over', () => {
  assert.equal(pickMove({ ...at(['X', 'X', 'X', 'O', 'O', _, _, _, _], 'O'), winner: 'X' }), null)
})
