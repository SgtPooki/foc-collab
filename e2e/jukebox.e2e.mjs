#!/usr/bin/env node
/**
 * Jukebox proof: a wallet inserts a coin (USDFC deposit to the jukebox's
 * payer account), signs a pick, and the pick joins the shared queue, all
 * from the page through a fake EIP-1193 provider backed by a funded
 * calibration key. No session key, no data set of the listener's.
 *
 *   E2E_WALLET_KEY=0x.. E2E_URL=http://localhost:4173/ node e2e/jukebox.e2e.mjs
 * Prereqs: a built jukebox page (scripts/build-page.mjs <dir> site/jukebox.config.json --game jukebox)
 * served at E2E_URL. Allow ~5 minutes.
 */
import assert from 'node:assert/strict'
import { calibration } from '@filoz/synapse-core/chains'
import { chromium } from 'playwright'
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const URL = process.env.E2E_URL ?? 'http://localhost:4173/'
const KEY = process.env.E2E_WALLET_KEY
if (!KEY) {
  console.error('E2E_WALLET_KEY=0x.. (a funded calibration wallet) is required')
  process.exit(1)
}
const T = 480000
const account = privateKeyToAccount(KEY)
const transport = http(calibration.rpcUrls.default.http[0])
const pub = createPublicClient({ chain: calibration, transport })
const wallet = createWalletClient({ account, chain: calibration, transport })
const log = (who, ...a) => console.log(`[${new Date().toISOString().slice(11, 19)}] [${who}]`, ...a)
const signed = []

async function walletRpc(method, params = []) {
  switch (method) {
    case 'eth_requestAccounts':
    case 'eth_accounts':
      return [account.address]
    case 'eth_chainId':
      return `0x${calibration.id.toString(16)}`
    case 'eth_sendTransaction': {
      const tx = params[0]
      signed.push('eth_sendTransaction')
      const hash = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value == null ? undefined : BigInt(tx.value), gas: tx.gas == null ? undefined : BigInt(tx.gas) })
      log('wallet', 'sent tx', hash.slice(0, 18))
      return hash
    }
    case 'personal_sign':
      signed.push('personal_sign')
      return account.signMessage({ message: { raw: params[0] } })
    default:
      return pub.request({ method, params })
  }
}

const browser = await chromium.launch()
const context = await browser.newContext()
await context.exposeFunction('__walletRpc', (method, params) => walletRpc(method, params).then((result) => ({ result }), (err) => ({ error: { message: err?.shortMessage ?? err?.message ?? String(err) } })))
await context.addInitScript(() => {
  window.ethereum = {
    isMetaMask: true,
    async request({ method, params }) {
      const out = await window.__walletRpc(method, JSON.parse(JSON.stringify(params ?? [])))
      if (out.error) throw new Error(out.error.message)
      return out.result
    },
    on() {},
    removeListener() {},
  }
})
const page = await context.newPage()
page.on('pageerror', (e) => log('page', 'PAGEERROR', String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') log('page', 'CONSOLE', m.text().slice(0, 200)) })
const status = async () => (await page.locator('#status').textContent()).trim()

await page.goto(URL)
await page.locator('#status').filter({ hasText: /connect a wallet|credit/ }).waitFor({ timeout: T })
log('page', await status())
await page.click('#coin-connect')
await page.locator('#status').filter({ hasText: /insert a coin|credit/ }).waitFor({ timeout: T })
log('page', await status())
const before = Number((await status()).match(/(\d+) credit/)?.[1] ?? 0)
await page.click('#coin')
await page.locator('#status').filter({ hasText: new RegExp(`you have ${before + 1} credit`) }).waitFor({ timeout: T })
log('page', await status())
assert.ok(signed.includes('eth_sendTransaction'), 'the coin went through the wallet')
await page.fill('#track', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')
await page.fill('#title', `jukebox proof ${new Date().toISOString().slice(11, 19)}`)
await page.click('#pick')
await page.locator('#status').filter({ hasText: /pick sent/ }).waitFor({ timeout: T })
log('page', await status())
assert.ok(signed.includes('personal_sign'), 'the pick was signed by the wallet')
await page.locator('#queue li.mine').waitFor({ timeout: T })
log('page', 'queued:', await page.locator('#queue li.mine').last().textContent())
log('page', await status())
log('page', await page.locator('#meta').textContent())
log('proof', 'PASS: coin (deposit) -> wallet-signed pick -> shared queue, from the page;', page.url())
await browser.close()
