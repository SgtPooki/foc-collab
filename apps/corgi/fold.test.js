import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_CONFIG, EPOCHS_PER_DAY, fold, lifeOf, moodOf, runwayEpochs } from './fold.js'

const PAYER = '0x00000000000000000000000000000000000c0261'
const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'
const C = '0x3333333333333333333333333333333333333333'
const D = '0x4444444444444444444444444444444444444444'
const E = '0x5555555555555555555555555555555555555555'

const USDFC = 10n ** 18n
const RATE = 10n ** 15n // wei per epoch: 2.88 USDFC a day
const days = (n) => BigInt(n) * BigInt(EPOCHS_PER_DAY) * RATE // wei that buys n days
const dep = (from, amount, epoch, txHash = `0x${epoch.toString(16)}`) => ({ from, amount, epoch, txHash })

/** Account whose unreserved balance today buys `runwayDays` days. */
function account(runwayDays, epoch = 100_000, ratePerEpoch = RATE) {
  const unreserved = runwayDays === Infinity ? 0n : days(runwayDays)
  // funds also hold the 30-day reserve plus a fixed lockup (like a CDN hold)
  // that is not streaming spend, so gross coverage overstates the window
  return { epoch, ratePerEpoch, unreserved, funds: unreserved + days(30) + days(365) }
}

test('runway and life thresholds', () => {
  assert.equal(runwayEpochs(0n, RATE), 0)
  assert.equal(runwayEpochs(days(10), 0n), Infinity)
  assert.equal(lifeOf(Infinity), 'unfunded')
  assert.equal(lifeOf(91 * EPOCHS_PER_DAY), 'thriving')
  assert.equal(lifeOf(60 * EPOCHS_PER_DAY), 'fine')
  assert.equal(lifeOf(20 * EPOCHS_PER_DAY), 'sick')
  assert.equal(lifeOf(10 * EPOCHS_PER_DAY), 'critical')
  assert.equal(lifeOf(6 * EPOCHS_PER_DAY), 'dead')
})

test('mood comes from distinct feeders, not amounts', () => {
  assert.equal(moodOf(0), 'lonely')
  assert.equal(moodOf(1), 'content')
  assert.equal(moodOf(3), 'happy')
  assert.equal(moodOf(4), 'ecstatic')
})

test('empty log, nothing stored: unfunded, lonely, generation 0', () => {
  const s = fold({ payer: PAYER, account: { epoch: 10, ratePerEpoch: 0n, unreserved: 0n, funds: 0n }, deposits: [] })
  assert.equal(s.life, 'unfunded')
  assert.equal(s.mood, 'lonely')
  assert.equal(s.generation, 0)
  assert.equal(s.runwayEpochs, Infinity)
})

test('one genesis deposit, healthy runway: alive, generation 1, born at that deposit', () => {
  const s = fold({ payer: PAYER, account: account(100), deposits: [dep(A, days(120), 50_000)] })
  assert.equal(s.life, 'thriving')
  assert.equal(s.generation, 1)
  assert.equal(s.born.epoch, 50_000)
  assert.equal(s.generations.length, 0)
  assert.equal(s.memorial, null)
})

test('a whale buys life but not happiness', () => {
  const now = 100_000
  const s = fold({ payer: PAYER, account: account(400, now), deposits: [dep(A, days(500), now - 100)] })
  assert.equal(s.life, 'thriving')
  assert.equal(s.mood, 'content')
  assert.equal(s.distinctFeeders, 1)
})

test('mood counts distinct feeders inside the window only', () => {
  const now = 100_000
  const old = now - (DEFAULT_CONFIG.moodWindowDays + 1) * EPOCHS_PER_DAY
  const s = fold({
    payer: PAYER,
    account: account(60, now),
    deposits: [
      dep(A, days(80), old),
      dep(B, USDFC, now - 10),
      dep(B, USDFC, now - 9), // same feeder twice counts once
      dep(C, USDFC, now - 8),
    ],
  })
  assert.equal(s.distinctFeeders, 2)
  assert.equal(s.mood, 'happy')
})

test('adoption: a deposit at or above the threshold spawns one corgi per owner', () => {
  const now = 100_000
  const s = fold({
    payer: PAYER,
    account: account(60, now),
    deposits: [
      dep(A, days(80), now - 500),
      dep(B, DEFAULT_CONFIG.adoptionThreshold, now - 400),
      dep(B, DEFAULT_CONFIG.adoptionThreshold, now - 300), // second adoption ignored
      dep(C, DEFAULT_CONFIG.adoptionThreshold - 1n, now - 200), // below threshold
      dep(PAYER, days(10), now - 100), // the corgi feeding itself is not an adopter
    ],
  })
  assert.deepEqual(s.park.map((p) => p.owner), [A, B])
  assert.equal(s.park[1].epoch, now - 400)
})

test('death before zero: runway under the death line is dead with a memorial countdown', () => {
  const now = 100_000
  const s = fold({ payer: PAYER, account: account(5, now), deposits: [dep(A, days(50), now - 45 * EPOCHS_PER_DAY)] })
  assert.equal(s.life, 'dead')
  assert.equal(s.generation, 1) // gen 1 lived and died; nothing revived it
  assert.equal(s.generations.length, 1)
  // born when funded, died when runway crossed 7 days: 43 days after the deposit
  assert.equal(s.generations[0].born.epoch, now - 45 * EPOCHS_PER_DAY)
  assert.equal(s.generations[0].died.epoch, now - 45 * EPOCHS_PER_DAY + 43 * EPOCHS_PER_DAY + 1)
  assert.equal(s.memorial.endsInEpochs, 35 * EPOCHS_PER_DAY) // 5 days to deficit + 30-day lockup tail, fixed lockup ignored
  assert.equal(s.memorial.reviveNeeds, days(2))
})

