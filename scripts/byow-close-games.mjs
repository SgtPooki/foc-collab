#!/usr/bin/env node
/**
 * Close leftover games: append a `resign` piece for every unfinished
 * game a descriptor's data set created (or is seated in) whose name
 * matches a pattern. The log keeps everything; the fold marks the games
 * closed or resigned and lobbies drop them.
 *
 *   node scripts/byow-close-games.mjs <descriptor.json> <name-regex> [--dry]
 *   node scripts/byow-close-games.mjs .byow/player-a.json '^byow' --dry
 *
 * Needs `set -a; . ./config.env; . ./.env; set +a` for the RPC config.
 */
import fs from 'node:fs'
import { tagsFor } from '../games/lib/discover.js'
import { generateIdentity, signPiece, verifyAll } from '../games/lib/identity.js'
import { createByowTransport } from '../games/lib/transport-byow.js'
import { homeLog, lobbyByow, seatOfHome } from '../games/tic-tac-toe/fold-byow.js'
import { lobbyByow as lobbyC4 } from '../games/connect-four/fold-byow.js'

const [descriptorPath, pattern, flag] = process.argv.slice(2)
if (!descriptorPath || !pattern) {
  console.error('usage: node scripts/byow-close-games.mjs <descriptor.json> <name-regex> [--dry]')
  process.exit(2)
}
const dry = flag === '--dry'
const me = JSON.parse(fs.readFileSync(descriptorPath, 'utf8'))
const re = new RegExp(pattern)
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a)

const transport = await createByowTransport({ me, peers: [] })
// Find every game this data set is in, across both games.
for (const app of ['foc-ttt', 'foc-connect-four']) {
  const d = await transport.discover({ app })
  for (const h of d.hints) transport.addDataSet(h.ds)
}
const raw = (await transport.list()).filter((p) => p != null)
const verified = (await verifyAll(raw)).filter((p) => p != null && p.v === 2)
// A resign piece is signed by a fresh identity: seats belong to the data
// set, so any token writing from this home may resign for it.
const identity = await generateIdentity()

const apps = [['foc-ttt', lobbyByow], ['foc-connect-four', lobbyC4]]
let closed = 0
for (const [app, lobby] of apps) {
  for (const g of lobby(verified.filter((p) => p.app === app))) {
    if (g.closed || g.winner != null) continue
    if (seatOfHome(g, me.ds) == null) continue
    if (!re.test(g.name ?? g.game)) continue
    const what = g.seats.O == null ? 'close' : 'resign'
    log(`${dry ? 'would ' : ''}${what}: ${app} "${g.name ?? g.game}" (${g.game.slice(0, 18)}, root #${g.root})`)
    if (dry) continue
    const signed = await signPiece({ v: 2, type: 'resign', game: g.game, app, log: homeLog(me.ds) }, identity)
    await transport.append(signed, (stage) => log(`  ${stage}`), tagsFor(app, g.game, 'resign'))
    closed++
  }
}
log(`${dry ? 'dry run, ' : ''}${closed} resign piece(s) appended from data set #${me.ds}`)
