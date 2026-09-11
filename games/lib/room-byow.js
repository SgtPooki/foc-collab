/**
 * The page shell for a many-writer room (chat, and later a canvas or a
 * queue): boot, discovery of every data set that posted to the room,
 * verification, fold, and posting either from the player's own data set
 * or, for a visitor with no wallet, into the arcade's sponsored data set
 * through its authorizer. The room's fold and renderer come from `spec`.
 *
 * Markup ids used, on top of boot-byow.js's: room-title, messages,
 * compose, text, name, send, status, meta, rooms.
 *
 * spec:
 *   app          domain-separation tag, e.g. 'foc-chat'
 *   storagePrefix sessionStorage prefix
 *   intro        the BYOW intro paragraph (ignored on the local demo)
 *   fold(room, pieces)             the room's pure fold
 *   order(messages, blockOf)       display order across authors (hint-driven)
 *   rooms(pieces)                  every room seen, for the room list
 *   compose(state, text, name)     the piece body for a new post (without v/app/log/token)
 *   render(ctx)                    DOM nodes for the message list; ctx = { state, ordered, mine }
 */
import { bootByowPage } from './boot-byow.js'
import { tagsFor } from './discover.js'
import { pieceRef, signPiece, verifyAll } from './identity.js'

const PENDING_TIMEOUT_MS = 3 * 60000

