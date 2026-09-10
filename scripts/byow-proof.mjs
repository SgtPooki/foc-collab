#!/usr/bin/env node
/**
 * Settlement proof for BYOW multiplayer on Filecoin Onchain Cloud.
 *
 * Two independent clients, two wallets, two data sets, no gossip, no shared
 * log. Each client signs with its own P-256 game identity and writes only
 * to its own data set through its own AddPieces session key. Each client
 * lists both data sets keylessly and folds with the v2 rules. The script
 * plays a full game to a win, waiting for every piece to settle on-chain
 * before the other side acts, then a third read-only client that knows
 * only the invite (game id + root data set) reconstructs the game from FOC
 * alone and must agree with both players.
 *
 * Usage:
 *   set -a; . ./config.env; . ./.env; set +a
 *   node scripts/byow-proof.mjs .byow/player-a.json .byow/player-b.json [.byow/lobby.json]
 *
 * Descriptor files come from scripts/byow-setup-player.mjs. With a lobby
 * descriptor (scripts/setup-game-log.mjs output) O's data set is found by
 * X through a rendezvous announce; without it the script hands X the id
 * directly, standing in for the invite link O would send back.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { generateIdentity, signPiece, verifyAll } from '../games/tic-tac-toe/identity.js'
import { dataSetsOf, foldByow, homeLog } from '../games/tic-tac-toe/fold-byow.js'
import { createByowTransport } from '../games/tic-tac-toe/transport-byow.js'

const APP = 'foc-ttt'
const [aPath, bPath, lobbyPath] = process.argv.slice(2)
if (!aPath || !bPath) {
  console.error('usage: node scripts/byow-proof.mjs <player-a.json> <player-b.json> [lobby.json]')
  process.exit(1)
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'))
const A = readJson(aPath)
const B = readJson(bPath)
const lobby = lobbyPath ? readJson(lobbyPath) : null
const rendezvous = lobby == null ? null : { ds: String(lobby.dataset), wallet: lobby.wallet, sessionKey: lobby.sessionKey }

const t0 = Date.now()
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s`
const log = (who, ...a) => console.log(`[${stamp()}] [${who}]`, ...a)

async function client(name, me, peers, lobby = rendezvous) {
  const transport = await createByowTransport({ me, peers, rendezvous: lobby })
  const identity = await generateIdentity()
  const verdicts = new WeakMap()
  async function verified() {
    const raw = (await transport.list()).filter((p) => p != null)
    const unseen = raw.filter((p) => !verdicts.has(p))
    const results = await verifyAll(unseen)
    unseen.forEach((p, i) => verdicts.set(p, results[i]))
    return raw.map((p) => verdicts.get(p)).filter((p) => p != null && p.app === APP)
  }
  return {
    name,
    transport,
    token: identity.token,
    async view(game, root) {
      const pieces = await verified()
      for (const p of pieces) {
        if (p.type === 'announce' && p.game === game && String(p.root) === String(root)) transport.addDataSet(p.ds)
      }
      const state = foldByow(game, root, pieces)
      for (const ds of dataSetsOf(state)) transport.addDataSet(ds)
      return state
    },
    async write(payload, label) {
      const signed = await signPiece({ ...payload, v: 2, app: APP, log: transport.logId }, identity)
      const started = Date.now()
      await transport.append(signed, (stage) => log(name, `${label}: ${stage}`))
      log(name, `${label}: submitted after ${((Date.now() - started) / 1000).toFixed(1)}s`)
      return signed
    },
    async announce(game, root) {
      const signed = await signPiece(
        { v: 2, app: APP, log: transport.rendezvousLog, type: 'announce', game, root, ds: transport.me.ds, role: 'player' },
        identity,
      )
      await transport.announce(signed, (stage) => log(name, `announce: ${stage}`))
    },
  }
}

/** Polls until predicate(state) holds; the poll IS the settlement observation. */
async function until(who, game, root, label, predicate, timeoutMs = 6 * 60_000) {
  const started = Date.now()
  for (;;) {
    const state = await who.view(game, root)
    if (predicate(state)) {
      log(who.name, `${label} (settled after ${((Date.now() - started) / 1000).toFixed(0)}s)`)
      return state
    }
    if (Date.now() - started > timeoutMs) throw new Error(`${who.name}: timed out waiting for ${label}`)
    const problems = who.transport.problems()
    if (problems.length > 0) log(who.name, 'read problems', problems)
    await new Promise((r) => setTimeout(r, 6000))
  }
}

