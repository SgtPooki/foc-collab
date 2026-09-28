import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getLogsChunked, logClient, tokenLogs } from './chain-logs.js'

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

// An RPC that knows blocks up to `head` and serves at most `maxRange` per call.
function rpc(name, { head, maxRange, oldest = 0, down = false }) {
  return {
    async getBlockNumber() {
      if (down) throw new Error(`${name} down`)
      return BigInt(head)
    },
    async getLogs({ fromBlock, toBlock }) {
      if (down || toBlock > BigInt(head) || fromBlock < BigInt(oldest) || toBlock - fromBlock + 1n > BigInt(maxRange)) throw new Error(`${name} refused`)
      const out = []
      for (let b = fromBlock; b <= toBlock; b++) out.push({ blockNumber: b, source: name, args: {} })
      return out
    },
  }
}

test('logClient reports the highest head, so a lagging RPC cannot hide recent blocks', async () => {
  const client = logClient([rpc('stale', { head: 1000, maxRange: 2000 }), rpc('down', { head: 0, maxRange: 1, down: true }), rpc('live', { head: 1500, maxRange: 360 })])
  assert.equal(await client.getBlockNumber(), 1500n)
})

test('a scan reads history from the RPC that has it and the recent tail from the one that is current', async () => {
  // Like filfox (all history, stale head) and Glif (current head, 360 per call, recent only).
  const client = logClient([rpc('filfox', { head: 3000, maxRange: 2000 }), rpc('glif', { head: 3600, maxRange: 360, oldest: 2500 })])
  const logs = await getLogsChunked(client, {}, 0, Number(await client.getBlockNumber()))
  assert.equal(logs.length, 3601) // every block 0..3600, none missing, none twice
  assert.deepEqual(new Set(logs.map((l) => Number(l.blockNumber))).size, 3601)
  assert.equal(logs.find((l) => l.blockNumber === 100n).source, 'filfox')
  assert.equal(logs.find((l) => l.blockNumber === 3500n).source, 'glif')
})

test('logClient throws the last error when no RPC serves a range', async () => {
  const client = logClient([rpc('a', { head: 10, maxRange: 1 }), rpc('b', { head: 10, maxRange: 1 })])
  await assert.rejects(client.getLogs({ fromBlock: 0n, toBlock: 5n }), /b refused/)
})
