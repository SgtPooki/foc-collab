import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getLogsChunked, logRpc, tokenLogs } from './chain-logs.js'

const USDFC = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'

/** A getLogs that rejects ranges wider than `maxRange` and returns one log per block in range. */
function fakeClient({ maxRange, failAll = false, token = USDFC }) {
  const ranges = []
  return {
    ranges,
    async getLogs({ fromBlock, toBlock }) {
      ranges.push([Number(fromBlock), Number(toBlock)])
      if (failAll || toBlock - fromBlock + 1n > BigInt(maxRange)) throw new Error('block range exceeds maximum')
      const logs = []
      for (let b = fromBlock; b <= toBlock; b++) logs.push({ blockNumber: b, args: { token } })
      return logs
    },
  }
}

test('getLogsChunked halves the chunk until the RPC accepts it, and covers every block once', async () => {
  const client = fakeClient({ maxRange: 500 })
  const progress = []
  const logs = await getLogsChunked(client, {}, 1000, 2999, (p) => progress.push(p))
  assert.deepEqual(logs.map((l) => Number(l.blockNumber)), Array.from({ length: 2000 }, (_, i) => 1000 + i))
  assert.deepEqual(client.ranges.slice(0, 3), [[1000, 2999], [1000, 1999], [1000, 1499]])
  assert.deepEqual(progress.at(-1), { scanned: 2000, total: 2000 })
})

test('getLogsChunked throws once the chunk is already at its minimum, instead of returning a partial scan', async () => {
  await assert.rejects(getLogsChunked(fakeClient({ failAll: true }), {}, 0, 5000), /block range exceeds maximum/)
})

test('tokenLogs keeps only the token, compared case-insensitively, and never sends it to the RPC', async () => {
  const sent = []
  const client = {
    async getLogs(args) {
      sent.push(args.args)
      return [{ args: { token: USDFC.toLowerCase() } }, { args: { token: '0x000000000000000000000000000000000000dEaD' } }]
    },
  }
  const logs = await tokenLogs(client, { args: { to: '0xpayer' } }, USDFC, 0, 10)
  assert.equal(logs.length, 1)
  assert.deepEqual(sent, [{ to: '0xpayer' }])
})

test('logRpc prefers filfox on calibration and leaves other chains on the SDK default', () => {
  assert.equal(logRpc(314159), 'https://calibration.filfox.info/rpc/v1')
  assert.equal(logRpc(314), undefined)
})
