/**
 * A transport stores move pieces for a game and returns them in a stable
 * total order. The fold does the rest; transports never interpret moves.
 *
 * Interface:
 *   label: string                       — shown in the UI
 *   append(game, move): Promise<void>   — persist one move piece
 *   list(game): Promise<move[]>         — all pieces, stable order
 *   onChange?(cb): void                 — push notification (optional)
 *   pollMs?: number                     — poll interval when no push (optional)
 */

/** Same-browser demo transport: localStorage log + BroadcastChannel push. */
function localTransport() {
  const key = (game) => `ttt:${game}`
  const channel = new BroadcastChannel('ttt-moves')
  return {
    label: 'local (two tabs, same browser)',
    async append(game, move) {
      const log = JSON.parse(localStorage.getItem(key(game)) ?? '[]')
      log.push(move)
      localStorage.setItem(key(game), JSON.stringify(log))
      channel.postMessage(game)
    },
    async list(game) {
      return JSON.parse(localStorage.getItem(key(game)) ?? '[]')
    },
    onChange(cb) {
      channel.onmessage = () => cb()
    },
  }
}

/**
 * Shared-storage transport: each move is one piece added to a data set on
 * Filecoin Onchain Cloud with a session key; list() enumerates the data
 * set's pieces in piece-id order (the chain is the ordering authority).
 * Wired up by the FOC spike — see docs/FEASIBILITY.md.
 */
async function focTransport(params) {
  const { createFocTransport } = await import('./transport-foc.js')
  return createFocTransport(params)
}

export async function createTransport(params) {
  return params.get('transport') === 'foc' ? focTransport(params) : localTransport()
}