log('proof', `wallet A ${A.wallet} data set ${A.ds}; wallet B ${B.wallet} data set ${B.ds}; rendezvous ${rendezvous?.ds ?? 'none'}`)
const alice = await client('alice', { ds: A.ds, wallet: A.wallet, sessionKey: A.sessionKey }, [])
const bob = await client('bob', { ds: B.ds, wallet: B.wallet, sessionKey: B.sessionKey }, [A.ds])
assert.notEqual(alice.token, bob.token)

const game = `game-${crypto.randomUUID()}`
const root = String(A.ds)
log('proof', `game ${game} rooted in data set ${root}`)

// 1. X creates in X's data set. The invite is (game, root).
await alice.write({ type: 'create', game, name: 'byow settlement proof' }, 'create')
let a = await until(alice, game, root, 'alice sees her create', (s) => s.seats.X === alice.token)
if (rendezvous != null) await alice.announce(game, root)

// 2. O follows the invite: reads the root, joins in O's own data set.
let b = await until(bob, game, root, 'bob sees the game', (s) => s.seats.X === alice.token)
await bob.write({ type: 'join', game, prev: b.lastRef }, 'join')
if (rendezvous != null) {
  await bob.announce(game, root)
} else {
  alice.transport.addDataSet(B.ds) // the invite link O sends back
}
b = await until(bob, game, root, 'bob sees his join', (s) => s.joins.some((j) => j.token === bob.token))

// 3. X discovers O's data set (announce or link-back) and ratifies with the first move.
a = await until(alice, game, root, 'alice sees a joiner', (s) => s.joins.length > 0)
const join = a.joins.find((j) => j.token === bob.token)
assert.ok(join, 'alice discovered bob through FOC')
assert.equal(join.ds, String(B.ds))
await alice.write({ type: 'move', game, seq: 0, prev: join.ref, cell: 4, o: { token: join.token, ds: join.ds } }, 'ratify + X at 4')
a = await until(alice, game, root, 'alice sees ratification', (s) => s.ratified && s.board[4] === 'X')
b = await until(bob, game, root, 'bob sees he is O', (s) => s.ratified && s.seats.O === bob.token)

// 4. Alternate to an X win on the 2-4-6 diagonal.
const plan = [[bob, 0], [alice, 2], [bob, 1], [alice, 6]]
for (const [who, cell] of plan) {
  const before = await who.view(game, root)
  const seat = before.seats.X === who.token ? 'X' : 'O'
  assert.equal(before.next, seat, `${who.name} moves in turn`)
  await who.write({ type: 'move', game, seq: before.seq, prev: before.lastRef, cell }, `${seat} at ${cell}`)
  const other = who === alice ? bob : alice
  await until(who, game, root, `${who.name} sees ${seat} at ${cell}`, (s) => s.board[cell] === seat)
  await until(other, game, root, `${other.name} sees ${seat} at ${cell}`, (s) => s.board[cell] === seat)
}

a = await alice.view(game, root)
b = await bob.view(game, root)
assert.deepEqual(a, b, 'both players fold to identical state')
assert.equal(a.winner, 'X')
assert.equal(a.ignored, 0)

// 5. A stranger with only the invite (game id + root data set) and no
// wallet, key, or lobby reconstructs the game from FOC alone.
const carol = await client('carol', null, [root], null)
const c = await until(carol, game, root, 'carol reconstructs the finished game', (s) => s.winner === 'X')
assert.deepEqual(c, a, 'spectator agrees with both players')
assert.deepEqual(carol.transport.dataSets().sort(), [root, String(B.ds)].sort())
assert.deepEqual(carol.transport.disputes(), [])
assert.equal(c.homes.X, String(A.ds))
assert.equal(c.homes.O, String(B.ds))
assert.ok(a.seats.X !== a.seats.O)

console.log(JSON.stringify({
  ok: true,
  game,
  root,
  homes: a.homes,
  wallets: { X: A.wallet, O: B.wallet },
  board: a.board,
  winner: a.winner,
  applied: a.applied,
  ignored: a.ignored,
  logs: { X: homeLog(A.ds), O: homeLog(B.ds) },
  elapsedSeconds: Math.round((Date.now() - t0) / 1000),
}, null, 2))
