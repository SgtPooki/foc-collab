import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fold, lobby, seatOf, status, COLS, ROWS } from './fold.js'

const G = 'game-1'
const A = 'token-alice'
const B = 'token-bob'
const C = 'token-carol'
const create = (game = G, token = A, name) => ({ v: 1, type: 'create', game, token, name })
const join = (token = B, game = G) => ({ v: 1, type: 'join', game, token })
const move = (token, seq, col, game = G) => ({ v: 1, type: 'move', game, token, seq, col })
const idx = (col, row) => col * ROWS + row

const opening = [create(), join()]

test('empty log: game unregistered', () => {
  const s = fold(G, [])
  assert.equal(status(s), 'unregistered')
  assert.equal(s.board.length, COLS * ROWS)
})

test('create assigns X to creator, waiting for opponent', () => {
  const s = fold(G, [create(G, A, 'connect four')])
  assert.equal(seatOf(s, A), 'X')
  assert.equal(s.name, 'connect four')
  assert.equal(status(s), 'waiting for opponent')
})

test('first join from a different token takes O; later joins ignored', () => {
  const s = fold(G, [create(), join(B), join(C)])
  assert.equal(seatOf(s, B), 'O')
  assert.equal(seatOf(s, C), null)
  assert.equal(s.ignored, 1)
})

test('creator cannot join their own game', () => {
  const s = fold(G, [create(), join(A)])
  assert.equal(s.seats.O, null)
  assert.equal(s.ignored, 1)
})

test('second create for the same game is ignored (seat X not stolen)', () => {
  const s = fold(G, [create(G, A), create(G, C)])
  assert.equal(seatOf(s, A), 'X')
  assert.equal(seatOf(s, C), null)
})

test('no moves before an opponent joins', () => {
  const s = fold(G, [create(), move(A, 0, 3)])
  assert.equal(s.board[idx(3, 0)], null)
  assert.equal(s.ignored, 1)
})

test('discs fall to the lowest empty row and stack upward', () => {
  const s = fold(G, [...opening, move(A, 0, 3), move(B, 1, 3), move(A, 2, 3)])
  assert.deepEqual([s.board[idx(3, 0)], s.board[idx(3, 1)], s.board[idx(3, 2)]], ['X', 'O', 'X'])
  assert.equal(s.board[idx(3, 3)], null)
  assert.equal(s.next, 'O')
})

test('four in a row horizontally wins', () => {
  const s = fold(G, [...opening,
    move(A, 0, 0), move(B, 1, 4),
    move(A, 2, 1), move(B, 3, 5),
    move(A, 4, 2), move(B, 5, 6),
    move(A, 6, 3),
  ])
  assert.equal(s.winner, 'X')
  assert.equal(status(s), 'X won')
})

test('four stacked vertically wins', () => {
  const s = fold(G, [...opening,
    move(A, 0, 0), move(B, 1, 1),
    move(A, 2, 0), move(B, 3, 2),
    move(A, 4, 0), move(B, 5, 3),
    move(A, 6, 0),
  ])
  assert.equal(s.winner, 'X')
  assert.deepEqual([s.board[idx(0, 0)], s.board[idx(0, 1)], s.board[idx(0, 2)], s.board[idx(0, 3)]], ['X', 'X', 'X', 'X'])
})

test('four on an ascending diagonal wins', () => {
  const s = fold(G, [...opening,
    move(A, 0, 0), move(B, 1, 1),
    move(A, 2, 1), move(B, 3, 2),
    move(A, 4, 2), move(B, 5, 3),
    move(A, 6, 2), move(B, 7, 3),
    move(A, 8, 3), move(B, 9, 0),
    move(A, 10, 3),
  ])
  assert.equal(s.winner, 'X')
  assert.deepEqual([s.board[idx(0, 0)], s.board[idx(1, 1)], s.board[idx(2, 2)], s.board[idx(3, 3)]], ['X', 'X', 'X', 'X'])
})

test('four on a descending diagonal wins', () => {
  const s = fold(G, [...opening,
    move(A, 0, 3), move(B, 1, 2),
    move(A, 2, 2), move(B, 3, 1),
    move(A, 4, 1), move(B, 5, 0),
    move(A, 6, 1), move(B, 7, 4),
    move(A, 8, 0), move(B, 9, 5),
    move(A, 10, 0), move(B, 11, 6),
    move(A, 12, 0),
  ])
  assert.equal(s.winner, 'X')
  assert.deepEqual([s.board[idx(0, 3)], s.board[idx(1, 2)], s.board[idx(2, 1)], s.board[idx(3, 0)]], ['X', 'X', 'X', 'X'])
})

