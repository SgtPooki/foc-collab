import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fold, seatOf } from './fold.js'
import { canon, generateIdentity, pieceRef, signPiece, verifyAll, verifyPiece } from './identity.js'

test('canon is order-insensitive and drops undefined', () => {
  assert.equal(canon({ b: 1, a: [2, { d: 3, c: 4 }], e: undefined }), canon({ a: [2, { c: 4, d: 3 }], b: 1 }))
})

test('signed piece verifies; any field tamper fails', async () => {
  const alice = await generateIdentity()
  const piece = await signPiece({ v: 1, type: 'move', game: 'g', seq: 0, cell: 4 }, alice)
  assert.equal(await verifyPiece(piece), true)
  assert.equal(await verifyPiece({ ...piece, cell: 5 }), false)
  assert.equal(await verifyPiece({ ...piece, game: 'other' }), false) // no cross-game replay
  assert.equal(await verifyPiece({ ...piece, sig: undefined }), false)
})

test('impersonation fails: forged piece carrying someone else\'s token is dropped', async () => {
  const alice = await generateIdentity()
  const mallory = await generateIdentity()
  // mallory signs with her own key but claims alice's token
  const forged = { ...(await signPiece({ v: 1, type: 'move', game: 'g', seq: 1, cell: 0 }, mallory)), token: alice.token }
  assert.equal(await verifyPiece(forged), false)
})

test('end to end: a spying game-4 player cannot take over game 1', async () => {
  const alice = await generateIdentity()
  const bob = await generateIdentity()
  const mallory = await generateIdentity()
  const G = 'g1'

  const log = [
    await signPiece({ v: 1, type: 'create', game: G }, alice),
    await signPiece({ v: 1, type: 'join', game: G }, bob),
    await signPiece({ v: 1, type: 'move', game: G, seq: 0, cell: 4 }, alice),
  ]
  // mallory read the whole log on-chain and knows both tokens; she tries:
  log.push({ v: 1, type: 'move', game: G, token: bob.token, seq: 1, cell: 0, sig: 'AAAA' }) // fake sig
  log.push({ ...(await signPiece({ v: 1, type: 'move', game: G, seq: 1, cell: 0 }, mallory)), token: bob.token }) // wrong key
  log.push(await signPiece({ v: 1, type: 'join', game: G }, mallory)) // valid sig, but seat O is taken
  log.push(await signPiece({ v: 1, type: 'move', game: G, seq: 1, cell: 0 }, mallory)) // valid sig, owns no seat
  // bob replays alice's own signed create into a new game id
  log.push({ ...log[0], game: 'g4-clone' })

  const state = fold(G, await verifyAll(log))
  assert.equal(seatOf(state, alice.token), 'X')
  assert.equal(seatOf(state, bob.token), 'O')
  assert.equal(seatOf(state, mallory.token), null)
  assert.equal(state.board[4], 'X')
  assert.equal(state.board[0], null) // none of mallory's attempts landed
  assert.equal(fold('g4-clone', await verifyAll(log)).seats.X, null) // replay died in verification
})

test('transport annotations (src, pieceId) and ref are outside the signature; signing them in fails', async () => {
  const alice = await generateIdentity()
  const piece = await signPiece({ v: 2, type: 'move', game: 'g', seq: 0, cell: 4, prev: 'p' }, alice)
  const annotated = { ...piece, src: '100', pieceId: 7n }
  assert.equal(await verifyPiece(annotated), true)
  assert.equal(await pieceRef(annotated), await pieceRef(piece), 'ref ignores annotations')
  const [verified] = await verifyAll([annotated])
  assert.equal(verified.src, '100')
  assert.equal(verified.ref, await pieceRef(piece))
  const smuggled = await signPiece({ ...piece, src: '999' }, alice) // author signs a src field
  assert.equal(await verifyPiece(smuggled), false)
})
