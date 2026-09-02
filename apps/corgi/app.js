/**
 * Page controller. Reads the config block, runs the chain reads, folds, and
 * renders. Feeding runs through chain.feed with every stage narrated.
 */
import { DEFAULT_CONFIG, EPOCHS_PER_DAY, fold } from './fold.js'
import { corgiSvg, traitsOf } from './sprite.js'
import * as chain from './chain.js'

const $ = (id) => document.getElementById(id)
const REFRESH_MS = 60_000

function readConfig() {
  const block = document.getElementById('corgi-config')
  const params = new URLSearchParams(location.search)
  const fromBlock = block ? JSON.parse(block.textContent) : {}
  return {
    chain: params.get('chain') ?? fromBlock.chain ?? 'calibration',
    payer: params.get('payer') ?? fromBlock.payer ?? null,
    fromBlock: Number(params.get('fromBlock') ?? fromBlock.fromBlock ?? 0),
    rpcUrl: fromBlock.rpcUrl,
    token: fromBlock.token,
    adoptionThreshold: fromBlock.adoptionThreshold,
  }
}

const config = readConfig()
const foldConfig = {
  ...DEFAULT_CONFIG,
  ...(config.adoptionThreshold ? { adoptionThreshold: chain.parseUnits(String(config.adoptionThreshold), 18) } : {}),
}
const net = chain.chainOf(config.chain)
const client = chain.publicClient(net, config.rpcUrl)
const token = chain.tokenOf(net, config.token)
const explorer = net.blockExplorers.default.url

let view = null
let wallet = null
let feeding = false

// ---------------------------------------------------------------- format

