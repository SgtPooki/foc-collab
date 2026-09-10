import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ROWS, seatOf, status } from './fold.js'
import { foldByow, homeLog } from './fold-byow.js'

const G = 'game-c4'
const A = 'token-alice'
const B = 'token-bob'
const DS_A = '100'
const DS_B = '200'
const idx = (col, row) => col * ROWS + row

let nextId = {}
function piece(src, body, ref) {
  nextId[src] ??= 1n
  return { v: 2, app: 'foc-connect-four', log: homeLog(src), game: G, ...body, src, pieceId: nextId[src]++, ref }
}
function opening() {
  nextId = {}
  const c = piece(DS_A, { type: 'create', token: A }, 'c')
  const j = piece(DS_B, { type: 'join', token: B, prev: 'c' }, 'j')
  const r = piece(DS_A, { type: 'move', token: A, seq: 0, col: 3, prev: 'j', o: { token: B, ds: DS_B } }, 'm0')
  return { c, j, r }
}
const move = (src, token, seq, col, prev, ref) => piece(src, { type: 'move', token, seq, col, prev }, ref)

test('discs stack in a column and the game converges regardless of listing order', () => {
  const { c, j, r } = opening()
  const m1 = move(DS_B, B, 1, 3, 'm0', 'm1')
  const m2 = move(DS_A, A, 2, 3, 'm1', 'm2')
  const pieces = [m2, j, m1, c, r]
  const s = foldByow(G, DS_A, pieces)
  assert.deepEqual(s, foldByow(G, DS_A, pieces.slice().reverse()))
  assert.equal(seatOf(s, B), 'O')
  assert.equal(s.board[idx(3, 0)], 'X')
  assert.equal(s.board[idx(3, 1)], 'O')
  assert.equal(s.board[idx(3, 2)], 'X')
  assert.equal(s.next, 'O')
  assert.equal(s.ignored, 0)
})

test('a full column, an out-of-range column, and a stale prev are ignored; play continues to a win', () => {
  const { c, j, r } = opening()
  const pieces = [c, j, r]
  let prev = 'm0'
  let seq = 1
  // fill column 0 with alternating discs starting with O
  for (let i = 0; i < 6; i++) {
    const who = i % 2 === 0 ? [DS_B, B] : [DS_A, A]
    const m = move(who[0], who[1], seq, 0, prev, `f${i}`)
    pieces.push(m)
    prev = m.ref
    seq++
  }
  // six discs later it is O's turn again
  const full = move(DS_B, B, seq, 0, prev, 'full') // column 0 is full: ignored
  const wide = move(DS_B, B, seq, 7, prev, 'wide')
  const stale = move(DS_B, B, seq, 1, 'nope', 'stale')
  const good = move(DS_B, B, seq, 1, prev, 'good')
  const s = foldByow(G, DS_A, [...pieces, full, wide, stale, good])
  assert.equal(s.board[idx(1, 0)], 'O')
  assert.equal(s.ignored, 3)
  assert.equal(s.lastRef, 'good')
})

test('four in a row ends the game; later drops are ignored', () => {
  const { c, j, r } = opening() // X at col 3
  const plan = [[DS_B, B, 0], [DS_A, A, 4], [DS_B, B, 0], [DS_A, A, 5], [DS_B, B, 0], [DS_A, A, 6]] // X: 3,4,5,6 bottom row
  const pieces = [c, j, r]
  let prev = 'm0'
  plan.forEach(([src, token, col], i) => {
    const m = move(src, token, i + 1, col, prev, `p${i}`)
    pieces.push(m)
    prev = m.ref
  })
  const after = move(DS_B, B, plan.length + 1, 1, prev, 'after')
  const s = foldByow(G, DS_A, [...pieces, after])
  assert.equal(s.winner, 'X')
  assert.equal(status(s), 'X won')
  assert.deepEqual(s.winLine, [idx(3, 0), idx(4, 0), idx(5, 0), idx(6, 0)])
  assert.equal(s.board[idx(1, 0)], null)
})
