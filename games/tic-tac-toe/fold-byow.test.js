/**
 * Adversarial tests for the v2 BYOW fold. Pieces here are hand-built with
 * fake refs and explicit (src, pieceId) annotations, exactly what the
 * transport plus verification hand to the fold. Every test that matters
 * also runs with the input shuffled: listing order must never matter.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { seatOf, status } from './fold.js'
import { dataSetsOf, foldByow, homeLog, lobbyByow } from './fold-byow.js'

const G = 'game-1'
const A = 'token-alice'
const B = 'token-bob'
const C = 'token-carol'
const DS_A = '100'
const DS_B = '200'
const DS_C = '300'

let nextId = { [DS_A]: 1n, [DS_B]: 1n, [DS_C]: 1n }
function reset() {
  nextId = { [DS_A]: 1n, [DS_B]: 1n, [DS_C]: 1n }
}
/** A verified, annotated v2 piece as it would leave verifyAll(). */
function piece(src, body, ref) {
  nextId[src] ??= 1n
  const pieceId = nextId[src]++
  return { v: 2, app: 'foc-ttt', log: homeLog(src), game: G, ...body, src, pieceId, ref }
}
const create = (src = DS_A, token = A, extra = {}) => piece(src, { type: 'create', token, ...extra }, `c:${src}:${token}`)
const join = (src, token, prev, ref = `j:${src}:${token}`) => piece(src, { type: 'join', token, prev }, ref)
const move = (src, token, seq, cell, prev, extra = {}, ref = `m:${src}:${seq}:${cell}`) =>
  piece(src, { type: 'move', token, seq, cell, prev, ...extra }, ref)
const ratify = (src, token, cell, joinPiece, extra = {}) =>
  move(src, token, 0, cell, joinPiece.ref, { o: { token: joinPiece.token, ds: joinPiece.src }, ...extra })

function shuffled(arr, seed = 7) {
  const out = arr.slice()
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}
function foldBoth(pieces) {
  const a = foldByow(G, DS_A, pieces)
  const b = foldByow(G, DS_A, shuffled(pieces))
  const c = foldByow(G, DS_A, shuffled(pieces, 99).map((p) => ({ ...p, pieceId: String(p.pieceId) })))
  assert.deepEqual(a, b, 'listing order changed the fold')
  assert.deepEqual(a, c, 'pieceId string form changed the fold')
  return a
}

function opening() {
  reset()
  const c = create()
  const j = join(DS_B, B, c.ref)
  const r = ratify(DS_A, A, 4, j)
  return { c, j, r, pieces: [c, j, r] }
}

test('create, join, ratify, play: both homes, converges regardless of listing order', () => {
  const { pieces, r } = opening()
  const m1 = move(DS_B, B, 1, 0, r.ref)
  const m2 = move(DS_A, A, 2, 8, m1.ref)
  const s = foldBoth([...pieces, m1, m2])
  assert.equal(seatOf(s, A), 'X')
  assert.equal(seatOf(s, B), 'O')
  assert.deepEqual(s.homes, { X: DS_A, O: DS_B })
  assert.deepEqual([s.board[4], s.board[0], s.board[8]], ['X', 'O', 'X'])
  assert.equal(s.next, 'O')
  assert.equal(s.lastRef, m2.ref)
  assert.equal(s.ignored, 0)
  assert.deepEqual(dataSetsOf(s), [DS_A, DS_B])
})

test('before ratification, joiners are candidates, not O', () => {
  reset()
  const c = create()
  const j1 = join(DS_B, B, c.ref)
  const j2 = join(DS_C, C, c.ref)
  const s = foldBoth([c, j1, j2])
  assert.equal(s.seats.O, null)
  assert.equal(s.ratified, false)
  assert.deepEqual(s.joins.map((j) => j.token), [B, C])
  assert.equal(status(s), 'waiting for opponent')
  assert.deepEqual(dataSetsOf(s), [DS_A, DS_B, DS_C])
})

test('seat O theft: a later join cannot displace the ratified O, even from a lower data set id', () => {
  const { c, j, r, pieces } = opening()
  const late = join('050', C, c.ref)
  const lateMove = move('050', C, 1, 0, r.ref)
  const s = foldBoth([...pieces, late, lateMove])
  assert.equal(seatOf(s, C), null)
  assert.equal(seatOf(s, B), 'O')
  assert.equal(s.board[0], null)
  assert.equal(s.ignored, 2)
  void j
})

test('seat X theft: a create for the same game id in another data set is a different game', () => {
  reset()
  const c = create()
  const impostor = create(DS_C, C)
  const s = foldBoth([c, impostor])
  assert.equal(seatOf(s, A), 'X')
  assert.equal(seatOf(s, C), null)
  const other = foldByow(G, DS_C, [c, impostor])
  assert.equal(seatOf(other, C), 'X')
})

test('duplicate create in the root: lowest piece id wins, later ones ignored', () => {
  reset()
  const first = create(DS_A, A, { name: 'first' })
  const second = create(DS_A, C, { name: 'second' })
  const s = foldBoth([second, first])
  assert.equal(s.name, 'first')
  assert.equal(seatOf(s, A), 'X')
  assert.equal(s.ignored, 1)
})