export async function mountRoom(spec) {
  const { $, labelEl, transport, identity, byow } = await bootByowPage({ storagePrefix: spec.storagePrefix, spectatorNote: 'you can still read, and post as a guest' })
  const params = new URLSearchParams(location.search)
  const room = params.get('room') ?? 'lobby'
  const fromBlock = params.get('from')
  if (byow && $('intro') != null) $('intro').textContent = spec.intro
  $('room-title').textContent = room === 'lobby' ? 'lobby' : `room ${room}`

  // Who writes where. A wallet player posts to their own data set; anyone
  // else posts to the sponsored data set as a guest, if the page has one.
  const canPostAsPlayer = byow && transport.me != null && !(transport.writeExpiry && transport.writeExpiry < Date.now())
  const canPostAsGuest = byow && transport.sponsored != null
  const canPost = !byow || canPostAsPlayer || canPostAsGuest
  const myLog = canPostAsPlayer || !byow ? transport.logId : transport.sponsored?.log
  const mySrc = canPostAsPlayer ? transport.me.ds : transport.sponsored?.ds
  const mine = (m) => m.src === mySrc && m.token === identity.token

  let pieces = []
  let discovery = { hints: [], failed: [] }
  const blocks = new Map() // `${ds}:${pieceId}` -> block, from PieceAdded hints
  const blockOf = (src, pieceId) => blocks.get(`${src}:${pieceId}`)
  let busy = null
  let busyStage = null
  let pending = null // { ref, sentAt } until the post shows up in the fold
  let lastError = null
  let guest = null // last guestStatus()

  const NAME_KEY = `${spec.storagePrefix}:name`
  $('name').value = localStorage.getItem(NAME_KEY) ?? ''

  const verdicts = new WeakMap()
  async function verifiedPieces(raw) {
    const unseen = raw.filter((p) => p != null && typeof p === 'object' && !verdicts.has(p))
    const results = await verifyAll(unseen)
    unseen.forEach((p, i) => verdicts.set(p, results[i]))
    return raw.map((p) => {
      if (p == null || typeof p !== 'object') return null
      const ok = verdicts.get(p)
      if (ok == null || ok.app !== spec.app) return null
      if (!byow) return ok.log === transport.logId ? ok : null
      return ok.v === 2 ? ok : null
    })
  }

  async function discoverAuthors() {
    if (!byow) return
    try {
      discovery = await transport.discover({ app: spec.app, game: room, from: fromBlock })
      for (const h of discovery.hints) {
        blocks.set(`${h.ds}:${h.pieceId}`, Number(h.block))
        transport.addDataSet(h.ds)
      }
    } catch (err) {
      console.error(err)
      discovery = { hints: discovery.hints, failed: [{ error: err?.message?.slice(0, 80) ?? String(err) }] }
    }
  }

  async function refresh() {
    await discoverAuthors()
    pieces = await verifiedPieces(await transport.list())
    if (pending != null) {
      const state = spec.fold(room, pieces)
      if (state.messages.some((m) => m.ref === pending.ref)) pending = null
      else if (Date.now() - pending.sentAt > PENDING_TIMEOUT_MS) {
        pending = null
        lastError = 'your post has not appeared yet — it may still settle; you can post again'
      }
    }
    if (canPostAsGuest && !canPostAsPlayer) guest = await transport.guestStatus().catch(() => null)
    render()
  }

  function statusLine() {
    if (busy != null && busyStage != null) return `${busy} — ${busyStage}`
    if (busy != null) return busy
    if (pending != null) {
      const eta = Math.max(0, 60 - Math.round((Date.now() - pending.sentAt) / 1000))
      return eta > 0 ? `posted — others see it in ~${eta}s` : 'posted — finalizing on-chain'
    }
    if (lastError != null) return lastError
    if (!canPost) return 'read-only: connect a wallet to post'
    if (canPostAsPlayer) return `posting from your data set #${transport.me.ds}`
    if (guest != null && guest.waitEpochs > 0) return `guest cooldown: you can post again in ~${guest.waitEpochs * 30}s`
    if (guest != null && guest.budgetLeft === 0) return 'the arcade\'s guest budget for today is used up; connect a wallet to post from your own data set'
    return `posting as a guest into the arcade's data set #${transport.sponsored.ds} (${guest?.budgetLeft ?? '?'} guest posts left today)`
  }

  function render() {
    const state = spec.fold(room, pieces)
    const ordered = spec.order(state.messages, blockOf)
    $('messages').replaceChildren(...spec.render({ state, ordered, mine }))
    const canSend = canPost && busy == null && pending == null && !(guest != null && (guest.waitEpochs > 0 || guest.budgetLeft === 0))
    $('send').disabled = !canSend
    $('text').disabled = !canPost || busy != null
    const statusEl = $('status')
    statusEl.textContent = statusLine()
    statusEl.classList.toggle('error', busy == null && lastError != null)
    statusEl.classList.toggle('busy', busy != null)
    const lines = [`${state.applied} posts from ${state.authors} author${state.authors === 1 ? '' : 's'}, ${state.ignored} ignored`]
    if (byow) {
      lines.push(`folded from data set${transport.dataSets().length === 1 ? '' : 's'} ${transport.dataSets().map((d) => `#${d}`).join(', ')}`)
      if (discovery.failed.length > 0) lines.push(`chain scan skipped ${discovery.failed.length} block range(s) (${discovery.failed[0].error})`)
      const problems = transport.problems()
      if (problems.length > 0) lines.push(`cannot read ${problems.map((p) => `#${p.ds} (${p.error})`).join('; ')}`)
    }
    $('meta').textContent = lines.join('. ')
    const list = spec.rooms(pieces)
    $('rooms').replaceChildren(...list.map(({ room: r, posts }) => {
      const a = document.createElement('a')
      a.href = r === 'lobby' ? '?' : `?room=${encodeURIComponent(r)}`
      a.textContent = `${r} (${posts})`
      if (r === room) a.classList.add('current')
      return a
    }))
  }

  async function send() {
    const text = $('text').value.trim()
    const name = $('name').value.trim().slice(0, 24)
    if (text === '' || busy != null) return
    localStorage.setItem(NAME_KEY, name)
    busy = 'posting'
    busyStage = null
    lastError = null
    render()
    try {
      const body = { ...spec.compose(spec.fold(room, pieces), text, name || undefined), v: byow ? 2 : 1, app: spec.app, log: myLog }
      const signed = await signPiece(body, identity)
      const tags = byow ? tagsFor(spec.app, room, 'post') : undefined
      const onStage = (stage) => { busyStage = stage; render() }
      if (canPostAsPlayer || !byow) await transport.append(signed, onStage, tags)
      else await transport.appendSponsored(signed, onStage, tags)
      pending = { ref: await pieceRef(signed), sentAt: Date.now() }
      $('text').value = ''
      busy = null
      busyStage = null
      await refresh()
    } catch (err) {
      console.error(err)
      busy = null
      busyStage = null
      lastError = `could not post (${err?.message?.slice(0, 120) ?? err}) — try again`
      render()
    }
  }
  $('send').onclick = send
  $('text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } })

  async function pollLoop() {
    if (busy == null) await refresh().catch(console.error)
    setTimeout(pollLoop, transport.pollMs != null ? 8000 : 60000)
  }
  transport.onChange?.(() => { if (busy == null) refresh() })
  labelEl.textContent = `${transport.label} — loading…`
  await refresh()
  labelEl.textContent = transport.label
  if (transport.pollMs != null) setTimeout(pollLoop, 8000)
  setInterval(() => { if (pending != null && busy == null) render() }, 1000)
}
