/**
 * A transport appends pieces to one shared log and lists the whole log in
 * a stable total order. The fold does the rest; transports never
 * interpret pieces.
 *
 * Interface:
 *   label: string                 — shown in the UI
 *   append(piece, onProgress?): Promise<void>
 *                                 — persist one piece; onProgress receives
 *                                   short stage strings for the UI
 *   list(): Promise<piece[]>      — all pieces, stable order
 *   onChange?(cb): void           — push notification (optional)
 *   pollMs?: number               — poll interval when no push (optional)
 *
 * Which backend runs is decided by the page itself: a published page
 * carries an embedded config block naming its shared data set, so it uses
 * shared storage on Filecoin Onchain Cloud; without one (local dev) the
 * log lives in this browser and syncs tab-to-tab.
 *
 *   <script type="application/json" id="foc-config">
 *     { "dataset": 123, "wallet": "0x…", "sessionKey": "0x…"? }
 *   </script>
 *
 * The publish flow injects that block; sessionKey is optional and only
 * ever a short-lived key from a throwaway wallet (see docs/FEASIBILITY.md
 * on blast radius). Without it, players paste their own key once
 * (prompted, kept in localStorage).
 */

/** Same-browser demo transport: one localStorage log + BroadcastChannel push. */
function localTransport() {
  const KEY = 'ttt:log'
  const channel = new BroadcastChannel('ttt-pieces')
  return {
    label: 'local (two tabs, same browser)',
    logId: 'local', // stamped into signed pieces for domain separation
    perTab: true, // player tokens per tab, so one browser can hold both seats
    async append(piece) {
      const log = JSON.parse(localStorage.getItem(KEY) ?? '[]')
      log.push(piece)
      localStorage.setItem(KEY, JSON.stringify(log))
      channel.postMessage(null)
    },
    async list() {
      return JSON.parse(localStorage.getItem(KEY) ?? '[]')
    },
    onChange(cb) {
      channel.onmessage = () => cb()
    },
  }
}

export function pageConfig() {
  const el = document.getElementById('foc-config')
  if (el == null) return null
  try {
    return JSON.parse(el.textContent)
  } catch {
    return null
  }
}

/**
 * BYOW: the page config carries only public settings ({ mode: 'byow',
 * lobbyBlocks?, logRpcs? }); no key of anyone's. Each player's own descriptor
 * ({ ds, wallet, sessionKey } from scripts/byow-setup-player.mjs) is pasted
 * once and kept in localStorage, never in a URL or in the page. Without a
 * descriptor the page is a read-only spectator.
 */
const ME_KEY = 'ttt:byow:me'

export function loadMyDescriptor() {
  try {
    const me = JSON.parse(localStorage.getItem(ME_KEY) ?? 'null')
    if (me?.ds && me?.wallet && me?.sessionKey) return me
  } catch { /* fall through to prompt */ }
  return null
}

export function promptMyDescriptor() {
  const raw = prompt('Paste your player descriptor JSON ({ ds, wallet, sessionKey }; stays in this browser). Cancel to spectate:')
  if (!raw) return null
  const me = JSON.parse(raw)
  if (!me?.ds || !me?.wallet || !me?.sessionKey) throw new Error('descriptor needs ds, wallet, sessionKey')
  localStorage.setItem(ME_KEY, JSON.stringify(me))
  return me
}

export async function createTransport() {
  const config = pageConfig()
  const params = new URLSearchParams(location.search)
  if (config?.mode === 'byow' || params.get('transport') === 'byow') {
    const { createByowTransport } = await import('./transport-byow.js')
    const me = loadMyDescriptor() ?? promptMyDescriptor()
    const peers = ['x', 'o'].map((k) => params.get(k)).filter((v) => v != null && v !== '')
    return createByowTransport({ me, peers, lobbyBlocks: config?.lobbyBlocks, logRpcs: config?.logRpcs })
  }
  if (config == null) return localTransport()
  const { createFocTransport } = await import('./transport-foc.js')
  return createFocTransport(config)
}
