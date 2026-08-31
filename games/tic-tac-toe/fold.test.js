import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fold, initialState, isLegal } from './fold.js'

const G = 'game-1'
const m = (seq, player, cell) => ({ game: G, seq, player, cell })

test('empty log yields empty board, X to move', () => {
  const s = fold(G, [])
  assert.deepEqual(s.board, Array(9).fill(null))
  assert.equal(s.next, 'X')
  assert.equal(s.winner, null)
})

test('alternating legal moves apply in order', () => {
  const s = fold(G, [m(0, 'X', 4), m(1, 'O', 0), m(2, 'X', 8)])
  assert.equal(s.board[4], 'X')
  assert.equal(s.board[0], 'O')
  assert.equal(s.board[8], 'X')
  assert.equal(s.next, 'O')
  assert.equal(s.applied.length, 3)
})

test('X wins on a row', () => {
  const s = fold(G, [m(0, 'X', 0), m(1, 'O', 3), m(2, 'X', 1), m(3, 'O', 4), m(4, 'X', 2)])
  assert.equal(s.winner, 'X')
})

test('draw is detected', () => {
  // X O X / X O O / O X X
  const s = fold(G, [
    m(0, 'X', 0), m(1, 'O', 1), m(2, 'X', 2),
    m(3, 'O', 4), m(4, 'X', 3), m(5, 'O', 5),
    m(6, 'X', 7), m(7, 'O', 6), m(8, 'X', 8),
  ])
  assert.equal(s.winner, 'draw')
})

test('out-of-turn move is ignored', () => {
  const s = fold(G, [m(0, 'X', 0), m(1, 'X', 1)])
  assert.equal(s.board[1], null)
  assert.equal(s.ignored.length, 1)
  assert.equal(s.next, 'O')
})

test('occupied cell is ignored', () => {
  const s = fold(G, [m(0, 'X', 4), m(1, 'O', 4)])
  assert.equal(s.board[4], 'X')
  assert.equal(s.ignored.length, 1)
})

test('conflicting claims to the same seq: first-by-ordering wins', () => {
  // Both pieces claim seq 1; whichever sorts first applies, the other is ignored.
  const s = fold(G, [m(0, 'X', 0), m(1, 'O', 1), m(1, 'O', 2)])
  assert.equal(s.board[1], 'O')
  assert.equal(s.board[2], null)
  assert.equal(s.ignored.length, 1)
})

test('moves after a win are ignored', () => {
  const s = fold(G, [
    m(0, 'X', 0), m(1, 'O', 3), m(2, 'X', 1), m(3, 'O', 4), m(4, 'X', 2),
    m(5, 'O', 5),
  ])
  assert.equal(s.winner, 'X')
  assert.equal(s.board[5], null)
})

test('wrong game id is ignored', () => {
  const s = fold(G, [{ game: 'other', seq: 0, player: 'X', cell: 0 }])
  assert.equal(s.applied.length, 0)
  assert.equal(s.ignored.length, 1)
})

test('garbage pieces are ignored, not fatal', () => {
  const s = fold(G, [null, {}, { game: G, seq: 0, player: 'X', cell: 99 }, m(0, 'X', 4)])
  assert.equal(s.board[4], 'X')
  assert.equal(s.ignored.length, 3)
})

test('isLegal rejects non-integer cells', () => {
  assert.equal(isLegal(initialState(G), { game: G, seq: 0, player: 'X', cell: 1.5 }), false)
})
