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
 * lobbyBlocks?, logRpcs?, sponsored?: { ds, payer } }); no key of anyone's.
 * `sponsored` names a data set the arcade pays for, with an authorizer
 * attached, that any visitor may append to as a guest. Each player's own
 * descriptor ({ ds, wallet, sessionKey }) is made in the page by
 * wallet-byow.js from their connected wallet and kept in IndexedDB.
 * Without one the page is a read-only spectator that offers "connect
 * wallet". (A descriptor in localStorage under ttt:byow:me is honored
 * too: that is what the scripted proofs seed.)
 */
export async function loadMyDescriptor() {
  const { loadDescriptor } = await import('./wallet-byow.js')
  const saved = await loadDescriptor().catch(() => null)
  if (saved != null) return saved
  try {
    const me = JSON.parse(localStorage.getItem('ttt:byow:me') ?? 'null')
    if (me?.ds && me?.wallet && me?.sessionKey) return me
  } catch { /* nothing seeded */ }
  return null
}

export async function createTransport() {
  const config = pageConfig()
  const params = new URLSearchParams(location.search)
  if (config?.mode === 'byow' || params.get('transport') === 'byow') {
    const { createByowTransport } = await import('./transport-byow.js')
    const me = await loadMyDescriptor()
    const peers = ['x', 'o'].map((k) => params.get(k)).filter((v) => v != null && v !== '')
    return createByowTransport({ me, peers, lobbyBlocks: config?.lobbyBlocks, logRpcs: config?.logRpcs, sponsored: config?.sponsored })
  }
  if (config == null) return localTransport()
  const { createFocTransport } = await import('./transport-foc.js')
  return createFocTransport(config)
}
