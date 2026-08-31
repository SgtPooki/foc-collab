/**
 * Two-client convergence tests over the transport interface — no chain, no
 * DOM. A shared in-memory log stands in for the data set: append pushes,
 * list returns all pieces in append order, exactly the total-order contract
 * the shared-storage transport provides. Each "client" folds independently;
 * the assertion everywhere is that both derive identical state.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fold, lobby, seatOf, status } from './fold.js'

function memoryLog() {
  const log = []
  const client = (token) => ({
    token,
    async append(piece) { log.push(piece) },
    async list() { return [...log] },
    async view(game) { return fold(game, await this.list()) },
  })
  return { client }
}

const G = 'game-t'

test('create → share → join → full game: both clients converge on X win', async () => {
  const { client } = memoryLog()
  const alice = client('alice')
  const bob = client('bob')

  await alice.append({ v: 1, type: 'create', game: G, token: alice.token, name: 'first' })
  // bob follows the invite link, sees the game, joins
  let bobView = await bob.view(G)
  assert.equal(status(bobView), 'waiting for opponent')
  await bob.append({ v: 1, type: 'join', game: G, token: bob.token })

  const play = async (who, cell) => {
    const s = await who.view(G) // each client folds before moving, like the UI does
    await who.append({ v: 1, type: 'move', game: G, token: who.token, seq: s.seq, cell })
  }
  for (const [who, cell] of [[alice, 0], [bob, 3], [alice, 1], [bob, 4], [alice, 2]]) {
    await play(who, cell)
  }

  const a = await alice.view(G)
  const b = await bob.view(G)
  assert.deepEqual(a, b)
  assert.equal(a.winner, 'X')
  assert.equal(seatOf(a, alice.token), 'X')
  assert.equal(seatOf(a, bob.token), 'O')
})

test('join race: two invitees, first append wins seat O on every client', async () => {
  const { client } = memoryLog()
  const alice = client('alice')
  const bob = client('bob')
  const carol = client('carol')
  await alice.append({ v: 1, type: 'create', game: G, token: alice.token })

  // bob and carol both see "waiting for opponent" and both join
  assert.equal(status(await bob.view(G)), 'waiting for opponent')
  assert.equal(status(await carol.view(G)), 'waiting for opponent')
  await bob.append({ v: 1, type: 'join', game: G, token: bob.token })
  await carol.append({ v: 1, type: 'join', game: G, token: carol.token })

  for (const c of [alice, bob, carol]) {
    const s = await c.view(G)
    assert.equal(seatOf(s, bob.token), 'O')
    assert.equal(seatOf(s, carol.token), null)
  }
})

test('stale-read move race: both claim seq 0, first-by-ordering wins, all clients converge', async () => {
  const { client } = memoryLog()
  const alice = client('alice')
  const bob = client('bob')
  await alice.append({ v: 1, type: 'create', game: G, token: alice.token })
  await bob.append({ v: 1, type: 'join', game: G, token: bob.token })

  // bob moves on a stale read (thinks it is still seq 0 / X's turn is wrong)
  const staleAlice = await alice.view(G)
  const staleBob = await bob.view(G)
  await alice.append({ v: 1, type: 'move', game: G, token: alice.token, seq: staleAlice.seq, cell: 4 })
  await bob.append({ v: 1, type: 'move', game: G, token: bob.token, seq: staleBob.seq, cell: 0 })

  const a = await alice.view(G)
  const b = await bob.view(G)
  assert.deepEqual(a, b)
  assert.equal(a.board[4], 'X') // alice's landed first
  assert.equal(a.board[0], null) // bob's stale claim ignored
  assert.equal(a.ignored, 1)
  // bob refreshes and replays legally
  await bob.append({ v: 1, type: 'move', game: G, token: bob.token, seq: (await bob.view(G)).seq, cell: 0 })
  assert.equal((await alice.view(G)).board[0], 'O')
})

test('interleaved games share one log without crosstalk; lobby lists both', async () => {
  const { client } = memoryLog()
  const alice = client('alice')
  const bob = client('bob')
  await alice.append({ v: 1, type: 'create', game: 'g1', token: alice.token })
  await bob.append({ v: 1, type: 'create', game: 'g2', token: bob.token })
  await bob.append({ v: 1, type: 'join', game: 'g1', token: bob.token })
  await alice.append({ v: 1, type: 'join', game: 'g2', token: alice.token })
  await alice.append({ v: 1, type: 'move', game: 'g1', token: alice.token, seq: 0, cell: 0 })
  await bob.append({ v: 1, type: 'move', game: 'g2', token: bob.token, seq: 0, cell: 8 })

  const games = lobby(await alice.list())
  assert.deepEqual(games.map((g) => g.game), ['g1', 'g2'])
  assert.equal(games[0].board[0], 'X')
  assert.equal(games[0].board[8], null)
  assert.equal(games[1].board[8], 'X')
})
