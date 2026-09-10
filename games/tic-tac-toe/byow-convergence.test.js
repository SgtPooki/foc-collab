/**
 * Two-client BYOW convergence over the transport contract, no chain, no
 * DOM. An in-memory stand-in for Filecoin Onchain Cloud keeps one log per
 * data set and assigns piece ids monotonically inside each, exactly the
 * property the v2 fold relies on. Clients sign with real P-256 identities,
 * write only to their own data set, list every data set they know about,
 * verify, and fold. Assertions everywhere: identical state on every client.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { seatOf, status } from './fold.js'
import { dataSetsOf, foldByow, homeLog } from './fold-byow.js'
import { generateIdentity, signPiece, verifyAll } from './identity.js'

const APP = 'foc-ttt'
const G = 'game-byow'

/** In-memory FOC: per-data-set logs with chain-style monotonic piece ids. */
function memoryFoc() {
  const sets = new Map() // ds -> [{ pieceId, body }]
  const log = (ds) => {
    if (!sets.has(ds)) sets.set(ds, [])
    return sets.get(ds)
  }
  return {
    append(ds, body) {
      const entries = log(ds)
      entries.push({ pieceId: BigInt(entries.length), body })
    },
    remove(ds, pieceId) {
      sets.set(ds, log(ds).filter((e) => e.pieceId !== BigInt(pieceId)))
    },
    list(dsList) {
      // Deliberately return data sets in reverse and entries newest-first:
      // listing order must not matter.
      return [...dsList].reverse().flatMap((ds) => log(ds).slice().reverse()
        .map(({ pieceId, body }) => ({ ...body, src: ds, pieceId: String(pieceId) })))
    },
  }
}

async function client(foc, ds, peers = []) {
  const identity = await generateIdentity()
  const known = new Set([ds, ...peers])
  return {
    ds,
    token: identity.token,
    addDataSet: (d) => known.add(d),
    known: () => [...known],
    async write(payload) {
      const signed = await signPiece({ ...payload, v: 2, app: APP, log: homeLog(ds) }, identity)
      foc.append(ds, signed)
      return signed
    },
    async view(root = ds) {
      const verified = (await verifyAll(foc.list([...known]))).filter((p) => p != null && p.app === APP)
      const state = foldByow(G, root, verified)
      for (const d of dataSetsOf(state)) known.add(d)
      return state
    },
  }
}

async function converge(clients, root) {
  const views = await Promise.all(clients.map((c) => c.view(root)))
  for (const v of views.slice(1)) assert.deepEqual(v, views[0])
  return views[0]
}

test('create, join, ratify, full game: two data sets, both clients converge on X win', async () => {
  const foc = memoryFoc()
  const alice = await client(foc, '100')
  const bob = await client(foc, '200', ['100'])
  const root = alice.ds

  await alice.write({ type: 'create', game: G, name: 'first' })
  assert.equal(status(await bob.view(root)), 'waiting for opponent')
  await bob.write({ type: 'join', game: G, prev: (await bob.view(root)).lastRef })
  alice.addDataSet(bob.ds) // the invite link back, or a rendezvous announce

  let s = await alice.view(root)
  assert.equal(s.ratified, false)
  assert.equal(s.joins[0].token, bob.token)
  await alice.write({ type: 'move', game: G, seq: 0, prev: s.joins[0].ref, cell: 4, o: { token: bob.token, ds: bob.ds } })
  s = await converge([alice, bob], root)
  assert.equal(seatOf(s, bob.token), 'O')
  assert.deepEqual(s.homes, { X: '100', O: '200' })

  const play = async (who, cell) => {
    const v = await who.view(root)
    await who.write({ type: 'move', game: G, seq: v.seq, prev: v.lastRef, cell })
  }
  for (const [who, cell] of [[bob, 0], [alice, 2], [bob, 1], [alice, 6]]) await play(who, cell)
  s = await converge([alice, bob], root)
  assert.equal(s.winner, 'X')
  assert.equal(s.ignored, 0)
})

test('late joiner with only the invite reconstructs from the root and discovers O\'s data set', async () => {
  const foc = memoryFoc()
  const alice = await client(foc, '100')
  const bob = await client(foc, '200', ['100'])
  await alice.write({ type: 'create', game: G })
  await bob.write({ type: 'join', game: G, prev: (await bob.view('100')).lastRef })
  alice.addDataSet('200')
  const a0 = await alice.view('100')
  await alice.write({ type: 'move', game: G, seq: 0, prev: a0.joins[0].ref, cell: 4, o: { token: bob.token, ds: '200' } })
  await bob.write({ type: 'move', game: G, seq: 1, prev: (await bob.view('100')).lastRef, cell: 0 })

  const carol = await client(foc, '300', ['100']) // knows only the root
  let c = await carol.view('100')
  assert.equal(c.ratified, false, 'first pass: root only, cannot see the join itself')
  assert.deepEqual(c.hints, ['200'], 'but X\'s ratification piece names O\'s data set')
  assert.deepEqual(carol.known().sort(), ['100', '200', '300'], 'so the client starts reading it')
  c = await carol.view('100')
  assert.equal(c.ratified, true)
  assert.equal(c.board[0], 'O')
  assert.deepEqual(c, await converge([alice, bob], '100'))
})