test('move take-back: re-signing seq k after the opponent replied loses to the lower piece id', () => {
  const { pieces, r } = opening()
  const m1 = move(DS_B, B, 1, 0, r.ref)
  const takeBack = ratify(DS_A, A, 8, pieces[1]) // same prev, different cell, higher id
  const s = foldBoth([...pieces, m1, takeBack])
  assert.equal(s.board[4], 'X')
  assert.equal(s.board[8], null)
  assert.equal(s.board[0], 'O')
  assert.equal(s.ignored, 1)
})

test('grinding: refs, names, and field extras never affect acceptance; only piece id does', () => {
  const { c, j } = opening()
  reset()
  nextId[DS_A] = 10n
  const high = ratify(DS_A, A, 8, j, {}) // id 10, ref 'm:100:0:8'
  const low = { ...ratify(DS_A, A, 4, j, { junk: 'zzz' }), ref: 'a-lowest-ref' } // id 11
  const s = foldBoth([c, j, low, high])
  assert.equal(s.board[8], 'X', 'lowest id wins regardless of ref sort')
  assert.equal(s.board[4], null)
})

test('ratification must name the join it references: mismatched o descriptor is ignored', () => {
  reset()
  const c = create()
  const jb = join(DS_B, B, c.ref)
  const jc = join(DS_C, C, c.ref)
  const lie = move(DS_A, A, 0, 4, jb.ref, { o: { token: C, ds: DS_C } })
  const sLie = foldBoth([c, jb, jc, lie])
  assert.equal(sLie.ratified, false)
  const honest = ratify(DS_A, A, 4, jb)
  const s = foldBoth([c, jb, jc, lie, honest])
  assert.equal(seatOf(s, B), 'O')
  assert.equal(s.homes.O, DS_B)
})

test('home binding: a piece listed from a data set its log does not name is dropped', () => {
  const { c, j, r } = opening()
  const replayed = { ...move(DS_B, B, 1, 0, r.ref), src: DS_A } // O's signed piece copied into X's set
  const s = foldBoth([c, j, r, replayed])
  assert.equal(s.board[0], null)
  const forgedLog = { ...move(DS_B, B, 1, 0, r.ref), log: homeLog(DS_A) }
  assert.equal(foldByow(G, DS_A, [c, j, r, forgedLog]).board[0], null)
})

test('out-of-turn, wrong-prev, wrong-seq, and illegal moves are ignored; first qualifying by id wins', () => {
  const { pieces, r } = opening()
  const wrongPrev = move(DS_B, B, 1, 0, 'nope')
  const wrongSeq = move(DS_B, B, 2, 0, r.ref)
  const occupied = move(DS_B, B, 1, 4, r.ref)
  const outOfTurn = move(DS_A, A, 1, 0, r.ref)
  const fromWrongHome = move(DS_A, B, 1, 0, r.ref)
  const good = move(DS_B, B, 1, 0, r.ref, {}, 'm:good')
  const s = foldBoth([...pieces, wrongPrev, wrongSeq, occupied, outOfTurn, fromWrongHome, good])
  assert.equal(s.board[0], 'O')
  assert.equal(s.lastRef, 'm:good')
  assert.equal(s.ignored, 5)
})

test('a move that never settles simply is not there: the chain stops at the last settled move', () => {
  const { pieces, r } = opening()
  const m2 = move(DS_A, A, 2, 8, 'm:never-landed')
  const s = foldBoth([...pieces, m2])
  assert.equal(s.seq, 1)
  assert.equal(s.next, 'O')
  assert.equal(s.ignored, 1)
})

test('full game to a win; moves after the win are ignored', () => {
  const { pieces, r } = opening() // X at 4
  const m1 = move(DS_B, B, 1, 0, r.ref)
  const m2 = move(DS_A, A, 2, 2, m1.ref)
  const m3 = move(DS_B, B, 3, 1, m2.ref)
  const m4 = move(DS_A, A, 4, 6, m3.ref) // 2-4-6 diagonal
  const after = move(DS_B, B, 5, 8, m4.ref)
  const s = foldBoth([...pieces, m1, m2, m3, m4, after])
  assert.equal(s.winner, 'X')
  assert.equal(status(s), 'X won')
  assert.equal(s.board[8], null)
})

test('late joiner from the root only: create and ratification reveal O\'s data set', () => {
  const { c, r } = opening()
  const rootOnly = foldByow(G, DS_A, [c, r])
  assert.equal(rootOnly.ratified, false, 'cannot ratify without reading the join itself')
  assert.deepEqual(rootOnly.hints, [DS_B], 'the ratification piece names the data set to fetch next')
  assert.deepEqual(dataSetsOf(rootOnly), [DS_A, DS_B])
  assert.equal(foldByow(G, DS_A, [c, r, opening().j]).ratified, true)
})

test('lobby lists one game per (game, root); v1 pieces and junk are ignored', () => {
  const { pieces } = opening()
  const other = create(DS_C, C)
  const games = lobbyByow([...pieces, other, { v: 1, type: 'create', game: 'old', token: A }, null, 'junk'])
  assert.deepEqual(games.map((g) => [g.game, g.root]), [[G, DS_A], [G, DS_C]])
  assert.equal(seatOf(games[0], B), 'O')
})
