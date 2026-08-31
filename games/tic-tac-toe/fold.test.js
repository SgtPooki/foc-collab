import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fold, lobby, seatOf, status } from './fold.js'

const G = 'game-1'
const A = 'token-alice'
const B = 'token-bob'
const C = 'token-carol'
const create = (game = G, token = A, name) => ({ v: 1, type: 'create', game, token, name })
const join = (token = B, game = G) => ({ v: 1, type: 'join', game, token })
const move = (token, seq, cell, game = G) => ({ v: 1, type: 'move', game, token, seq, cell })

const opening = [create(), join()]

test('empty log: game unregistered', () => {
  const s = fold(G, [])
  assert.equal(status(s), 'unregistered')
})

test('create assigns X to creator, waiting for opponent', () => {
  const s = fold(G, [create(G, A, 'friday game')])
  assert.equal(seatOf(s, A), 'X')
  assert.equal(s.name, 'friday game')
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
  const s = fold(G, [create(), move(A, 0, 4)])
  assert.equal(s.board[4], null)
  assert.equal(s.ignored, 1)
})

test('alternating legal moves apply in order', () => {
  const s = fold(G, [...opening, move(A, 0, 4), move(B, 1, 0), move(A, 2, 8)])
  assert.deepEqual([s.board[4], s.board[0], s.board[8]], ['X', 'O', 'X'])
  assert.equal(s.next, 'O')
})

test('X wins on a row; moves after the win are ignored', () => {
  const s = fold(G, [...opening,
    move(A, 0, 0), move(B, 1, 3), move(A, 2, 1), move(B, 3, 4), move(A, 4, 2),
    move(B, 5, 5),
  ])
  assert.equal(s.winner, 'X')
  assert.equal(s.board[5], null)
  assert.equal(status(s), 'X won')
})

test('draw is detected', () => {
  // X O X / X O O / O X X
  const s = fold(G, [...opening,
    move(A, 0, 0), move(B, 1, 1), move(A, 2, 2),
    move(B, 3, 4), move(A, 4, 3), move(B, 5, 5),
    move(A, 6, 7), move(B, 7, 6), move(A, 8, 8),
  ])
  assert.equal(s.winner, 'draw')
})

test('out-of-turn and impostor moves are ignored', () => {
  const s = fold(G, [...opening, move(A, 0, 0), move(A, 1, 1), move(C, 1, 2)])
  assert.equal(s.board[1], null)
  assert.equal(s.board[2], null)
  assert.equal(s.ignored, 2)
})

test('occupied cell and conflicting same-seq claims: first-by-ordering wins', () => {
  const s = fold(G, [...opening, move(A, 0, 4), move(B, 1, 1), move(B, 1, 2)])
  assert.equal(s.board[1], 'O')
  assert.equal(s.board[2], null)
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
    move(A, 0, 4, 'g1'),
    { v: 1, type: 'move', game: 'ghost', token: A, seq: 0, cell: 0 },
  ])
  assert.deepEqual(s.map((g) => g.game), ['g1', 'g2'])
  assert.equal(status(s[0]), 'O to move')
  assert.equal(status(s[1]), 'waiting for opponent')
})
