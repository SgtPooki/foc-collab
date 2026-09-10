#!/usr/bin/env node
/**
 * Wallet-connect proof: a fresh, funded calibration wallet with no data
 * set, no session key, and no deposit becomes a player from the page
 * alone. The browser sees a standard EIP-1193 provider (window.ethereum)
 * whose signing is done here in node with the wallet's key, exactly the
 * calls MetaMask would answer: eth_requestAccounts, eth_chainId,
 * eth_sendTransaction, eth_signTypedData_v4. Everything else is
 * forwarded to the public RPC. The page must: connect, deposit USDFC and
 * approve the storage service, authorize an AddPieces-only session key,
 * create the data set, store the descriptor, reload into play mode, and
 * then create a game through that session key.
 *
 * Prereqs: built page served at E2E_URL (default http://localhost:4173/),
 * and E2E_WALLET_KEY = private key of a wallet holding tFIL and USDFC on
 * calibration (scripts/byow-fund-wallet.mjs 5 25 C mints one). Spends
 * gas plus the 5 USDFC deposit; allow ~8 minutes.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { calibration } from '@filoz/synapse-core/chains'
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

/** What a browser wallet does with each request. */
async function walletRpc(method, params = []) {
  switch (method) {
    case 'eth_requestAccounts':
    case 'eth_accounts':
      return [account.address]
    case 'eth_chainId':
      return `0x${calibration.id.toString(16)}`
    case 'wallet_switchEthereumChain':
    case 'wallet_addEthereumChain':
      return null
    case 'eth_sendTransaction': {
      const tx = params[0]
      signed.push('eth_sendTransaction')
      const hash = await wallet.sendTransaction({
        to: tx.to,
        data: tx.data,
        value: tx.value == null ? undefined : BigInt(tx.value),
        gas: tx.gas == null ? undefined : BigInt(tx.gas),
      })
      log('wallet', 'sent tx', hash.slice(0, 18))
      return hash
    }
    case 'eth_signTypedData_v4': {
      signed.push('eth_signTypedData_v4')
      const typed = JSON.parse(params[1])
      const { EIP712Domain, ...types } = typed.types
      void EIP712Domain
      const sig = await account.signTypedData({ domain: typed.domain, types, primaryType: typed.primaryType, message: typed.message })
      log('wallet', 'signed typed data', typed.primaryType)
      return sig
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
await context.exposeFunction('__walletRpc', (method, params) => walletRpc(method, params).then(
  (result) => ({ result }),
  (err) => ({ error: { message: err?.shortMessage ?? err?.message ?? String(err), code: err?.code } }),
))
await context.addInitScript(() => {
  window.ethereum = {
    isMetaMask: true,
    async request({ method, params }) {
      // Structured-clone the params so BigInts and proxies never cross the bridge.
      const out = await window.__walletRpc(method, JSON.parse(JSON.stringify(params ?? [])))
      if (out.error) {
        const e = new Error(out.error.message)
        e.code = out.error.code
        throw e
      }
      return out.result
    },
    on() {},
    removeListener() {},
  }
})
const page = await context.newPage()
page.on('dialog', (d) => d.accept('wallet-connect proof'))
page.on('pageerror', (e) => log('page', 'PAGEERROR', String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') log('page', 'CONSOLE', m.text().slice(0, 200)) })
process.on('uncaughtException', async (err) => {
  console.error(err)
  for (const id of ['#transport-label', '#wallet-status', '#status']) {
    log('page', id, String(await page.locator(id).textContent().catch(() => '?')).slice(0, 300))
  }
  process.exit(1)
})

log('proof', `wallet ${account.address}`)
await page.goto(URL)
await page.locator('#wallet-row').waitFor({ state: 'visible', timeout: T })
assert.match(await page.locator('#transport-label').textContent(), /spectator/)
await page.locator('#connect').click()
let last = ''
const started = Date.now()
for (;;) {
  const label = await page.locator('#transport-label').textContent().catch(() => '')
  if (/your data set #/.test(label)) break
  const stage = await page.locator('#wallet-status').textContent().catch(() => '')
  if (stage !== last) {
    log('page', stage)
    last = stage
  }
  if (/could not set up/.test(stage)) throw new Error(stage)
  if (Date.now() - started > T) throw new Error('provisioning timed out')
  await new Promise((r) => setTimeout(r, 2000))
}
const label = await page.locator('#transport-label').textContent()
log('page', 'provisioned:', label, 'wallet signatures:', signed.join(', '))
assert.ok(signed.includes('eth_sendTransaction'), 'session key authorization went through the wallet')
assert.ok(signed.includes('eth_signTypedData_v4'), 'data set creation was signed by the wallet')

// Now the session key, not the wallet, writes the create piece.
const before = signed.length
await page.locator('#lobby').waitFor({ state: 'visible', timeout: T })
await page.locator('#create').click()
await page.locator('#game').waitFor({ state: 'visible', timeout: T })
assert.equal(signed.length, before, 'creating a game asked the wallet for nothing')
await page.locator('#status').filter({ hasText: 'you are X' }).waitFor({ timeout: T })
log('proof', 'PASS: wallet -> deposit -> session key -> data set -> game, from the page;', page.url())
await browser.close()