const usd = (wei, digits = 2) => {
  const n = Number(chain.formatUnits(wei, 18))
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
const daysOf = (epochs) => (epochs === Infinity ? Infinity : epochs / EPOCHS_PER_DAY)
const fmtDays = (epochs) => {
  if (epochs === Infinity) return 'unlimited'
  const d = daysOf(epochs)
  if (d >= 2) return `${d.toFixed(d >= 30 ? 0 : 1)} days`
  const h = epochs / 120
  if (h >= 2) return `${h.toFixed(0)} hours`
  return `${epochs} epochs`
}
const fmtDate = (clock, epoch) => new Date(clock(epoch) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const ago = (clock, epoch) => {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - clock(epoch))
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
const txLink = (hash) => `<a class="mono" href="${explorer}/tx/${hash}" target="_blank" rel="noopener">${hash.slice(0, 10)}…</a>`
const addrLink = (a) => `<a class="mono" href="${explorer}/address/${a}" target="_blank" rel="noopener" title="${a}">${short(a)}</a>`

// ---------------------------------------------------------------- banner

function banner(text, { progress = null, error = false } = {}) {
  const el = $('banner')
  el.hidden = false
  el.classList.toggle('error', error)
  $('banner-text').textContent = text
  const bar = $('banner-progress')
  bar.hidden = progress == null
  if (progress != null) bar.value = progress
}
function hideBanner() { $('banner').hidden = true }

// ---------------------------------------------------------------- render

function lifeCopy(s) {
  if (s.life === 'unfunded') return 'Nothing is being stored yet, so there is no runway to spend. The corgi has no life to lose and no life to live.'
  if (s.life === 'thriving') return 'Runway is over three months. The corgi is thriving.'
  if (s.life === 'fine') return 'Runway is between one and three months. The corgi is doing fine, but it is watching the calendar.'
  if (s.life === 'sick') return 'Runway is under a month. The corgi is sick. A deposit now keeps it out of the critical zone.'
  if (s.life === 'critical') return 'Runway is under two weeks. The corgi is critical. Under seven days it dies, and the memorial clock starts.'
  return 'The corgi is dead. Its funds still pay the storage provider for a while, which is why this page still exists.'
}

function moodCopy(s) {
  const company = s.park.length > 0 ? ` It has ${s.park.length} adopted corgi${s.park.length === 1 ? '' : 's'} for company.` : ''
  if (s.mood === 'lonely') return `Nobody has fed it in the last ${foldConfig.moodWindowDays} days. Money keeps it alive; only people keep it happy.${company}`
  if (s.mood === 'content') return `One address fed it this week. It is content, not happy. A second feeder would change that.${company}`
  if (s.mood === 'happy') return `${s.distinctFeeders} different addresses fed it this week. It is happy.${company}`
  return `${s.distinctFeeders} different addresses fed it this week. It is ecstatic.${company}`
}

function barClass(life) {
  if (life === 'dead') return 'dead'
  if (life === 'critical' || life === 'sick') return 'bad'
  if (life === 'fine') return 'warn'
  return ''
}

/**
 * The life bar is zoned, not linear: each threshold band gets a fixed share
 * of the width so the dangerous end stays legible when runway is months.
 */
function lifeZones() {
  const c = foldConfig
  return [
    [0, 0], [c.deathDays, 15], [c.criticalDays, 30], [c.sickDays, 50], [c.thrivingDays, 80], [c.thrivingDays * 2, 100],
  ]
}
function lifePercent(days) {
  if (days === Infinity) return 100
  const zones = lifeZones()
  for (let i = 1; i < zones.length; i++) {
    const [d0, p0] = zones[i - 1]
    const [d1, p1] = zones[i]
    if (days <= d1) return p0 + ((days - d0) / (d1 - d0)) * (p1 - p0)
  }
  return 100
}
function renderLife(s) {
  $('life-days').textContent = s.life === 'unfunded' ? 'no spend' : fmtDays(s.runwayEpochs)
  const bar = $('life-bar')
  bar.className = `bar ${barClass(s.life)}`
  bar.querySelector('i').style.width = `${lifePercent(daysOf(s.runwayEpochs))}%`
  const labels = ['', 'dead', 'critical', 'sick', 'fine', 'thriving']
  $('life-ticks').innerHTML = lifeZones().slice(1, 5).map(([d, p], i) => `<span style="left:${p}%" title="${labels[i + 1]} below ${d} days">${d}d</span>`).join('')
}

function renderMood(s) {
  $('mood-window').textContent = foldConfig.moodWindowDays
  $('mood-count').textContent = `${s.distinctFeeders} (${s.mood})`
  $('mood-bar').querySelector('i').style.width = `${Math.min(100, (s.distinctFeeders / 4) * 100)}%`
}

function renderMascot(s) {
  const el = $('mascot')
  el.className = `sprite ${s.life === 'dead' ? 'dead' : 'alive'} ${s.life}`
  el.style.setProperty('--tempo', `${traitsOf(s.payer).tempo}s`)
  el.innerHTML = corgiSvg(s.payer, { life: s.life, mood: s.mood, title: `The FOC corgi, generation ${s.generation}: ${s.life}, ${s.mood}` })
}

function renderMemorial(s, clock) {
  const panel = $('memorial-panel')
  if (s.memorial == null) { panel.hidden = true; return }
  panel.hidden = false
  const gen = s.generations[s.generations.length - 1]
  $('memorial-title').textContent = `Generation ${s.generation} died`
  const diedWhen = gen ? fmtDate(clock, gen.died.epoch) : 'before the first recorded deposit'
  $('memorial-text').textContent = `Runway fell under ${foldConfig.deathDays} days at ${diedWhen} (epoch ${s.memorial.diedEpoch}). The remaining funds keep paying the storage provider through the lockup tail, and when they run out the provider may delete the data. This page is that countdown.`
  $('memorial-countdown').textContent = s.memorial.endsInEpochs === Infinity ? 'no spend, no end' : `This memorial ceases to exist in ${fmtDays(s.memorial.endsInEpochs)}`
  $('memorial-note').textContent = `Estimated from gross coverage (funds divided by lockup rate). Revive it by feeding at least ${usd(s.memorial.reviveNeeds, 4)} USDFC, which lifts runway back over the death line and starts generation ${s.generation + 1}.`
}

function renderPark(s, clock) {
  $('park-count').textContent = s.park.length ? `${s.park.length} adopted` : ''
  $('park').classList.toggle('park', s.park.length > 0)
  if (s.park.length === 0) {
    $('park').innerHTML = `<p class="empty">Nobody has adopted a corgi yet. A single deposit of ${usd(foldConfig.adoptionThreshold)} USDFC or more spawns one that looks like its owner's address.</p>`
    return
  }
  $('park').innerHTML = s.park.map((p) => `<figure>${corgiSvg(p.owner, { life: 'fine', mood: s.mood, title: `corgi adopted by ${p.owner}` })}<figcaption>${addrLink(p.owner)}<br>${ago(clock, p.epoch)}</figcaption></figure>`).join('')
}

function renderFeedLog(s, clock) {
  $('feed-total').textContent = s.feed.length ? `${s.feed.length} deposits, ${usd(s.totalFed)} USDFC total` : ''
  if (s.feed.length === 0) {
    $('feed-log').innerHTML = '<tr><td colspan="4" class="empty">No deposits recorded for this payer since the configured start block.</td></tr>'
    return
  }
  $('feed-log').innerHTML = s.feed.slice(0, 200).map((f) => {
    const adopt = f.amount >= foldConfig.adoptionThreshold && f.from.toLowerCase() !== s.payer ? ' <span class="badge">adopt</span>' : ''
    return `<tr><td title="epoch ${f.epoch}">${ago(clock, f.epoch)}<br><span class="small muted">${fmtDate(clock, f.epoch)}</span></td><td>${addrLink(f.from)}${adopt}</td><td class="num">${usd(f.amount, 4)}</td><td>${txLink(f.txHash)}</td></tr>`
  }).join('')
}

function renderWall(s, clock) {
  if (s.generations.length === 0) {
    $('wall').innerHTML = '<p class="empty">No corgi has died yet. When one does, its final state is recorded here, folded from the same deposit log as everything else.</p>'
    return
  }
  $('wall').innerHTML = s.generations.map((g, i) => `<article>${corgiSvg(`${s.payer}${i}`, { life: 'dead', title: `generation ${i + 1}` })}<div><p><strong>Generation ${i + 1}</strong></p><p class="small muted">Born ${fmtDate(clock, g.born.epoch)} by ${addrLink(g.born.by)}. Died ${fmtDate(clock, g.died.epoch)} when runway fell under ${foldConfig.deathDays} days.</p></div></article>`).join('')
}

function render(v) {
  const { state: s, clock, account } = v
  document.title = `FOC Corgi: ${s.life === 'dead' ? 'in memoriam' : s.life}, ${s.mood}`
  $('chain-badge').textContent = `${net.name.replace('Filecoin - ', '')} · epoch ${s.epoch}`
  $('gen-badge').textContent = `generation ${s.generation}`
  $('payer-link').textContent = short(s.payer)
  $('payer-link').href = `${explorer}/address/${s.payer}`
  $('headline').textContent = s.life === 'dead' ? 'In memoriam' : `${s.life[0].toUpperCase()}${s.life.slice(1)} and ${s.mood}`
  $('lede').textContent = `${lifeCopy(s)} ${moodCopy(s)}`
  $('account-line').textContent = `Account: ${usd(account.funds, 4)} USDFC in Filecoin Pay, spending ${usd(account.ratePerEpoch * BigInt(EPOCHS_PER_DAY), 4)} USDFC a day. Gross coverage ${fmtDays(s.grossCoverageEpochs)}.`
  $('adopt-threshold').textContent = usd(foldConfig.adoptionThreshold)
  $('contracts-line').textContent = `Filecoin Pay ${net.contracts.filecoinPay.address} · USDFC ${token} · payer ${s.payer}`
  renderLife(s); renderMood(s); renderMascot(s); renderMemorial(s, clock); renderPark(s, clock); renderFeedLog(s, clock); renderWall(s, clock)
}

// ---------------------------------------------------------------- load

async function load({ quiet = false } = {}) {
  if (!config.payer) {
    banner('No corgi configured. Build the page with a config file, or open it with ?payer=0x… on the URL.', { error: true })
    return
  }
  if (!quiet) banner('Reading the corgi\'s account and scanning its feed log.', { progress: 0 })
  try {
    const read = await chain.readCorgi(client, config, {
      storage: window.localStorage,
      onProgress: ({ scanned, total }) => {
        if (!quiet) banner(`Scanning deposit events: ${Math.round((scanned / total) * 100)}% of ${total.toLocaleString()} blocks.`, { progress: (scanned / total) * 100 })
      },
    })
    const state = fold({ payer: read.payer, account: read.account, deposits: read.deposits }, foldConfig)
    view = { state, clock: read.clock, account: read.account }
    render(view)
    hideBanner()
  } catch (err) {
    console.error(err)
    banner(`Chain read failed: ${err?.shortMessage ?? err?.message ?? err}. Showing nothing rather than guessing. Retrying in a minute.`, { error: true })
  }
}

// ---------------------------------------------------------------- feeding

function feedStatus(text, cls = '') {
  const el = $('feed-status')
  el.className = cls
  el.innerHTML = text
}

async function connect() {
  const provider = window.ethereum
  if (!provider) {
    feedStatus('No wallet found. Install a browser wallet with Filecoin calibration support, then reload.', 'error')
    return
  }
  try {
    feedStatus('Waiting for the wallet to approve the connection and switch to the corgi\'s network.')
    wallet = await chain.connectWallet(provider, net)
    const { balance } = await chain.feederBalance(client, { address: wallet.address, token })
    $('wallet-line').textContent = `${short(wallet.address)} · ${usd(balance, 4)} USDFC`
    $('feed').disabled = false
    $('connect').textContent = 'Connected'
    feedStatus('')
  } catch (err) {
    feedStatus(`Wallet connection failed: ${err?.shortMessage ?? err?.message ?? err}`, 'error')
  }
}

const STAGE_COPY = {
  'approve:sign': 'Step 1 of 2: approve USDFC for the Filecoin Pay contract in your wallet.',
  'approve:pending': 'Step 1 of 2: approval sent, waiting for the chain to confirm it (about a minute).',
  'deposit:sign': 'Step 2 of 2: sign the deposit in your wallet.',
  'deposit:pending': 'Step 2 of 2: deposit sent, waiting for confirmation (about a minute).',
}

async function submitFeed(ev) {
  ev.preventDefault()
  if (feeding || wallet == null) return
  let amount
  try {
    amount = chain.parseUnits($('amount').value.trim(), 18)
    if (amount <= 0n) throw new Error('amount must be positive')
  } catch {
    feedStatus('Enter a positive USDFC amount, for example 1 or 2.5.', 'error')
    return
  }
  feeding = true
  $('feed').disabled = true
  try {
    const result = await chain.feed({
      wallet: wallet.wallet, client, chain: net, token, payer: config.payer, amount,
      onStage: ({ name, hash }) => {
        if (name === 'done') return
        feedStatus(`${STAGE_COPY[name]}${hash ? ` ${txLink(hash)}` : ''}`)
      },
    })
    feedStatus(`Fed ${usd(amount, 4)} USDFC in epoch ${result.epoch}. ${txLink(result.hash)}. Refreshing the corgi.`, 'ok')
    await load({ quiet: true })
    feedStatus(`Fed ${usd(amount, 4)} USDFC in epoch ${result.epoch}. ${txLink(result.hash)}`, 'ok')
  } catch (err) {
    feedStatus(`Feeding failed: ${err?.shortMessage ?? err?.message ?? err}`, 'error')
  } finally {
    feeding = false
    $('feed').disabled = false
  }
}

$('connect').addEventListener('click', connect)
$('feed-form').addEventListener('submit', submitFeed)
for (const b of document.querySelectorAll('button.preset')) b.addEventListener('click', () => { $('amount').value = b.dataset.amount })

await load()
setInterval(() => { if (!feeding) load({ quiet: true }) }, REFRESH_MS)