test('equivocation: X signs two seq-0 moves; the first to land wins on every client, and O\'s reply on it stands', async () => {
  const foc = memoryFoc()
  const alice = await client(foc, '100')
  const bob = await client(foc, '200', ['100'])
  await alice.write({ type: 'create', game: G })
  await bob.write({ type: 'join', game: G, prev: (await bob.view('100')).lastRef })
  alice.addDataSet('200')
  const join = (await alice.view('100')).joins[0]
  const first = await alice.write({ type: 'move', game: G, seq: 0, prev: join.ref, cell: 4, o: { token: bob.token, ds: '200' } })
  const b = await bob.view('100')
  await bob.write({ type: 'move', game: G, seq: 1, prev: b.lastRef, cell: 0 })
  // Alice now tries to take it back with a different seq-0 move.
  await alice.write({ type: 'move', game: G, seq: 0, prev: join.ref, cell: 8, o: { token: bob.token, ds: '200' } })
  const s = await converge([alice, bob], '100')
  assert.equal(s.board[4], 'X')
  assert.equal(s.board[8], null)
  assert.equal(s.board[0], 'O')
  assert.equal(s.ignored, 1)
  void first
})

test('join race: two joiners in two data sets; X\'s first move decides, the other stays a spectator everywhere', async () => {
  const foc = memoryFoc()
  const alice = await client(foc, '100')
  const bob = await client(foc, '200', ['100'])
  const carol = await client(foc, '300', ['100'])
  await alice.write({ type: 'create', game: G })
  const prev = (await bob.view('100')).lastRef
  await carol.write({ type: 'join', game: G, prev })
  await bob.write({ type: 'join', game: G, prev })
  alice.addDataSet('200')
  alice.addDataSet('300')
  const a = await alice.view('100')
  assert.equal(a.joins.length, 2)
  const pick = a.joins.find((j) => j.token === bob.token)
  await alice.write({ type: 'move', game: G, seq: 0, prev: pick.ref, cell: 4, o: { token: pick.token, ds: pick.ds } })
  bob.addDataSet('300')
  carol.addDataSet('200')
  const s = await converge([alice, bob, carol], '100')
  assert.equal(seatOf(s, bob.token), 'O')
  assert.equal(seatOf(s, carol.token), null)
  assert.equal(s.ignored, 1)
})

test('stale-read move race: a reply built on the wrong predecessor is ignored and can be replayed', async () => {
  const foc = memoryFoc()
  const alice = await client(foc, '100')
  const bob = await client(foc, '200', ['100'])
  await alice.write({ type: 'create', game: G })
  await bob.write({ type: 'join', game: G, prev: (await bob.view('100')).lastRef })
  alice.addDataSet('200')
  const join = (await alice.view('100')).joins[0]
  await alice.write({ type: 'move', game: G, seq: 0, prev: join.ref, cell: 4, o: { token: bob.token, ds: '200' } })
  // Bob replies to a move he only imagined (e.g. gossiped and never landed).
  await bob.write({ type: 'move', game: G, seq: 1, prev: 'sha256:never-landed', cell: 0 })
  let s = await converge([alice, bob], '100')
  assert.equal(s.board[0], null)
  assert.equal(s.next, 'O')
  await bob.write({ type: 'move', game: G, seq: 1, prev: s.lastRef, cell: 0 })
  s = await converge([alice, bob], '100')
  assert.equal(s.board[0], 'O')
  assert.equal(s.ignored, 1)
})

test('replay across data sets: O\'s signed move copied into X\'s data set is dropped by home binding', async () => {
  const foc = memoryFoc()
  const alice = await client(foc, '100')
  const bob = await client(foc, '200', ['100'])
  await alice.write({ type: 'create', game: G })
  await bob.write({ type: 'join', game: G, prev: (await bob.view('100')).lastRef })
  alice.addDataSet('200')
  const join = (await alice.view('100')).joins[0]
  await alice.write({ type: 'move', game: G, seq: 0, prev: join.ref, cell: 4, o: { token: bob.token, ds: '200' } })
  const bobMove = await bob.write({ type: 'move', game: G, seq: 1, prev: (await bob.view('100')).lastRef, cell: 0 })
  const mallory = await client(foc, '100')
  await mallory.write({ type: 'move', game: G, seq: 2, prev: 'x', cell: 1 }) // impostor in X's set: not X's token
  foc.append('100', bobMove) // replay O's piece into X's set
  const s = await converge([alice, bob], '100')
  assert.equal(s.board[0], 'O', 'the genuine move in O\'s data set counts once')
  assert.equal(s.board[1], null)
  assert.equal(s.ignored, 1, 'the impostor is counted; the replay is not even a candidate (home binding fails)')
})

test('removal is detected as a dispute by a client that cached the piece; an uncached reader sees a shorter chain', async () => {
  const foc = memoryFoc()
  const alice = await client(foc, '100')
  const bob = await client(foc, '200', ['100'])
  await alice.write({ type: 'create', game: G })
  await bob.write({ type: 'join', game: G, prev: (await bob.view('100')).lastRef })
  alice.addDataSet('200')
  const join = (await alice.view('100')).joins[0]
  await alice.write({ type: 'move', game: G, seq: 0, prev: join.ref, cell: 4, o: { token: bob.token, ds: '200' } })
  const before = await converge([alice, bob], '100')
  const ratification = foc.list(['100']).find((p) => p.type === 'move')
  foc.remove('100', ratification.pieceId)
  // A client without a cache folds what is active: the ratification is gone.
  const fresh = await bob.view('100')
  assert.equal(fresh.ratified, false)
  // A cached client keeps the piece it already saw (transport-byow.js marks it removed) and does not rewind.
  const cached = foldByow(G, '100', (await verifyAll(foc.list(['100', '200']).concat([{ ...ratification, removed: true }])))
    .filter((p) => p != null))
  assert.deepEqual(cached.board, before.board)
})
