import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayOrder, foldRoom, rooms, usablePost } from './fold.js'

let ids = {}
function post(src, token, room, text, extra = {}) {
  ids[src] = (ids[src] ?? 0n) + 1n
  return { v: 2, app: 'foc-chat', log: `byow:${src}`, type: 'post', room, text, token, src, pieceId: ids[src], ref: `r:${src}:${ids[src]}`, ...extra }
}
const reset = () => { ids = {} }

test('posts fold per author in piece-id order, with seq; other rooms and junk are ignored', () => {
  reset()
  const a1 = post('100', 'A', 'lobby', 'hi')
  const b1 = post('35446', 'guest1', 'lobby', 'hello')
  const a2 = post('100', 'A', 'lobby', 'again')
  const other = post('100', 'A', 'game-1', 'not here')
  const junk = { v: 2, app: 'foc-chat', type: 'post', room: 'lobby', text: '', token: 'A', src: '100', pieceId: 9, ref: 'x', log: 'byow:100' }
  const s = foldRoom('lobby', [a2, junk, other, b1, a1, null, 'nope'])
  assert.equal(s.authors, 2)
  assert.equal(s.applied, 3)
  assert.equal(s.ignored, 1)
  const a = s.messages.filter((m) => m.author === '100:A')
  assert.deepEqual(a.map((m) => [m.text, m.seq]), [['hi', 0], ['again', 1]])
})

test('guests in one sponsored data set are distinct authors; replay into another data set is dropped', () => {
  reset()
  const g1 = post('35446', 'g1', 'lobby', 'one')
  const g2 = post('35446', 'g2', 'lobby', 'two')
  const replay = { ...g1, src: '200', pieceId: 5n, ref: 'r:200:5' } // log still names 35446
  const s = foldRoom('lobby', [g1, g2, replay])
  assert.equal(s.authors, 2)
  assert.equal(s.ignored, 1)
  assert.equal(usablePost(replay, 'lobby'), false)
})

test('limits: text length, empty text, name length', () => {
  reset()
  assert.equal(usablePost(post('1', 'A', 'r', 'x'.repeat(281)), 'r'), false)
  assert.equal(usablePost(post('1', 'A', 'r', '   '), 'r'), false)
  assert.equal(usablePost(post('1', 'A', 'r', 'ok', { name: 'n'.repeat(25) }), 'r'), false)
  assert.equal(usablePost(post('1', 'A', 'r', 'ok', { name: 'Russell' }), 'r'), true)
})

test('display order interleaves by block hint, stable by data set and piece id, unknown last', () => {
  reset()
  const a1 = post('100', 'A', 'lobby', 'a1')
  const b1 = post('35446', 'g', 'lobby', 'b1')
  const a2 = post('100', 'A', 'lobby', 'a2')
  const b2 = post('35446', 'g', 'lobby', 'b2')
  const { messages } = foldRoom('lobby', [a1, b1, a2, b2])
  const blocks = { '100:1': 10, '35446:1': 11, '100:2': 12 } // b2 unknown
  const order = displayOrder(messages, (src, id) => blocks[`${src}:${id}`])
  assert.deepEqual(order.map((m) => m.text), ['a1', 'b1', 'a2', 'b2'])
  // the fold itself is untouched by hints
  assert.deepEqual(foldRoom('lobby', [b2, a2, b1, a1]).messages.map((m) => m.text).sort(), ['a1', 'a2', 'b1', 'b2'])
})

test('rooms lists every room with counts, most posts first', () => {
  reset()
  const ps = [post('1', 'A', 'lobby', 'x'), post('1', 'A', 'game-9', 'y'), post('2', 'B', 'game-9', 'z')]
  assert.deepEqual(rooms(ps), [{ room: 'game-9', posts: 2 }, { room: 'lobby', posts: 1 }])
})
