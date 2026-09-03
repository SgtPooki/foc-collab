#!/usr/bin/env node
/**
 * Acceptance test against the live calibration corgi.
 *
 * Happy path: a browser opens the built page, the corgi renders from real
 * chain reads, a feeder wallet (injected EIP-1193 provider signing with
 * $FEEDER_KEY) connects and feeds it, and the page shows the staged
 * progress, the confirmed deposit, and the updated feed log.
 *
 * Death arc (E2E_DEATH_ARC=1): the corgi's own key withdraws unreserved
 * funds until runway is under the death line, the page shows the memorial
 * with its countdown, the feeder revives it through the UI, and the page
 * shows the next generation with the previous one on the memorial wall.
 *
 * Prereqs: built page in $E2E_DIR (default dist/corgi) with a config block;
 * env loaded (set -a; . config.env; . .env; set +a). Spends real testnet
 * funds; allow ~10 minutes with the death arc.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright'
import { createPublicClient, createWalletClient, formatUnits, http as httpTransport } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { withdraw } from '@filoz/synapse-core/pay'
import { chainOf, readCorgi, tokenOf, waitForEpoch, waitForReceipt } from './chain.js'
import { EPOCHS_PER_DAY, DEFAULT_CONFIG, fold } from './fold.js'

const DIR = process.env.E2E_DIR ?? 'dist/corgi'
const PORT = Number(process.env.E2E_PORT ?? 4173)
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8')
const config = JSON.parse(html.match(/id="corgi-config">(.*?)<\/script>/)[1])
const chain = chainOf(config.chain)
const token = tokenOf(chain, config.token)
const feederKey = process.env.FEEDER_KEY
const corgiKey = process.env.PRIVATE_KEY
assert.ok(feederKey, 'FEEDER_KEY missing')
const feeder = privateKeyToAccount(feederKey)
const rpc = createPublicClient({ chain, transport: httpTransport() })
const feederWallet = createWalletClient({ account: feeder, chain, transport: httpTransport() })
const log = (...a) => console.log('[e2e]', ...a)

// ------------------------------------------------------------ static server
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' }
const server = http.createServer((req, res) => {
  const file = path.join(DIR, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0])
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(PORT, r))
const URL = `http://localhost:${PORT}/`

// ------------------------------------------------------------ injected wallet
/** Node side of the EIP-1193 shim: signs with the feeder key, forwards reads. */
async function walletRequest({ method, params = [] }) {
  if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [feeder.address]
  if (method === 'eth_chainId') return `0x${chain.id.toString(16)}`
  if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return null
  if (method === 'eth_sendTransaction') {
    const tx = params[0]
    return feederWallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined, gas: tx.gas ? BigInt(tx.gas) : undefined })
  }
  return rpc.request({ method, params })
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const context = await browser.newContext({ viewport: { width: 1000, height: 1400 } })
await context.exposeFunction('__walletRequest', async (args) => {
  const out = await walletRequest(args)
  return JSON.parse(JSON.stringify(out, (_, v) => (typeof v === 'bigint' ? `0x${v.toString(16)}` : v)))
})
await context.addInitScript(() => {
  window.ethereum = {
    isE2E: true,
    request: (args) => window.__walletRequest(args),
    on() {}, removeListener() {},
  }
})
const page = await context.newPage()
page.on('pageerror', (e) => log('PAGEERROR', String(e).slice(0, 300)))

async function snapshot() {
  const read = await readCorgi(rpc, config, {})
  const state = fold({ payer: read.payer, account: read.account, deposits: read.deposits, withdrawals: read.withdrawals }, DEFAULT_CONFIG)
  return { read, state }
}
async function open() {
  await page.goto(URL)
  await page.locator('#banner').waitFor({ state: 'hidden', timeout: 300000 })
}
async function feedViaUi(amount) {
  await page.locator('#connect').click()
  await page.locator('#wallet-line').filter({ hasText: feeder.address.slice(0, 6) }).waitFor({ timeout: 60000 })
  await page.locator('#amount').fill(amount)
  await page.locator('#feed').click()
  await page.locator('#feed-status').filter({ hasText: /Step \d of 2/ }).waitFor({ timeout: 60000 })
  assert.ok(await page.locator('#feed').isDisabled(), 'feed button locked while a transaction is in flight')
  await page.locator('#feed-status.ok').filter({ hasText: /^Fed / }).waitFor({ timeout: 600000 })
  const status = await page.locator('#feed-status').textContent()
  log('feed status:', status)
  const epoch = Number(status.match(/in epoch (\d+)/)[1])
  await waitForEpoch(rpc, epoch)
  // tx hashes are not stable identifiers on Filecoin (the block may carry a
  // different hash than eth_sendRawTransaction returned), so match by epoch
  await page.locator(`#feed-log td[title="epoch ${epoch}"]`).first().waitFor({ timeout: 180000 })
  return epoch
}

