/**
 * Jukebox page: insert a coin (a USDFC deposit into the jukebox's till,
 * its own account, straight from your wallet), pick a song (a piece your wallet
 * signs, written to the jukebox data set through the authorizer), and
 * every listener folds the same queue. There is no shared clock, so the
 * page plays the queue in order from the first track this browser has
 * not heard. No backend anywhere.
 */
import { bootByowPage } from '../lib/boot-byow.js'
import { coinClient, insertCoin, readCoins } from '../lib/coins.js'
import { tagsFor } from '../lib/discover.js'
import { pieceRef, signPiece, verifyAll } from '../lib/identity.js'
import { annotateWalletSigs, signWithWallet } from '../lib/wallet-sig.js'
import { APP, PRICE, foldJukebox, usableTrack } from './fold.js'

const PENDING_TIMEOUT_MS = 3 * 60000

function parseTrack(input) {
  const s = input.trim()
  const yt = s.match(/(?:youtu\.be\/|v=|\/shorts\/|\/embed\/)([A-Za-z0-9_-]{11})/) ?? s.match(/^([A-Za-z0-9_-]{11})$/)
  if (yt) return { kind: 'youtube', id: yt[1] }
  if (/^https:\/\//.test(s)) return { kind: 'url', url: s }
  return null
}

export async function mountJukebox() {
  const { $, labelEl, transport, identity, byow } = await bootByowPage({ storagePrefix: 'jukebox', spectatorNote: 'listening needs nothing' })
  $('wallet-row').hidden = true // coins come from the wallet directly; no session key, no data set
  const params = new URLSearchParams(location.search)
  const box = params.get('box') ?? 'main'
  if (!byow || transport.sponsored == null) {
    $('status').textContent = 'this build has no jukebox data set'
    return
  }
  const { ds } = transport.sponsored
  // The till is the jukebox's own account: coins go there and nowhere
  // else, so they never show up in another app's deposit log.
  const config = JSON.parse(document.getElementById('foc-config')?.textContent ?? '{}')
  const payer = config.till
  const fromBlock = Number(config.sponsored?.from ?? 0)
  if (payer == null) {
    $('status').textContent = 'this build has no jukebox till'
    return
  }
  const client = coinClient()
  const provider = globalThis.ethereum ?? null

  let address = localStorage.getItem('jukebox:wallet')
  let deposits = []
  let pieces = []
  let state = foldJukebox(box, ds, [], [])
  let pending = null
  let busy = null
  let busyStage = null
  let lastError = null
  let guest = null
  const HEARD_KEY = 'jukebox:heard'
  const heard = new Set(JSON.parse(localStorage.getItem(HEARD_KEY) ?? '[]'))
  let nowPlaying = null // queue entry

  const verdicts = new WeakMap()
  async function verified(raw) {
    const unseen = raw.filter((p) => p != null && typeof p === 'object' && !verdicts.has(p))
    const results = await verifyAll(unseen)
    const withWallet = await annotateWalletSigs(results)
    unseen.forEach((p, i) => verdicts.set(p, withWallet[i]))
    return raw.map((p) => (p != null && typeof p === 'object' ? verdicts.get(p) : null)).filter((p) => p != null && p.app === APP)
  }

  const short = (w) => `${w.slice(0, 6)}…${w.slice(-4)}`
  const myCredits = () => (address == null ? 0 : state.balances.get(address.toLowerCase()) ?? 0)

  // ---------------------------------------------------------------- player
  let yt = null
  let ytReady = false
  function loadYouTube() {
    if (document.getElementById('yt-api') != null) return
    const s = document.createElement('script')
    s.id = 'yt-api'
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
    globalThis.onYouTubeIframeAPIReady = () => {
      yt = new globalThis.YT.Player('yt', {
        height: '270', width: '480',
        playerVars: { autoplay: 1, playsinline: 1 },
        events: {
          onReady: () => { ytReady = true; play() },
          onStateChange: (e) => { if (e.data === globalThis.YT.PlayerState.ENDED) finished() },
        },
      })
    }
  }
  const audio = $('audio')
  audio.onended = () => finished()
  audio.onerror = () => finished()

  function finished() {
    if (nowPlaying != null) {
      heard.add(nowPlaying.pieceId)
      localStorage.setItem(HEARD_KEY, JSON.stringify([...heard].slice(-500)))
    }
    nowPlaying = null
    play()
  }

  function play() {
    const next = state.queue.find((q) => !heard.has(q.pieceId))
    if (next == null) { nowPlaying = null; render(); return }
    if (nowPlaying?.pieceId === next.pieceId) return
    nowPlaying = next
    if (next.track.kind === 'youtube') {
      audio.pause()
      $('audio').hidden = true
      $('yt-wrap').hidden = false
      if (!ytReady) { loadYouTube(); render(); return }
      yt.loadVideoById(next.track.id)
    } else {
      if (yt != null && ytReady) yt.stopVideo()
      $('yt-wrap').hidden = true
      $('audio').hidden = false
      audio.src = next.track.url
      audio.play().catch(() => { /* autoplay blocked until the listener clicks */ })
    }
    render()
  }
  $('skip').onclick = () => finished()

  // ---------------------------------------------------------------- state
  function statusLine() {
    if (busy != null && busyStage != null) return `${busy} — ${busyStage}`
    if (busy != null) return busy
    if (pending != null) {
      const eta = Math.max(0, 60 - Math.round((Date.now() - pending.sentAt) / 1000))
      return eta > 0 ? `pick sent — it joins the queue in ~${eta}s` : 'pick sent — finalizing on-chain'
    }
    if (lastError != null) return lastError
    if (provider == null) return 'no browser wallet found: you can listen, but a coin needs a wallet'
    if (address == null) return 'connect a wallet to insert a coin'
    if (myCredits() === 0) return `no credits: insert a coin (${Number(PRICE) / 1e18} USDFC) to pick a song`
    if (guest?.waitEpochs > 0) return `you have ${myCredits()} credit${myCredits() === 1 ? '' : 's'}; the box takes the next pick in ~${guest.waitEpochs * 30}s`
    return `you have ${myCredits()} credit${myCredits() === 1 ? '' : 's'}: pick a song`
  }

  function render() {
    $('coin-connect').hidden = provider == null || address != null
    $('coin').disabled = provider == null || address == null || busy != null
    $('wallet').textContent = address == null ? '' : `wallet ${short(address)}, ${myCredits()} credit${myCredits() === 1 ? '' : 's'}`
    const canPick = address != null && myCredits() > 0 && busy == null && pending == null && !(guest?.waitEpochs > 0) && !(guest?.budgetLeft === 0)
    $('pick').disabled = !canPick
    const statusEl = $('status')
    statusEl.textContent = statusLine()
    statusEl.classList.toggle('error', busy == null && lastError != null)
    statusEl.classList.toggle('busy', busy != null)
    $('now').textContent = nowPlaying == null
      ? (state.queue.length === 0 ? 'nothing in the queue yet' : 'you have heard everything in the queue')
      : `now playing: ${nowPlaying.title ?? nowPlaying.track.id ?? nowPlaying.track.url} (picked by ${short(nowPlaying.wallet)})`
    $('queue').replaceChildren(...state.queue.map((q, i) => {
      const li = document.createElement('li')
      const mine = address != null && q.wallet.toLowerCase() === address.toLowerCase()
      li.className = `${heard.has(q.pieceId) ? 'heard' : ''}${nowPlaying?.pieceId === q.pieceId ? ' playing' : ''}${mine ? ' mine' : ''}`
      li.textContent = `${i + 1}. ${q.title ?? (q.track.kind === 'youtube' ? `youtube ${q.track.id}` : q.track.url)} — ${mine ? 'you' : short(q.wallet)}`
      return li
    }))
    $('meta').textContent = `${state.queue.length} picks in the queue from ${state.coins} coin${state.coins === 1 ? '' : 's'}, ${state.ignored} ignored, ${state.unpaid} unpaid; folded from data set #${ds}`
      + (guest != null ? `; ${guest.budgetLeft} picks left in today's budget` : '')
  }

  async function refresh() {
    let scanError = null
    const [coins, raw] = await Promise.all([
      readCoins(client, { payer, fromBlock }).catch((err) => { console.error(err); scanError = err; return { deposits } }),
      transport.list(),
    ])
    deposits = coins.deposits
    if (scanError != null && lastError == null) lastError = `could not read the till (${scanError?.shortMessage ?? scanError?.message?.slice(0, 80) ?? scanError}); retrying`
    pieces = await verified(raw)
    state = foldJukebox(box, ds, deposits, pieces)
    if (pending != null) {
      if (state.queue.some((q) => q.ref === pending.ref)) pending = null
      else if (Date.now() - pending.sentAt > PENDING_TIMEOUT_MS) {
        pending = null
        lastError = 'your pick has not appeared in the queue yet; it may still settle'
      }
    }
    if (address != null) guest = await transport.guestStatus().catch(() => null)
    play()
    render()
  }

  // ---------------------------------------------------------------- wallet
  $('coin-connect').onclick = async () => {
    try {
      const accounts = await provider.request({ method: 'eth_requestAccounts' })
      address = accounts?.[0] ?? null
      if (address != null) localStorage.setItem('jukebox:wallet', address)
      render()
    } catch (err) {
      lastError = `wallet: ${err?.message ?? err}`
      render()
    }
  }

  $('coin').onclick = async () => {
    if (busy != null || address == null) return
    busy = 'inserting a coin'
    lastError = null
    render()
    try {
      await insertCoin({
        provider, address, payer, amount: PRICE,
        onStage: (stage) => {
          busyStage = { 'approve:sign': 'approve USDFC in your wallet', 'approve:pending': 'approval on its way', 'deposit:sign': 'confirm the deposit in your wallet', 'deposit:pending': 'coin on its way', done: 'coin landed' }[stage] ?? stage
          render()
        },
      })
      busy = null
      busyStage = null
      await refresh()
    } catch (err) {
      console.error(err)
      busy = null
      busyStage = null
      lastError = `coin failed (${err?.shortMessage ?? err?.message?.slice(0, 120) ?? err})`
      render()
    }
  }

  $('pick').onclick = async () => {
    const track = parseTrack($('track').value)
    const title = $('title').value.trim().slice(0, 80)
    if (!usableTrack(track)) { lastError = 'paste a YouTube link (or 11-character id) or an https audio URL'; render(); return }
    if (busy != null || address == null) return
    busy = 'picking'
    busyStage = 'sign the pick in your wallet'
    lastError = null
    render()
    try {
      const body = { v: 2, app: APP, log: transport.sponsored.log, type: 'pick', box, track, ...(title ? { title } : {}) }
      const withWallet = await signWithWallet(provider, address, body)
      const signed = await signPiece(withWallet, identity)
      await transport.appendSponsored(signed, (stage) => { busyStage = stage; render() }, tagsFor(APP, box, 'pick'))
      pending = { ref: await pieceRef(signed), sentAt: Date.now() }
      $('track').value = ''
      $('title').value = ''
      busy = null
      busyStage = null
      await refresh()
    } catch (err) {
      console.error(err)
      busy = null
      busyStage = null
      lastError = `pick failed (${err?.message?.slice(0, 120) ?? err})`
      render()
    }
  }

  labelEl.textContent = `${transport.label} — loading the queue…`
  await refresh()
  labelEl.textContent = `${transport.label}: jukebox data set #${ds}, till ${short(payer)}`
  setInterval(() => { if (busy == null) refresh().catch(console.error) }, 10000)
  setInterval(() => { if (pending != null && busy == null) render() }, 1000)
}
