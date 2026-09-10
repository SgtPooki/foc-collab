/**
 * Page controller. Reads the config block, runs the chain reads, folds,
 * renders the playground and the panels. Feeding runs through chain.feed
 * with every stage narrated.
 */
import { DEFAULT_CONFIG, EPOCHS_PER_DAY, RULES_VERSION, fold } from './fold.js'
import { corgiSvg } from './sprite.js'
import { describe, nameOf, rarityOf, traitsOf } from './traits.js'
import { createPark } from './park3d.js'
import * as chain from './chain.js'

const $ = (id) => document.getElementById(id)
const REFRESH_MS = 60_000
const WALLET_URL = 'https://metamask.io/download/'
const FAUCET_FIL = 'https://forest-explorer.chainsafe.dev/faucet/calibnet'
const FAUCET_USDFC = 'https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc'

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
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

let view = null
let wallet = null
let feeding = false

// ---------------------------------------------------------------- format

const usd = (wei, digits = 2) => Number(chain.formatUnits(wei, 18)).toLocaleString(undefined, { maximumFractionDigits: digits })
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`
const daysOf = (epochs) => (epochs === Infinity ? Infinity : epochs / EPOCHS_PER_DAY)
function fmtDays(epochs) {
  if (epochs === Infinity) return 'unlimited'
  const d = daysOf(epochs)
  if (d >= 2) return `${d.toFixed(d >= 30 ? 0 : 1)} days`
  const h = epochs / 120
  if (h >= 2) return `${h.toFixed(0)} hours`
  return `${Math.max(0, Math.round(epochs / 2))} minutes`
}
const fmtDate = (clock, epoch) => new Date(clock(epoch) * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const fmtDay = (clock, epoch) => new Date(clock(epoch) * 1000).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
function ago(clock, epoch) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - clock(epoch))
  if (s < 90) return 'just now'
  if (s < 5400) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}
const txLink = (hash) => `<a class="mono" href="${explorer}/tx/${hash}" target="_blank" rel="noopener">${hash.slice(0, 10)}…</a>`
const addrLink = (a) => `<a class="mono" href="${explorer}/address/${a}" target="_blank" rel="noopener" title="${a}">${short(a)}</a>`
const PLURALS = { person: 'people', 'different person': 'different people' }
const plural = (n, word) => `${n} ${n === 1 ? word : (PLURALS[word] ?? `${word}s`)}`
/** Days of life a deposit buys at the current spend rate. */
function daysBought(amount, rate) {
  if (rate <= 0n) return null
  return Number(amount / rate) / EPOCHS_PER_DAY
}

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

// ---------------------------------------------------------------- park

let park = null
function ensurePark() {
  if (park) return park
  try {
    park = createPark($('park-canvas'), { reducedMotion, onHover: showTooltip, onPick: showTooltip, onLabels: renderLabels })
  } catch (err) {
    console.error(err)
    $('stage').classList.add('fallback')
    $('stage-fallback').hidden = false
    $('stage-hint').hidden = true
  }
  return park
}

const labelEls = new Map()
function labelText(l) {
  if (l.role === 'mascot') return null
  if (l.role === 'ghost') return `${nameOf(l.address)}, yours?`
  return nameOf(l.address)
}
function renderLabels(list) {
  const host = $('labels')
  const seen = new Set()
  for (const l of list) {
    const text = labelText(l)
    if (text == null) continue
    seen.add(l.key)
    let el = labelEls.get(l.key)
    if (!el) {
      el = document.createElement('span')
      el.className = l.role
      el.textContent = text
      host.appendChild(el)
      labelEls.set(l.key, el)
    }
    el.style.left = `${l.x}px`
    el.style.top = `${l.y}px`
    el.style.opacity = String(Math.max(0.35, 1 - (l.depth - 0.9) * 6))
  }
  for (const [key, el] of labelEls) if (!seen.has(key)) { el.remove(); labelEls.delete(key) }
}

function showTooltip(hit) {
  const tip = $('tooltip')
  if (!hit || !view) { tip.hidden = true; return }
  const t = traitsOf(hit.address)
  const rarity = rarityOf(t)
  let who
  if (hit.role === 'mascot') who = `<strong>The FOC corgi</strong>, generation ${view.state.generation}. ${view.state.life}, ${view.state.mood}.`
  else if (hit.role === 'ghost') who = `<strong>${nameOf(hit.address)} could be yours.</strong> Feed ${usd(foldConfig.adoptionThreshold)} USDFC or more and it joins the park for good.`
  else {
    const p = view.state.park.find((x) => x.owner.toLowerCase() === hit.address.toLowerCase())
    who = `<strong>${nameOf(hit.address)}</strong>, ${short(hit.address)}'s corgi${p ? `, adopted ${ago(view.clock, p.epoch)}` : ''}.`
  }
  tip.innerHTML = `${who}<br><span class="muted">${describe(t)}${rarity ? ` · ${rarity}` : ''}</span>`
  tip.style.left = `${hit.x}px`
  tip.style.top = `${hit.y}px`
  tip.hidden = false
}

