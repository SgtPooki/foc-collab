#!/usr/bin/env node
/**
 * Mint a second calibration wallet for the BYOW proof and fund it from the
 * wallet in .env: tFIL for gas, USDFC for the storage deposit. Appends the
 * new wallet's key to .env as PLAYER_B_PRIVATE_KEY (gitignored) and prints
 * only the address. Run `filecoin-pin payments setup` for it afterwards:
 *
 *   set -a; . ./config.env; . ./.env; set +a
 *   node scripts/byow-fund-wallet.mjs [tFIL] [USDFC]      (default 5 25)
 *   PRIVATE_KEY=$PLAYER_B_PRIVATE_KEY npx --yes filecoin-pin@latest payments setup --auto --deposit 10
 */
import fs from 'node:fs'
import { calibration } from '@filoz/synapse-core/chains'
import { createWalletClient, http, parseEther, parseUnits, publicActions } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const [filArg = '5', usdfcArg = '25'] = process.argv.slice(2)
const { PRIVATE_KEY } = process.env
if (!PRIVATE_KEY) {
  console.error('usage: PRIVATE_KEY=0x.. node scripts/byow-fund-wallet.mjs [tFIL] [USDFC]')
  process.exit(1)
}
if (process.env.PLAYER_B_PRIVATE_KEY) {
  console.error('PLAYER_B_PRIVATE_KEY already set in the environment; refusing to mint another')
  process.exit(1)
}

const funder = privateKeyToAccount(PRIVATE_KEY)
const client = createWalletClient({
  account: funder,
  chain: calibration,
  transport: http(calibration.rpcUrls.default.http[0]),
}).extend(publicActions)

const playerKey = generatePrivateKey()
const player = privateKeyToAccount(playerKey)
console.error(`minted player B wallet ${player.address}`)
// Persist before any transfer so an RPC flake mid-way cannot orphan funds.
fs.appendFileSync('.env', `PLAYER_B_PRIVATE_KEY=${playerKey}\nPLAYER_B_ADDRESS=${player.address}\n`)
console.error('appended PLAYER_B_PRIVATE_KEY and PLAYER_B_ADDRESS to .env')

// The public calibration RPC intermittently answers "requested a future
// epoch" while a new tipset settles; retry the whole step a few times.
async function retry(label, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= 5) throw err
      console.error(`${label}: attempt ${attempt} failed (${err?.shortMessage ?? err?.message}); retrying`)
      await new Promise((r) => setTimeout(r, 4000 * attempt))
    }
  }
}

console.error(`sending ${filArg} tFIL...`)
const filHash = await retry('tFIL send', () => client.sendTransaction({ to: player.address, value: parseEther(filArg) }))
await retry('tFIL receipt', () => client.waitForTransactionReceipt({ hash: filHash }))
console.error('tFIL landed')

console.error(`sending ${usdfcArg} USDFC...`)
const usdfcHash = await retry('USDFC send', () => client.writeContract({
  address: calibration.contracts.usdfc.address,
  abi: calibration.contracts.usdfc.abi,
  functionName: 'transfer',
  args: [player.address, parseUnits(usdfcArg, 18)],
}))
await retry('USDFC receipt', () => client.waitForTransactionReceipt({ hash: usdfcHash }))
console.error('USDFC landed')

console.log(player.address)