// ------------------------------------------------------------ happy path
let cdnHits = 0
page.on('request', (r) => { if (/esm\.sh|cdn\.jsdelivr|unpkg|cdnjs/.test(r.url())) cdnHits++ })

const before = await snapshot()
log('before: life', before.state.life, 'runway', before.state.runwayEpochs, 'epochs, deposits', before.state.feed.length, 'gen', before.state.generation)
await open()
assert.equal(await page.locator('#gen-badge').textContent(), `generation ${before.state.generation}`)
assert.ok((await page.locator('#feed-log tr').count()) >= before.state.feed.length, 'feed log rendered')
assert.equal(cdnHits, 0, 'no runtime CDN requests')

const rowsBefore = await page.locator('#feed-log tr').count()
const fedEpoch = await feedViaUi('0.05')
const after = await snapshot()
assert.ok(after.state.feed.some((f) => f.epoch === fedEpoch && f.from.toLowerCase() === feeder.address.toLowerCase()), 'deposit attributed to the feeder on-chain')
assert.equal(await page.locator('#feed-log tr').count(), rowsBefore + 1, 'feed log grew by one')
assert.ok(after.state.runwayEpochs > before.state.runwayEpochs - 20, 'runway did not fall')
log('happy path PASS; runway now', after.state.runwayEpochs, 'epochs')

// ------------------------------------------------------------ death arc
if (process.env.E2E_DEATH_ARC === '1') {
  assert.ok(corgiKey, 'PRIVATE_KEY (corgi payer) missing')
  const corgiWallet = createWalletClient({ account: privateKeyToAccount(corgiKey), chain, transport: httpTransport() })
  const { state, read } = await snapshot()
  if (state.life === 'dead') {
    log('corgi is already dead (a previous run drained it); skipping the withdrawal')
  } else {
    const rate = read.account.ratePerEpoch
    const keep = rate * BigInt(Math.floor(DEFAULT_CONFIG.deathDays * EPOCHS_PER_DAY * 0.6)) // leave ~4 days
    const amount = read.account.unreserved - keep
    assert.ok(amount > 0n, 'nothing to withdraw')
    log(`withdrawing ${formatUnits(amount, 18)} USDFC from the corgi to force death`)
    const wh = await withdraw(corgiWallet, { token, amount })
    const receipt = await waitForReceipt(rpc, wh)
    assert.equal(receipt.status, 'success')
    await waitForEpoch(rpc, Number(receipt.blockNumber))
  }

  const dead = await snapshot()
  assert.equal(dead.state.life, 'dead')
  assert.equal(dead.state.memorial?.diedEpoch != null, true)
  log('dead: memorial ends in', dead.state.memorial.endsInEpochs, 'epochs; revive needs', formatUnits(dead.state.memorial.reviveNeeds, 18), 'USDFC')
  await open()
  await page.locator('#memorial-panel').waitFor({ state: 'visible', timeout: 60000 })
  assert.match(await page.locator('#memorial-countdown').textContent(), /ceases to exist in/)
  assert.match(await page.locator('#headline').textContent(), /In memoriam/)
  await page.screenshot({ path: path.join(DIR, '..', 'e2e-dead.png'), fullPage: true })

  const reviveAmount = Number(formatUnits(dead.state.memorial.reviveNeeds, 18)) * 1.5 + 0.001
  log(`reviving with ${reviveAmount.toFixed(4)} USDFC through the UI`)
  await feedViaUi(reviveAmount.toFixed(4))
  const revived = await snapshot()
  assert.notEqual(revived.state.life, 'dead', 'revived')
  assert.equal(revived.state.generation, dead.state.generation + 1, 'new generation')
  assert.equal(revived.state.generations.length, dead.state.generation, 'previous generation on the wall')
  await page.locator('#gen-badge').filter({ hasText: `generation ${revived.state.generation}` }).waitFor({ timeout: 120000 })
  assert.ok((await page.locator('#wall article').count()) >= 1, 'memorial wall shows the past generation')
  await page.screenshot({ path: path.join(DIR, '..', 'e2e-revived.png'), fullPage: true })
  log('death arc PASS: generation', revived.state.generation, 'alive with', revived.state.runwayEpochs, 'epochs of runway')
}

await browser.close()
server.close()
log('PASS')