function renderPark(s) {
  const p = ensurePark()
  $('chip-gen').textContent = `generation ${s.generation}`
  $('chip-park').textContent = s.park.length ? `${plural(s.park.length, 'adopted corgi')} in the park` : 'the park is empty, adopt the first corgi'
  if (!p) return
  p.setState({
    payer: s.payer, life: s.life, mood: s.mood, park: s.park,
    ghost: wallet && !s.park.some((x) => x.owner.toLowerCase() === wallet.address.toLowerCase()) ? wallet.address : null,
    theme: darkQuery.matches ? 'dark' : 'light',
  })
}
darkQuery.addEventListener('change', () => { if (view) renderPark(view.state) })

// ---------------------------------------------------------------- copy

function headlineFor(s, clock) {
  if (s.life === 'dead') return 'In memoriam'
  if (s.life === 'unfunded') return 'Nothing to pay for yet'
  const left = fmtDays(s.lifeEpochs)
  if (s.life === 'critical') return `Critical. Dies in ${left} unless fed.`
  if (s.life === 'sick') return `Sick. ${left} of life left.`
  if (s.life === 'fine') return `Doing fine. ${left} of life left.`
  return `Thriving. ${left} of life left.`
}

function lifeCopy(s, clock) {
  if (s.life === 'unfunded') return 'Nothing is being stored yet, so there is no runway to spend and no life to lose.'
  if (s.life === 'dead') return 'The corgi is dead. Its remaining funds still pay the storage provider for a while, which is why this page still exists.'
  const when = s.deathEpoch ? ` If nobody feeds it, it dies on ${fmtDay(clock, s.deathEpoch)}.` : ''
  if (s.life === 'thriving') return `Runway is long.${when}`
  if (s.life === 'fine') return `More than a month of life, less than three.${when}`
  if (s.life === 'sick') return `Under a month of life left.${when} A feed now keeps it out of the critical zone.`
  return `Under a week of life left.${when} Below that, the memorial clock starts.`
}

function moodCopy(s) {
  const n = s.distinctFeeders
  if (s.life === 'dead') {
    if (n === 0) return 'Nobody has fed it this week. Whoever feeds it next brings it back.'
    return `${plural(n, 'person')} fed it this week. They are the ones who can bring it back.`
  }
  const company = s.park.length > 0 ? ` It has ${plural(s.park.length, 'adopted corgi')} for company.` : ''
  if (s.mood === 'lonely') return `Nobody has fed it in the last ${foldConfig.moodWindowDays} days, so it mopes even with money in the bank.${company}`
  if (s.mood === 'content') return `One person fed it this week. Content, not happy. A second feeder changes that.${company}`
  if (s.mood === 'happy') return `${plural(n, 'different person')} fed it this week. It is happy. One more and it is ecstatic.${company}`
  return `${plural(n, 'different person')} fed it this week. It is ecstatic.${company}`
}