test('revival opens a new generation; the memorial wall keeps the old one', () => {
  const now = 100_000
  const t0 = now - 100 * EPOCHS_PER_DAY
  const deposits = [
    dep(A, days(20), t0), // gen 1 born; dies 13 days later
    dep(B, days(60), t0 + 30 * EPOCHS_PER_DAY), // revival: gen 2 born
  ]
  // after gen-2 deposit: 60 + (20 - 30) = 50 days of runway at t0+30d, 70 days later that is dead again
  const s = fold({ payer: PAYER, account: account(-20, now), deposits })
  assert.equal(s.generations.length, 2)
  assert.equal(s.generations[0].born.by, A)
  assert.equal(s.generations[0].died.epoch, t0 + 13 * EPOCHS_PER_DAY + 1)
  assert.equal(s.generations[1].born.by, B)
  assert.equal(s.generations[1].born.epoch, t0 + 30 * EPOCHS_PER_DAY)
  assert.equal(s.life, 'dead')
})

test('memorial window shrinks after deficit and never goes negative', () => {
  const now = 100_000
  const deep = fold({ payer: PAYER, account: { epoch: now, ratePerEpoch: RATE, unreserved: -days(10), funds: days(20) }, deposits: [dep(A, days(20), now - 30 * EPOCHS_PER_DAY)] })
  assert.equal(deep.life, 'dead')
  assert.equal(deep.memorial.endsInEpochs, 20 * EPOCHS_PER_DAY) // 30 - 10 days already in deficit
  const gone = fold({ payer: PAYER, account: { epoch: now, ratePerEpoch: RATE, unreserved: -days(40), funds: 0n }, deposits: [dep(A, days(20), now - 60 * EPOCHS_PER_DAY)] })
  assert.equal(gone.memorial.endsInEpochs, 0)
})

test('a deposit too small to clear the death line does not revive', () => {
  const now = 100_000
  const t0 = now - 20 * EPOCHS_PER_DAY
  const s = fold({
    payer: PAYER,
    account: account(3, now),
    deposits: [dep(A, days(20), t0), dep(B, days(3), now - EPOCHS_PER_DAY)],
  })
  assert.equal(s.life, 'dead')
  assert.equal(s.generations.length, 1)
  assert.equal(s.generation, 1)
})

test('revival mid-history then alive now: generation 2 alive', () => {
  const now = 100_000
  const t0 = now - 30 * EPOCHS_PER_DAY
  const s = fold({
    payer: PAYER,
    account: account(70, now),
    deposits: [dep(A, days(10), t0), dep(B, days(90), now - 5 * EPOCHS_PER_DAY)],
  })
  assert.equal(s.generations.length, 1)
  assert.equal(s.generation, 2)
  assert.equal(s.life, 'fine')
  assert.equal(s.born.by, B)
})

test('feed log is newest first with attributed amounts; junk deposits are counted and dropped', () => {
  const now = 100_000
  const s = fold({
    payer: PAYER,
    account: account(30, now),
    deposits: [dep(A, days(40), now - 300), dep(B, USDFC, now - 200), { from: 'nope', amount: 1n, epoch: now - 100 }, dep(C, 0n, now - 50)],
  })
  assert.deepEqual(s.feed.map((f) => f.from), [B, A])
  assert.equal(s.totalFed, days(40) + USDFC)
  assert.equal(s.ignored, 2)
})

test('a withdrawal that drops runway under the death line kills the corgi at that epoch', () => {
  const now = 100_000
  const t0 = now - 10 * EPOCHS_PER_DAY
  const s = fold({
    payer: PAYER,
    account: account(3, now),
    deposits: [dep(A, days(100), t0)],
    // 100 - 10 (spent) - 87 = 3 days left, withdrawn 2 days ago
    withdrawals: [{ amount: days(87), epoch: now - 2 * EPOCHS_PER_DAY, txHash: '0xw' }],
  })
  assert.equal(s.life, 'dead')
  assert.equal(s.generations.length, 1)
  assert.deepEqual(s.generations[0].died, { epoch: now - 2 * EPOCHS_PER_DAY, cause: 'withdrawn' })
  assert.equal(s.totalWithdrawn, days(87))
  assert.equal(s.feed[0].kind, 'withdrawal')
  assert.equal(s.distinctFeeders, 0) // withdrawals are not feeding
})

test('a withdrawal that leaves runway above the line is just a smaller meal', () => {
  const now = 100_000
  const s = fold({
    payer: PAYER,
    account: account(50, now),
    deposits: [dep(A, days(100), now - 10 * EPOCHS_PER_DAY)],
    withdrawals: [{ amount: days(40), epoch: now - 5 * EPOCHS_PER_DAY, txHash: '0xw' }],
  })
  assert.equal(s.life, 'fine')
  assert.equal(s.generations.length, 0)
  assert.equal(s.generation, 1)
})

test('fold is deterministic and does not mutate its input', () => {
  const now = 100_000
  const input = { payer: PAYER, account: account(30, now), deposits: [dep(A, days(40), now - 300), dep(D, USDFC, now - 1), dep(E, USDFC, now - 1)] }
  const snapshot = JSON.stringify(input, (_, v) => (typeof v === 'bigint' ? v.toString() : v))
  const a = fold(input)
  const b = fold(input)
  assert.equal(JSON.stringify(input, (_, v) => (typeof v === 'bigint' ? v.toString() : v)), snapshot)
  assert.deepEqual(a, b)
})