test('moves after the win are ignored', () => {
  const s = fold(G, [...opening,
    move(A, 0, 0), move(B, 1, 1),
    move(A, 2, 0), move(B, 3, 2),
    move(A, 4, 0), move(B, 5, 3),
    move(A, 6, 0), // X wins vertically
    move(B, 7, 0), // ignored: game over
  ])
  assert.equal(s.winner, 'X')
  assert.equal(s.seq, 7)
  assert.equal(s.ignored, 1)
})

test('full board with no four-in-a-row is a draw', () => {
  // A full 7x6 board with no four in a row, realized by a legal alternating
  // sequence (even seq = X, odd seq = O). Verified to contain no win.
  const cols = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 4, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6]
  const moves = cols.map((col, seq) => move(seq % 2 === 0 ? A : B, seq, col))
  const s = fold(G, [...opening, ...moves])
  assert.ok(s.board.every((cell) => cell != null))
  assert.equal(s.winner, 'draw')
  assert.equal(status(s), 'draw')
})

test('winLine names the four winning cells, null otherwise', () => {
  // horizontal: X sweeps the bottom row cols 0-3, O parks in cols 4-6
  const h = fold(G, [...opening,
    move(A, 0, 0), move(B, 1, 4),
    move(A, 2, 1), move(B, 3, 5),
    move(A, 4, 2), move(B, 5, 6),
    move(A, 6, 3),
  ])
  assert.equal(h.winner, 'X')
  assert.deepEqual(h.winLine, [idx(0, 0), idx(1, 0), idx(2, 0), idx(3, 0)])

  // vertical: X stacks col 0, O parks in col 1
  const v = fold(G, [...opening,
    move(A, 0, 0), move(B, 1, 1),
    move(A, 2, 0), move(B, 3, 1),
    move(A, 4, 0), move(B, 5, 1),
    move(A, 6, 0),
  ])
  assert.equal(v.winner, 'X')
  assert.deepEqual(v.winLine, [idx(0, 0), idx(0, 1), idx(0, 2), idx(0, 3)])

  // mid-game: no winner yet, so no line
  const mid = fold(G, [...opening, move(A, 0, 0), move(B, 1, 1)])
  assert.equal(mid.winner, null)
  assert.equal(mid.winLine, null)

  // draw: full board, no line
  const cols = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 4, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6]
  const dmoves = cols.map((col, seq) => move(seq % 2 === 0 ? A : B, seq, col))
  const d = fold(G, [...opening, ...dmoves])
  assert.equal(d.winner, 'draw')
  assert.equal(d.winLine, null)
})

test('out-of-turn and impostor moves are ignored', () => {
  const s = fold(G, [...opening, move(A, 0, 3), move(A, 1, 3), move(C, 1, 3)])
  assert.equal(s.board[idx(3, 0)], 'X')
  assert.equal(s.board[idx(3, 1)], null)
  assert.equal(s.ignored, 2)
})

test('a move into a full column is ignored', () => {
  const s = fold(G, [...opening,
    move(A, 0, 3), move(B, 1, 3),
    move(A, 2, 3), move(B, 3, 3),
    move(A, 4, 3), move(B, 5, 3), // column 3 now full (six discs)
    move(A, 6, 3),                // ignored: full column
  ])
  assert.equal(s.board[idx(3, 5)], 'O')
  assert.equal(s.seq, 6)
  assert.equal(s.ignored, 1)
})

test('out-of-range and non-integer columns are ignored', () => {
  const hi = fold(G, [...opening, move(A, 0, COLS)])
  assert.equal(hi.ignored, 1)
  assert.equal(hi.seq, 0)
  const lo = fold(G, [...opening, move(A, 0, -1)])
  assert.equal(lo.ignored, 1)
  const frac = fold(G, [...opening, move(A, 0, 2.5)])
  assert.equal(frac.ignored, 1)
})

test('conflicting same-seq claims: first-by-ordering wins', () => {
  const s = fold(G, [...opening, move(A, 0, 3), move(B, 1, 3), move(B, 1, 4)])
  assert.equal(s.board[idx(3, 1)], 'O')
  assert.equal(s.board[idx(4, 0)], null)
  assert.equal(s.ignored, 1)
})

test('garbage pieces are ignored, not fatal', () => {
  const s = fold(G, [null, 42, { type: 'move' }, create(), { game: G, type: 'exploit' }, join()])
  assert.equal(seatOf(s, B), 'O')
  assert.equal(s.ignored, 1) // only the well-addressed unknown type counts against this game
})

test('lobby folds every game from one log, creation order, unregistered games excluded', () => {
  const s = lobby([
    create('g1', A, 'first'), join(B, 'g1'),
    create('g2', C),
    move(A, 0, 3, 'g1'),
    { v: 1, type: 'move', game: 'ghost', token: A, seq: 0, col: 0 },
  ])
  assert.deepEqual(s.map((g) => g.game), ['g1', 'g2'])
  assert.equal(status(s[0]), 'O to move')
  assert.equal(status(s[1]), 'waiting for opponent')
})