function nextLifeHint(s, rate) {
  if (rate <= 0n || s.life === 'unfunded') return ''
  const steps = [['critical', foldConfig.criticalDays], ['sick', foldConfig.sickDays], ['fine', foldConfig.thrivingDays]]
  const runwayDays = daysOf(s.runwayEpochs)
  for (const [from, days] of steps) {
    if (runwayDays < days) {
      const need = BigInt(Math.ceil((days - runwayDays) * EPOCHS_PER_DAY)) * rate
      const next = { critical: 'sick', sick: 'fine', fine: 'thriving' }[from]
      return `About ${usd(need, 4)} USDFC lifts it to ${next}.`
    }
  }
  return 'Already thriving. Every feed still adds days.'
}

// ---------------------------------------------------------------- render

function barClass(life) {
  if (life === 'dead') return 'dead'
  if (life === 'critical' || life === 'sick') return 'bad'
  if (life === 'fine') return 'warn'
  return ''
}

/** Zoned life bar: each band gets a fixed share so the dangerous end stays legible. */
function lifeZones() {
  const c = foldConfig
  const d = c.deathDays
  return [[0, 0], [c.criticalDays - d, 22], [c.sickDays - d, 50], [c.thrivingDays - d, 80], [(c.thrivingDays - d) * 2, 100]]
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
function renderLife(s, account) {
  $('life-days').textContent = s.life === 'unfunded' ? 'no spend' : fmtDays(s.lifeEpochs)
  const bar = $('life-bar')
  bar.className = `bar ${barClass(s.life)}`
  bar.querySelector('i').style.width = `${lifePercent(daysOf(s.lifeEpochs))}%`
  const zones = lifeZones()
  const labels = ['critical', 'sick', 'fine', 'thriving']
  const ticks = zones.slice(1, 4).map(([d, p]) => `<span style="left:${p}%">${d}d</span>`)
  const words = labels.map((l, i) => `<span class="zone" style="left:${(zones[i][1] + zones[i + 1][1]) / 2}%">${l}</span>`)
  $('life-ticks').innerHTML = ticks.join('') + words.join('')
  $('life-hint').textContent = nextLifeHint(s, account.ratePerEpoch)
}

function renderMood(s) {
  $('mood-count').textContent = `${s.distinctFeeders} (${s.mood})`
  $('mood-bar').querySelector('i').style.width = `${Math.min(100, (s.distinctFeeders / 4) * 100)}%`
  $('mood-ticks').innerHTML = [[0, 'lonely'], [1, 'content'], [2, 'happy'], [4, 'ecstatic']].map(([n, l]) => `<span style="left:${Math.min((n / 4) * 100, 96)}%">${l}</span>`).join('')
}

function renderMemorial(s, clock) {
  const panel = $('memorial-panel')
  if (s.memorial == null) { panel.hidden = true; return }
  panel.hidden = false
  const gen = s.generations[s.generations.length - 1]
  $('memorial-title').textContent = `Generation ${s.generation} died`
  const diedWhen = gen ? fmtDate(clock, gen.died.epoch) : 'before the first recorded deposit'
  const cause = gen?.died.cause === 'withdrawn' ? 'Its owner pulled the money out from under it' : 'Nobody fed it in time'
  $('memorial-text').textContent = `${cause}: runway fell under ${foldConfig.deathDays} days at ${diedWhen} (epoch ${s.memorial.diedEpoch}). The remaining funds keep paying the storage provider through the lockup tail, and when they run out the provider may delete the data. This page is that countdown.`
  $('memorial-countdown').textContent = s.memorial.endsInEpochs === Infinity ? 'no spend, no end' : `This memorial ceases to exist in ${fmtDays(s.memorial.endsInEpochs)}`
  $('memorial-note').textContent = `Runway to deficit plus the 30-day lockup period, which is how long a terminated rail keeps paying the provider from the reserve. Feed at least ${usd(s.memorial.reviveNeeds, 4)} USDFC to bring it back as generation ${s.generation + 1}.`
}

function renderResidents(s, clock) {
  $('park-count').textContent = s.park.length ? `${s.park.length} adopted` : ''
  if (s.park.length === 0) {
    $('residents').innerHTML = `<p class="empty">Nobody has adopted a corgi yet. The first feed of ${usd(foldConfig.adoptionThreshold)} USDFC or more puts its sender's corgi in the park, for good. Connect a wallet to preview yours.</p>`
    return
  }
  $('residents').innerHTML = s.park.map((p) => {
    const t = traitsOf(p.owner)
    const rarity = rarityOf(t)
    return `<article>${corgiSvg(p.owner, { life: 'fine', mood: s.mood, title: describe(t) })}<div><p><strong>${nameOf(p.owner)}</strong>${rarity ? ` <span class="badge">${rarity}</span>` : ''}</p><p class="muted">${describe(t)}</p><p class="muted small">${addrLink(p.owner)}, adopted ${ago(clock, p.epoch)}</p></div></article>`
  }).join('')
}

function renderFeedLog(s, clock, account) {
  const deposits = s.feed.filter((f) => f.kind === 'deposit')
  $('feed-total').textContent = deposits.length ? `${plural(deposits.length, 'feed')}, ${usd(s.totalFed)} USDFC` : ''
  if (s.feed.length === 0) {
    $('feed-log').innerHTML = '<tr><td colspan="5" class="empty">No deposits recorded for this payer since the configured start block.</td></tr>'
    return
  }
  const rate = account.ratePerEpoch
  $('feed-log').innerHTML = s.feed.slice(0, 200).map((f) => {
    const when = `<td title="epoch ${f.epoch}">${ago(clock, f.epoch)}<br><span class="small muted">${fmtDate(clock, f.epoch)}</span></td>`
    const days = daysBought(f.amount, rate)
    const life = days == null ? '' : `${f.kind === 'withdrawal' ? '-' : '+'}${days.toFixed(1)} d`
    if (f.kind === 'withdrawal') {
      return `<tr>${when}<td>${addrLink(s.payer)} <span class="badge">owner withdrew</span></td><td class="num">-${usd(f.amount, 4)}</td><td class="num">${life}</td><td>${txLink(f.txHash)}</td></tr>`
    }
    const adopt = f.amount >= foldConfig.adoptionThreshold && f.from.toLowerCase() !== s.payer ? ` <span class="badge">adopted ${nameOf(f.from)}</span>` : ''
    const self = f.from.toLowerCase() === s.payer ? ' <span class="badge">endowment</span>' : ''
    return `<tr>${when}<td>${addrLink(f.from)} fed it${adopt}${self}</td><td class="num">${usd(f.amount, 4)}</td><td class="num">${life}</td><td>${txLink(f.txHash)}</td></tr>`
  }).join('')
}

function renderWall(s, clock) {
  if (s.generations.length === 0) {
    $('wall').innerHTML = '<p class="empty">No corgi has died yet. When one does, its final state is recorded here, folded from the same deposit log as everything else.</p>'
    return
  }
  const epitaph = (g) => (g.died.cause === 'withdrawn' ? 'Its owner took the food away.' : 'Nobody came in time.')
  const lived = (g) => fmtDays(g.died.epoch - g.born.epoch)
  $('wall').innerHTML = s.generations.map((g, i) => `<article>${corgiSvg(`${s.payer}${i}`, { life: 'dead', title: `generation ${i + 1}` })}<div><p><strong>Here lies generation ${i + 1}</strong> <span class="muted small">lived ${lived(g)}</span></p><p class="epitaph">${epitaph(g)}</p><p class="small muted">${fmtDate(clock, g.born.epoch)} to ${fmtDate(clock, g.died.epoch)}. Brought to life by ${addrLink(g.born.by)}.</p></div></article>`).join('')
}

function statusLine(s, clock) {
  if (s.life === 'dead') return `The FOC corgi (gen ${s.generation}) is dead. Its memorial disappears in ${fmtDays(s.memorial.endsInEpochs)}. Anyone can revive it: ${location.href}`
  const left = fmtDays(s.lifeEpochs)
  return `The FOC corgi is ${s.life} and ${s.mood}: ${left} of life left, ${plural(s.distinctFeeders, 'feeder')} this week, ${plural(s.park.length, 'corgi')} in the park. Feed it or adopt one: ${location.href} (rules v${RULES_VERSION})`
}

function render(v) {
  const { state: s, clock, account } = v
  document.title = `FOC Corgi: ${s.life === 'dead' ? 'in memoriam' : `${s.life}, ${s.mood}`}`
  document.body.classList.toggle('dead', s.life === 'dead')
  $('chain-badge').textContent = `${net.name.replace('Filecoin - ', '')} · epoch ${s.epoch}`
  $('gen-badge').textContent = `generation ${s.generation}`
  $('payer-link').textContent = short(s.payer)
  $('payer-link').href = `${explorer}/address/${s.payer}`
  $('headline').textContent = headlineFor(s, clock)
  $('lede').textContent = `${lifeCopy(s, clock)} ${moodCopy(s)}`
  const locked = account.funds - (account.unreserved > 0n ? account.unreserved : 0n)
  $('account-line').textContent = `Account: ${usd(account.funds, 4)} USDFC in Filecoin Pay, ${usd(locked, 4)} of it held as reserve and lockups, spending ${usd(account.ratePerEpoch * BigInt(EPOCHS_PER_DAY), 4)} USDFC a day.`
  $('adopt-threshold').textContent = usd(foldConfig.adoptionThreshold)
  $('feed-title').textContent = s.life === 'dead' ? `Feed it ${usd(s.memorial.reviveNeeds, 4)} USDFC or more to bring it back` : `Feed it ${usd(foldConfig.adoptionThreshold)} USDFC and adopt a corgi`
  $('contracts-line').textContent = `rules v${RULES_VERSION} · Filecoin Pay ${net.contracts.filecoinPay.address} · USDFC ${token} · payer ${s.payer}`
  renderLife(s, account); renderMood(s); renderPark(s); renderMemorial(s, clock); renderResidents(s, clock); renderFeedLog(s, clock, account); renderWall(s, clock)
  renderYours()
  renderAmountHint()
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
    const state = fold({ payer: read.payer, account: read.account, deposits: read.deposits, withdrawals: read.withdrawals }, foldConfig)
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

function renderYours() {
  const box = $('yours')
  if (!wallet || !view) { box.hidden = true; return }
  const t = traitsOf(wallet.address)
  const rarity = rarityOf(t)
  const owned = view.state.park.find((p) => p.owner.toLowerCase() === wallet.address.toLowerCase())
  const name = nameOf(wallet.address)
  const line = owned
    ? `<p><strong>${name} is in the park</strong> (adopted ${ago(view.clock, owned.epoch)}). Every feed still adds days of life.</p>`
    : `<p><strong>${name} is yours</strong> if you feed ${usd(foldConfig.adoptionThreshold)} USDFC or more. It is the see-through one in the park right now.</p>`
  box.innerHTML = `${corgiSvg(wallet.address, { life: 'fine', mood: 'happy', title: describe(t) })}<div>${line}<p class="muted small">${describe(t)}${rarity ? ` · ${rarity}` : ''}</p></div>`
  box.hidden = false
}

function renderAmountHint() {
  if (!view) return
  const rate = view.account.ratePerEpoch
  for (const b of document.querySelectorAll('#presets .preset')) {
    const d = daysBought(chain.parseUnits(b.dataset.amount, 18), rate)
    b.querySelector('.days').textContent = d == null ? '' : `+${d.toFixed(0)} days of life`
    b.setAttribute('aria-pressed', String(b.dataset.amount === $('amount').value.trim()))
  }
  let amount
  try { amount = chain.parseUnits($('amount').value.trim() || '0', 18) } catch { amount = 0n }
  const days = daysBought(amount, rate)
  const bits = []
  if (days != null && amount > 0n) bits.push(`adds ${days.toFixed(1)} days of life`)
  if (amount >= foldConfig.adoptionThreshold) bits.push('adopts a corgi')
  $('amount-hint').textContent = bits.join(', ')
}

function showOnboarding() {
  $('onboard').hidden = false
  $('onboard').innerHTML = `<strong>No wallet found.</strong> Feeding takes an Ethereum-style wallet on Filecoin ${net.name.replace('Filecoin - ', '')}. Three steps:
    <ol>
      <li><a href="${WALLET_URL}" target="_blank" rel="noopener">Install MetaMask</a> (or any EIP-1193 wallet) and reload. This page adds the network for you when you connect.</li>
      <li>Get a little tFIL for gas from the <a href="${FAUCET_FIL}" target="_blank" rel="noopener">calibration FIL faucet</a>.</li>
      <li>Get USDFC from the <a href="${FAUCET_USDFC}" target="_blank" rel="noopener">calibration USDFC faucet</a>. One claim is enough to feed and adopt.</li>
    </ol>`
}

async function connect() {
  const provider = window.ethereum
  if (!provider) { showOnboarding(); return }
  try {
    feedStatus('Waiting for the wallet to approve the connection and switch to the corgi\'s network.')
    wallet = await chain.connectWallet(provider, net)
    const { balance } = await chain.feederBalance(client, { address: wallet.address, token })
    $('wallet-line').textContent = `${short(wallet.address)} · ${usd(balance, 4)} USDFC`
    $('feed').disabled = false
    $('connect').textContent = 'Connected'
    feedStatus('')
    if (balance === 0n) {
      feedStatus(`This wallet holds no USDFC. Get some from the <a href="${FAUCET_USDFC}" target="_blank" rel="noopener">calibration USDFC faucet</a>, then feed.`)
    }
    if (view) { renderYours(); renderPark(view.state) }
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
    const adopted = amount >= foldConfig.adoptionThreshold && view && !view.state.park.some((p) => p.owner.toLowerCase() === wallet.address.toLowerCase())
    const days = daysBought(amount, view?.account.ratePerEpoch ?? 0n)
    const summary = `Fed ${usd(amount, 4)} USDFC in epoch ${result.epoch}${days ? `, adding ${days.toFixed(1)} days of life` : ''}${adopted ? `. ${nameOf(wallet.address)} is in the park` : ''}. ${txLink(result.hash)}`
    feedStatus(`${summary}. Waiting for the chain to index it, then refreshing the corgi.`, 'ok')
    park?.celebrate()
    $('stage').scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'center' })
    await chain.waitForEpoch(client, result.epoch)
    await load({ quiet: true })
    feedStatus(summary, 'ok')
  } catch (err) {
    feedStatus(`Feeding failed: ${err?.shortMessage ?? err?.message ?? err}`, 'error')
  } finally {
    feeding = false
    $('feed').disabled = false
  }
}

async function share() {
  if (!view) return
  const text = statusLine(view.state, view.clock)
  try {
    if (navigator.share) { await navigator.share({ text }); return }
    await navigator.clipboard.writeText(text)
    $('share').textContent = 'Copied'
    setTimeout(() => { $('share').textContent = 'Copy status to share' }, 2000)
  } catch {
    window.prompt('Copy this:', text)
  }
}

$('connect').addEventListener('click', connect)
$('feed-form').addEventListener('submit', submitFeed)
$('amount').addEventListener('input', renderAmountHint)
$('share').addEventListener('click', share)
$('fullscreen').addEventListener('click', async () => {
  const stage = $('stage')
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await stage.requestFullscreen()
  } catch (err) {
    $('stage-hint').textContent = `Fullscreen is not available here: ${err?.message ?? err}`
  }
})
document.addEventListener('fullscreenchange', () => {
  $('fullscreen').textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'
  park?.resize()
})
for (const b of document.querySelectorAll('button.preset')) b.addEventListener('click', () => { $('amount').value = b.dataset.amount; renderAmountHint() })

ensurePark()
await load()
setInterval(() => { if (!feeding) load({ quiet: true }) }, REFRESH_MS)
