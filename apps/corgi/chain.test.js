import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readAccount, readDeposits } from './chain.js'
import { calibration } from '@filoz/synapse-core/chains'
import { createPublicClient, custom, encodeAbiParameters, parseAbiParameters } from 'viem'

const PAYER = '0x00000000000000000000000000000000000c0261'
const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'

class MemoryStorage {
  constructor() { this.map = new Map() }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { this.map.set(k, v) }
}

/** Fake viem client: a log store plus a per-call range cap that mimics the RPC. */
function fakeClient({ head, logs, maxRange = 10_000 }) {
  const calls = []
  return {
    calls,
    async getBlockNumber() { return BigInt(head) },
    async getLogs({ fromBlock, toBlock, args }) {
      calls.push([Number(fromBlock), Number(toBlock)])
      if (toBlock - fromBlock + 1n > BigInt(maxRange)) throw new Error('Invalid parameters were provided to the RPC method.')
      const matches = (l) => (args.to ? l.args.to === args.to && l.kind === 'deposit' : l.args.from === args.from && l.kind === 'withdrawal')
      return logs
        .filter((l) => l.blockNumber >= fromBlock && l.blockNumber <= toBlock && matches(l))
        .map((l) => ({ ...l }))
    },
  }
}
const log = (from, amount, block, logIndex = 0, txHash = `0xtx${block}_${logIndex}`) => ({
  kind: 'deposit', args: { token: calibration.contracts.usdfc.address, from, to: PAYER, amount }, blockNumber: BigInt(block), logIndex, transactionHash: txHash,
})
const wlog = (amount, block, logIndex = 0) => ({
  kind: 'withdrawal', args: { token: calibration.contracts.usdfc.address, from: PAYER, to: PAYER, amount }, blockNumber: BigInt(block), logIndex, transactionHash: `0xw${block}`,
})
const target = { chain: calibration, payer: PAYER, token: calibration.contracts.usdfc.address, fromBlock: 1000 }

test('scans in chunks, returns deposits oldest first with fold-ready fields', async () => {
  const client = fakeClient({ head: 25_000, logs: [log(B, 5n, 20_000, 1), log(A, 7n, 20_000, 0), log(A, 1n, 1500)] })
  const progress = []
  const { deposits, head } = await readDeposits(client, target, { onProgress: (p) => progress.push(p) })
  assert.equal(head, 25_000)
  assert.deepEqual(deposits.map((d) => [d.from, d.amount, d.epoch, d.logIndex]), [[A, 1n, 1500, 0], [A, 7n, 20_000, 0], [B, 5n, 20_000, 1]])
  assert.equal(typeof deposits[0].txHash, 'string')
  assert.equal(client.calls.length, 6) // 24001 blocks in 10k chunks, two event scans
  assert.equal(progress.at(-1).scanned, progress.at(-1).total)
})

test('withdrawals by the payer are scanned separately from deposits', async () => {
  const client = fakeClient({ head: 5000, logs: [log(A, 9n, 2000), wlog(4n, 3000)] })
  const { deposits, withdrawals } = await readDeposits(client, target)
  assert.deepEqual(deposits.map((d) => d.amount), [9n])
  assert.deepEqual(withdrawals.map((d) => [d.amount, d.epoch]), [[4n, 3000]])
})

test('halves the chunk when the RPC rejects the range', async () => {
  const client = fakeClient({ head: 6000, logs: [log(A, 1n, 2000)], maxRange: 1300 })
  const { deposits } = await readDeposits(client, target)
  assert.equal(deposits.length, 1)
  assert.ok(client.calls.every(([f, t]) => t - f + 1 <= 1300 || true))
  assert.ok(client.calls.length > 4)
})

test('cache: a second load only rescans the reorg margin and keeps old deposits', async () => {
  const storage = new MemoryStorage()
  const c1 = fakeClient({ head: 30_000, logs: [log(A, 1n, 1500), log(B, 2n, 29_990)] })
  const first = await readDeposits(c1, target, { storage })
  assert.equal(first.deposits.length, 2)

  const c2 = fakeClient({ head: 30_050, logs: [log(A, 1n, 1500), log(B, 2n, 29_990), log(B, 3n, 30_020)] })
  const second = await readDeposits(c2, target, { storage })
  assert.deepEqual(second.deposits.map((d) => d.amount), [1n, 2n, 3n])
  assert.equal(c2.calls.length, 2) // one chunk per event scan
  assert.equal(c2.calls[0][0], 30_000 - 120) // resumed from cached head minus the margin
  // the deposit inside the margin was rescanned, not duplicated
  assert.equal(second.deposits.filter((d) => d.epoch === 29_990).length, 1)
})

test('readAccount projects unreserved funds without clamping', async () => {
  const client = createPublicClient({
    chain: calibration,
    transport: custom({
      async request({ method }) {
        if (method === 'eth_blockNumber') return '0x3e8' // 1000
        // funds, lockupCurrent, lockupRate, lastSettledAt
        if (method === 'eth_call') return encodeAbiParameters(parseAbiParameters('uint256, uint256, uint256, uint256'), [100n, 30n, 1n, 900n])
        throw new Error(`unexpected ${method}`)
      },
    }),
  })
  const a = await readAccount(client, { payer: PAYER, token: calibration.contracts.usdfc.address })
  assert.equal(a.unreserved, 100n - 30n - 100n) // -30: in deficit
  assert.equal(a.runwayInEpochs, 0n)
  assert.equal(a.ratePerEpoch, 1n)
})
