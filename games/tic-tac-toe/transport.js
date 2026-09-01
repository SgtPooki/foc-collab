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

export async function createTransport() {
  const config = pageConfig()
  if (config == null) return localTransport()
  const { createFocTransport } = await import('./transport-foc.js')
  return createFocTransport(config)
}
