#!/usr/bin/env node
/**
 * Feed the corgi from the command line: approve USDFC if needed, then
 * FilecoinPayV1.deposit(token, to = corgi payer, amount). Same path the
 * page uses, so it exercises the attributed-deposit event end to end.
 *
 * Usage:
 *   node apps/corgi/scripts/feed.mjs <config.json> <amount-usdfc> [--key ENV_NAME]
 *
 * Signs with $FEEDER_KEY by default (or the env var named by --key). Env is
 * expected to be loaded already: set -a; . config.env; . .env; set +a
 */
import fs from 'node:fs'
import { createPublicClient, createWalletClient, formatUnits, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainOf, feed, feederBalance, tokenOf } from '../chain.js'

const [configPath, amountText, ...rest] = process.argv.slice(2)
if (!configPath || !amountText) {
  console.error('usage: node apps/corgi/scripts/feed.mjs <config.json> <amount-usdfc> [--key ENV_NAME]')
  process.exit(1)
}
const keyName = rest[0] === '--key' ? rest[1] : 'FEEDER_KEY'
const key = process.env[keyName]
if (!key) {
  console.error(`missing $${keyName}; load .env first`)
  process.exit(1)
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const chain = chainOf(config.chain)
const token = tokenOf(chain, config.token)
const account = privateKeyToAccount(key)
const client = createPublicClient({ chain, transport: http() })
const wallet = createWalletClient({ account, chain, transport: http() })
const amount = parseUnits(amountText, 18)

const { balance } = await feederBalance(client, { address: account.address, token })
console.log(`feeder ${account.address} has ${formatUnits(balance, 18)} USDFC; feeding ${amountText} to ${config.payer}`)
const result = await feed({
  wallet, client, chain, token, payer: config.payer, amount,
  onStage: (s) => console.log(`  ${s.name}${s.hash ? ` ${s.hash}` : ''}`),
})
console.log(`fed in epoch ${result.epoch}: ${chain.blockExplorers.default.url}/tx/${result.hash}`)
