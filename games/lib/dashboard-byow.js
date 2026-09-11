/**
 * The site's front door as a BYOW page: one wallet connection for every
 * app on the site (the descriptor and identity live in this origin's
 * IndexedDB, so every sub-page sees the same player), and a dashboard of
 * the player's games across apps with the ones waiting on them first.
 * This is the "several slow games at once" view: a minute per move stops
 * mattering when the front page always has something to do.
 *
 * Markup ids used, on top of boot-byow.js's: dash, dash-status, waiting,
 * yours, open.
 *
 * apps: [{ name, app, href, lobby(pieces), seatOf(state, ds), status(state), seatNames }]
 *   href is the app's directory relative to the landing page, e.g. './tic-tac-toe/'
 */
import { bootByowPage } from './boot-byow.js'
import { verifyAll } from './identity.js'

export async function mountDashboard({ apps }) {
  const { $, labelEl, transport, byow } = await bootByowPage({ storagePrefix: 'home', spectatorNote: 'you can still watch, and chat as a guest' })
  if (!byow) return
  $('dash').hidden = false
  const me = transport.me?.ds ?? null

  const verdicts = new WeakMap()
  async function verified(raw) {
    const unseen = raw.filter((p) => p != null && typeof p === 'object' && !verdicts.has(p))
    const results = await verifyAll(unseen)
    unseen.forEach((p, i) => verdicts.set(p, results[i]))
    return raw.map((p) => (p != null && typeof p === 'object' ? verdicts.get(p) : null)).filter((p) => p != null && p.v === 2)
  }

  const hints = new Map() // `${app}:${root}` -> create block, for invite links
  async function discoverAll() {
    for (const a of apps) {
      try {
        const d = await transport.discover({ app: a.app })
        for (const h of d.hints) {
          if (h.tags.type === 'create') hints.set(`${a.app}:${h.ds}`, h.block)
          transport.addDataSet(h.ds)
        }
      } catch (err) {
        console.error(err)
      }
    }
  }

  const href = (a, g) => {
    const from = hints.get(`${a.app}:${g.root}`)
    return `${a.href}?game=${encodeURIComponent(g.game)}&x=${encodeURIComponent(g.root)}${from == null ? '' : `&from=${from}`}`
  }

  function row(a, g, seat) {
    const li = document.createElement('li')
    const link = document.createElement('a')
    link.href = href(a, g)
    link.textContent = g.name ?? g.game
    const meta = document.createElement('span')
    meta.className = 'meta'
    const line = String(a.status(g)).replace(/\bX\b/g, a.seatNames.X).replace(/\bO\b/g, a.seatNames.O)
    meta.textContent = ` — ${a.name}: ${line}${seat != null ? `, you are ${a.seatNames[seat]}` : ''}`
    li.append(link, meta)
    return li
  }

  async function refresh() {
    await discoverAll()
    const pieces = await verified(await transport.list())
    const waiting = []
    const yours = []
    const open = []
    for (const a of apps) {
      const games = a.lobby(pieces.filter((p) => p.app === a.app))
      for (const g of games) {
        const seat = a.seatOf(g, me)
        const joined = seat != null || (me != null && (g.joins ?? []).some((j) => j.ds === me))
        if (joined && seat != null && seat === g.next && g.winner == null && g.seats.O != null) waiting.push(row(a, g, seat))
        else if (joined) yours.push(row(a, g, seat))
        else if (g.seats.O == null && g.seats.X != null && !g.solo) open.push(row(a, g, null))
      }
    }
    $('waiting').replaceChildren(...waiting)
    $('yours').replaceChildren(...yours)
    $('open').replaceChildren(...open.slice(0, 10))
    document.title = waiting.length > 0 ? `● ${waiting.length} waiting on you — foc-collab` : 'foc-collab games'
    const who = me != null ? `you are data set #${me}` : 'no wallet connected: you can watch any game and chat as a guest'
    const counts = `${waiting.length} waiting on you, ${yours.length} other game${yours.length === 1 ? '' : 's'} of yours, ${open.length} open to join`
    $('dash-status').textContent = `${who}. ${counts}.`
  }

  labelEl.textContent = `${transport.label} — loading your games…`
  await refresh()
  labelEl.textContent = transport.label
  setInterval(() => refresh().catch(console.error), 20000)
}
