import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PRICE, creditsOf, foldJukebox, usableTrack } from './fold.js'

const DS = '35460'
const W1 = '0x1111111111111111111111111111111111111111'
const W2 = '0x2222222222222222222222222222222222222222'
let n = 0n
const pick = (wallet, id, extra = {}) => {
  n += 1n
  return {
    v: 2, app: 'foc-jukebox', log: `byow:${DS}`, type: 'pick', box: 'main',
    track: { kind: 'youtube', id }, title: `song ${n}`, wallet, walletSig: `0x${String(n).padStart(4, '0')}`,
    token: 'T', walletOk: true, src: DS, pieceId: n, ref: `r${n}`, ...extra,
  }
}
const coin = (from, coins = 1, epoch = 100) => ({ from, amount: PRICE * BigInt(coins), epoch })
const reset = () => { n = 0n }

test('credits are floor(sum / price) per wallet, case-insensitive', () => {
  const c = creditsOf([coin(W1, 1), { from: W1.toUpperCase().replace('0X', '0x'), amount: PRICE / 2n, epoch: 1 }, coin(W2, 3)])
  assert.equal(c.get(W1), 1)
  assert.equal(c.get(W2), 3)
})

test('picks queue in piece-id order and spend credits; a pick with no credit is not queued', () => {
  reset()
  const a = pick(W1, 'aaaaaaaaaaa')
  const b = pick(W2, 'bbbbbbbbbbb')
  const c = pick(W1, 'ccccccccccc') // W1 has one coin only
  const s = foldJukebox('main', DS, [coin(W1, 1), coin(W2, 1)], [c, b, a])
  assert.deepEqual(s.queue.map((q) => q.track.id), ['aaaaaaaaaaa', 'bbbbbbbbbbb'])
  assert.equal(s.unpaid, 1)
  assert.equal(s.balances.get(W1), 0)
  assert.equal(s.balances.get(W2), 0)
})

test('the same wallet signature counts once whatever piece carries it', () => {
  reset()
  const a = pick(W1, 'aaaaaaaaaaa')
  const replay = { ...a, pieceId: 9n, ref: 'r9', title: 'again' }
  const s = foldJukebox('main', DS, [coin(W1, 5)], [replay, a])
  assert.equal(s.queue.length, 1)
  assert.equal(s.queue[0].pieceId, '1')
  assert.equal(s.balances.get(W1), 4)
})

test('unverified wallet signatures, wrong data set, replay from elsewhere, bad tracks are ignored', () => {
  reset()
  const good = pick(W1, 'aaaaaaaaaaa')
  const bad = [
    pick(W1, 'bbbbbbbbbbb', { walletOk: false }),
    pick(W1, 'ccccccccccc', { walletOk: undefined }),
    pick(W1, 'ddddddddddd', { src: '1' }),
    pick(W1, 'eeeeeeeeeee', { log: 'byow:1' }),
    pick(W1, 'short', {}),
    pick(W1, 'fffffffffff', { track: { kind: 'url', url: 'http://insecure' } }),
    pick(W1, 'ggggggggggg', { track: { kind: 'file', cid: 'x' } }),
    pick(W1, 'hhhhhhhhhhh', { title: 'x'.repeat(81) }),
  ]
  const s = foldJukebox('main', DS, [coin(W1, 20)], [good, ...bad])
  assert.equal(s.queue.length, 1)
  assert.equal(s.ignored, bad.length)
  assert.equal(usableTrack({ kind: 'url', url: 'https://stream.example/radio.mp3' }), true)
})

test('a later coin unlocks an earlier unpaid pick on the next fold (credits are by wallet, not by time)', () => {
  reset()
  const a = pick(W1, 'aaaaaaaaaaa')
  assert.equal(foldJukebox('main', DS, [], [a]).queue.length, 0)
  assert.equal(foldJukebox('main', DS, [coin(W1, 1, 999)], [a]).queue.length, 1)
})
