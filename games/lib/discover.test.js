import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chunks, hintOf, scan, tagsFor, tagsOf } from './discover.js'

const log = (ds, pieceId, block, tags) => ({
  args: { dataSetId: BigInt(ds), pieceId: BigInt(pieceId), keys: Object.keys(tags), values: Object.values(tags) },
  blockNumber: BigInt(block),
})

test('tags round-trip through a PieceAdded log and stay within FWSS limits', () => {
  const tags = tagsFor('foc-ttt', 'game-' + 'x'.repeat(36), 'join')
  assert.equal(Object.keys(tags).length, 3)
  for (const [k, v] of Object.entries(tags)) {
    assert.ok(k.length <= 32 && v.length <= 96)
  }
  assert.deepEqual(tagsOf(log(1, 2, 3, tags)), tags)
  assert.deepEqual(hintOf(log(35170, 17, 4057919, tags)), { ds: '35170', pieceId: '17', block: '4057919', tags })
})

test('chunks cover the range exactly once, inclusive', () => {
  assert.deepEqual(chunks(10, 25, 5), [[10n, 14n], [15n, 19n], [20n, 24n], [25n, 25n]])
  assert.deepEqual(chunks(7, 7, 2000), [[7n, 7n]])
  assert.deepEqual(chunks(8, 7, 2000), [])
})

test('scan filters by tags across chunks and reports the scanned checkpoint', async () => {
  const calls = []
  const fetch = async (from, to) => {
    calls.push([from, to])
    return [
      log(100, 1, from, tagsFor('foc-ttt', 'g1', 'create')),
      log(200, 5, from + 1n, tagsFor('foc-ttt', 'g1', 'join')),
      log(300, 9, from + 2n, tagsFor('foc-ttt', 'g2', 'join')),
      log(400, 2, from + 3n, { ipfsRootCID: 'bafy' }),
    ]
  }
  const { hints, scanned, failed } = await scan({ from: 1000, to: 4999, fetch, chunk: 2000n, match: (t) => t.app === 'foc-ttt' && t.game === 'g1' })
  assert.deepEqual(calls, [[1000n, 2999n], [3000n, 4999n]])
  assert.deepEqual(hints.map((h) => h.ds), ['100', '200', '100', '200'])
  assert.equal(scanned, 4999n)
  assert.deepEqual(failed, [])
})

test('scan halves the chunk on RPC errors and gives up only below the minimum', async () => {
  const calls = []
  const fetch = async (from, to) => {
    calls.push(to - from + 1n)
    if (to - from + 1n > 500n) throw new Error('request too large')
    if (from === 3000n) throw new Error('flaky')
    return []
  }
  const { scanned, failed } = await scan({ from: 1000, to: 3999, fetch, chunk: 2000n, minChunk: 250n, match: () => true })
  assert.deepEqual(calls.slice(0, 3), [2000n, 1000n, 500n])
  assert.ok(calls.every((n) => n <= 2000n))
  assert.equal(failed.length, 1)
  assert.equal(failed[0].from, 3000n)
  assert.equal(scanned, 2999n, 'checkpoint stops before the first failed chunk')
})
