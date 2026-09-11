import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PALETTE, SIZE, foldBoard, usablePixel } from './fold.js'

const DS = '35447'
let n = 0n
const px = (x, y, c, token = 'A', extra = {}) => {
  n += 1n
  return { v: 2, app: 'foc-paint', log: `byow:${DS}`, type: 'pixel', board: 'main', x, y, c, token, src: DS, pieceId: n, ref: `r${n}`, ...extra }
}
const reset = () => { n = 0n }
const at = (s, x, y) => s.cells[y * SIZE + x]

test('highest piece id wins a cell; listing order does not matter', () => {
  reset()
  const a = px(1, 1, 3, 'A')
  const b = px(1, 1, 5, 'B')
  const c = px(2, 2, 7, 'A')
  for (const order of [[a, b, c], [c, b, a], [b, a, c]]) {
    const s = foldBoard('main', DS, order)
    assert.equal(at(s, 1, 1), 5)
    assert.equal(at(s, 2, 2), 7)
    assert.deepEqual(s.owner[1 * SIZE + 1].token, 'B')
  }
})

test('a lower id arriving after a higher id does not overwrite it', () => {
  reset()
  const late = px(0, 0, 1, 'A')
  const later = px(0, 0, 2, 'B')
  assert.equal(at(foldBoard('main', DS, [later, late]), 0, 0), 2)
})

test('out-of-range, wrong schema, other data set, replay, junk are ignored and counted', () => {
  reset()
  const good = px(3, 3, 1)
  const bad = [
    px(64, 0, 1), px(-1, 0, 1), px(0, 0, PALETTE.length), px(1.5, 0, 1), px(0, 0, '1'),
    px(0, 0, 1, 'A', { v: 1 }), px(0, 0, 1, 'A', { app: 'foc-chat' }), px(0, 0, 1, 'A', { type: 'post' }),
    px(0, 0, 1, 'A', { src: '999' }), // another data set
    px(0, 0, 1, 'A', { log: 'byow:999' }), // replayed from elsewhere
    px(0, 0, 1, ''), px(0, 0, 1, 'A', { ref: undefined }), px(0, 0, 1, 'A', { pieceId: 'x' }),
  ]
  const other = px(0, 0, 1, 'A', { board: 'other' })
  const s = foldBoard('main', DS, [good, ...bad, other, null, 42])
  assert.equal(s.applied, 1)
  assert.equal(s.ignored, bad.length)
  assert.equal(at(s, 0, 0), null)
  assert.equal(usablePixel(other, 'main', DS), false)
})

test('the same piece listed twice counts once', () => {
  reset()
  const a = px(5, 5, 2)
  const s = foldBoard('main', DS, [a, { ...a }])
  assert.equal(s.painted, 1)
  assert.deepEqual(s.leaders, [{ token: 'A', count: 1 }])
})

test('leaders count standing pixels, not placed ones', () => {
  reset()
  px(0, 0, 1, 'A'); const s1 = px(0, 1, 1, 'A'); const s2 = px(0, 2, 1, 'A')
  const b = px(0, 0, 2, 'B') // B overwrites one of A's
  const s = foldBoard('main', DS, [s1, s2, b, px(9, 9, 3, 'B')])
  assert.deepEqual(s.leaders, [{ token: 'A', count: 2 }, { token: 'B', count: 2 }])
})

test('a removed piece keeps its cell for the reader that saw it and is reported as a dispute', () => {
  reset()
  const a = px(7, 7, 4, 'A', { removed: true })
  const s = foldBoard('main', DS, [a])
  assert.equal(at(s, 7, 7), 4)
  assert.deepEqual(s.disputes, [{ x: 7, y: 7, pieceId: '1' }])
})
