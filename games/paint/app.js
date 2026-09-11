/**
 * Paint war page: a 64x64 canvas everyone paints through the arcade's
 * paint data set. No discovery (one data set holds the whole board), no
 * wallet needed (every painter is a guest key through the authorizer),
 * the contract's cooldown and budget shown as the clock.
 */
import { bootByowPage } from '../lib/boot-byow.js'
import { tagsFor } from '../lib/discover.js'
import { pieceRef, signPiece, verifyAll } from '../lib/identity.js'
import { APP, PALETTE, SIZE, foldBoard } from './fold.js'

const PENDING_TIMEOUT_MS = 3 * 60000
const SCALE = 8

export async function mountPaint() {
  const { $, labelEl, transport, identity, byow } = await bootByowPage({ storagePrefix: 'paint', spectatorNote: 'painting needs no wallet' })
  $('wallet-row').hidden = true // painting never needs the wallet; keep the front door quiet
  const params = new URLSearchParams(location.search)
  const board = params.get('board') ?? 'main'
  if (!byow || transport.sponsored == null) {
    $('status').textContent = 'this build has no paint data set; nothing to paint on'
    return
  }
  const ds = transport.sponsored.ds

  const canvas = $('board')
  canvas.width = SIZE * SCALE
  canvas.height = SIZE * SCALE
  const ctx = canvas.getContext('2d')
  let color = Number(localStorage.getItem('paint:color') ?? 5)
  let pieces = []
  let state = foldBoard(board, ds, [])
  let pending = null // { x, y, c, ref, sentAt }
  let busy = null
  let busyStage = null
  let lastError = null
  let guest = null

  const verdicts = new WeakMap()
  async function verified(raw) {
    const unseen = raw.filter((p) => p != null && typeof p === 'object' && !verdicts.has(p))
    const results = await verifyAll(unseen)
    unseen.forEach((p, i) => verdicts.set(p, results[i]))
    return raw.map((p) => (p != null && typeof p === 'object' ? verdicts.get(p) : null)).filter((p) => p != null && p.app === APP)
  }

  function paletteUI() {
    $('palette').replaceChildren(...PALETTE.map((hex, i) => {
      const b = document.createElement('button')
      b.className = `swatch${i === color ? ' on' : ''}`
      b.style.background = hex
      b.title = `colour ${i}`
      b.onclick = () => { color = i; localStorage.setItem('paint:color', String(i)); paletteUI() }
      return b
    }))
  }

  function draw() {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const c = state.cells[y * SIZE + x]
        ctx.fillStyle = c == null ? '#f4f4f4' : PALETTE[c]
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE)
      }
    }
    if (pending != null) {
      ctx.fillStyle = PALETTE[pending.c]
      ctx.globalAlpha = 0.55
      ctx.fillRect(pending.x * SCALE, pending.y * SCALE, SCALE, SCALE)
      ctx.globalAlpha = 1
      ctx.strokeStyle = '#000'
      ctx.strokeRect(pending.x * SCALE + 0.5, pending.y * SCALE + 0.5, SCALE - 1, SCALE - 1)
    }
    for (const d of state.disputes) {
      ctx.strokeStyle = '#e5534b'
      ctx.strokeRect(d.x * SCALE + 0.5, d.y * SCALE + 0.5, SCALE - 1, SCALE - 1)
    }
  }

  function statusLine() {
    if (busy != null && busyStage != null) return `${busy} — ${busyStage}`
    if (busy != null) return busy
    if (pending != null) {
      const eta = Math.max(0, 60 - Math.round((Date.now() - pending.sentAt) / 1000))
      return eta > 0 ? `pixel sent — it settles in ~${eta}s` : 'pixel sent — finalizing on-chain'
    }
    if (lastError != null) return lastError
    if (guest?.waitEpochs > 0) return `cooldown: you can paint again in ~${guest.waitEpochs * 30}s`
    if (guest?.budgetLeft === 0) return 'the board\'s budget for today is used up; it refills tomorrow'
    return `click a cell to paint it (${guest?.budgetLeft ?? '?'} pixels left in today's budget for everyone)`
  }

  function render() {
    draw()
    const statusEl = $('status')
    statusEl.textContent = statusLine()
    statusEl.classList.toggle('error', busy == null && lastError != null)
    statusEl.classList.toggle('busy', busy != null)
    $('meta').textContent = `${state.painted} pixels painted, ${state.ignored} ignored, folded from data set #${ds}`
      + (state.disputes.length > 0 ? `. DISPUTED: ${state.disputes.length} pixel(s) were removed after this browser saw them (outlined in red)` : '')
    $('leaders').replaceChildren(...state.leaders.slice(0, 10).map(({ token, count }) => {
      const li = document.createElement('li')
      li.textContent = `${token === identity.token ? 'you' : `guest ${token.slice(0, 6)}`}: ${count} standing`
      return li
    }))
  }

  async function refresh() {
    pieces = await verified(await transport.list())
    state = foldBoard(board, ds, pieces)
    if (pending != null) {
      const o = state.owner[pending.y * SIZE + pending.x]
      if (o != null && o.token === identity.token && state.cells[pending.y * SIZE + pending.x] === pending.c) pending = null
      else if (Date.now() - pending.sentAt > PENDING_TIMEOUT_MS) {
        pending = null
        lastError = 'your pixel has not appeared yet; it may still settle, and you can paint again'
      }
    }
    guest = await transport.guestStatus().catch(() => null)
    render()
  }

  async function paint(x, y) {
    if (busy != null || pending != null) return
    if (guest != null && (guest.waitEpochs > 0 || guest.budgetLeft === 0)) return
    busy = 'painting'
    busyStage = null
    lastError = null
    render()
    try {
      const body = { v: 2, app: APP, log: transport.sponsored.log, type: 'pixel', board, x, y, c: color }
      const signed = await signPiece(body, identity)
      await transport.appendSponsored(signed, (stage) => { busyStage = stage; render() }, tagsFor(APP, board, 'pixel'))
      pending = { x, y, c: color, ref: await pieceRef(signed), sentAt: Date.now() }
      busy = null
      busyStage = null
      await refresh()
    } catch (err) {
      console.error(err)
      busy = null
      busyStage = null
      lastError = `could not paint (${err?.message?.slice(0, 120) ?? err}) — try again`
      render()
    }
  }

  canvas.onclick = (e) => {
    const r = canvas.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE)
    const y = Math.floor(((e.clientY - r.top) / r.height) * SIZE)
    if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) paint(x, y)
  }
  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect()
    const x = Math.floor(((e.clientX - r.left) / r.width) * SIZE)
    const y = Math.floor(((e.clientY - r.top) / r.height) * SIZE)
    const o = state.owner[y * SIZE + x]
    canvas.title = o == null ? `${x},${y}: unpainted` : `${x},${y}: ${o.token === identity.token ? 'you' : `guest ${o.token.slice(0, 6)}`} (piece ${o.pieceId})`
  }

  paletteUI()
  labelEl.textContent = `${transport.label} — loading the board…`
  await refresh()
  labelEl.textContent = `${transport.label}: painting into the arcade's data set #${ds} as a guest`
  setInterval(() => { if (busy == null) refresh().catch(console.error) }, 8000)
  setInterval(() => { if (pending != null && busy == null) render() }, 1000)
}
