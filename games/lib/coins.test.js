import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calibration } from '@filoz/synapse-core/chains'
import { readCoins } from './coins.js'

const USDFC = calibration.contracts.usdfc.address
const payer = '0x6D15ed940A0aaD981C5Ef712a98dEd35DC4448F1'
const log = (token, blockNumber, i) => ({ args: { token, from: '0xfeed', to: payer, amount: 10n ** 16n }, blockNumber, transactionHash: `0x${i}`, logIndex: 0n })

test('readCoins filters the token on the logs, not in the RPC topic filter', async () => {
  const filters = []
  const client = {
    getBlockNumber: async () => 1500n,
    getLogs: async (args) => {
      filters.push(args.args)
      return [log(USDFC, 1001n, 1), log('0x000000000000000000000000000000000000dead', 1002n, 2), log(USDFC.toUpperCase(), 1003n, 3)]
    },
  }
  const store = new Map()
  const { deposits } = await readCoins(client, { payer, fromBlock: 1000, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) } })
  assert.deepEqual(filters, [{ to: payer }])
  assert.deepEqual(deposits.map((d) => d.epoch), [1001, 1003])
  assert.equal(deposits[0].amount, 10n ** 16n)
})
