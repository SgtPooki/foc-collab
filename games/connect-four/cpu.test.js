import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pickMove } from './cpu.js'
import { COLS, ROWS, initialState } from './fold.js'

const idx = (col, row) => col * ROWS + row
function board(drops) {
  const b = Array(COLS * ROWS).fill(null)
  for (const [col, row, seat] of drops) b[idx(col, row)] = seat
  return b
}
const at = (b, next) => ({ ...initialState('g'), board: b, next })

test('takes a vertical win', () => {
  const b = board([[0, 0, 'X'], [0, 1, 'X'], [0, 2, 'X'], [1, 0, 'O'], [1, 1, 'O']])
  assert.deepEqual(pickMove(at(b, 'X')), { col: 0, row: 3 })
})

test('blocks a horizontal threat', () => {
  const b = board([[0, 0, 'X'], [1, 0, 'X'], [2, 0, 'X'], [3, 1, 'O'], [4, 0, 'O']])
  assert.deepEqual(pickMove(at(b, 'O')), { col: 3, row: 0 })
})

test('opens in the middle and only picks legal columns', () => {
  assert.deepEqual(pickMove(at(board([]), 'X')), { col: 3, row: 0 })
  const full = board([])
  for (let row = 0; row < ROWS; row++) full[idx(3, row)] = row % 2 ? 'X' : 'O'
  const { col } = pickMove(at(full, 'X'))
  assert.notEqual(col, 3)
})
