import assert from 'node:assert/strict'
import { test } from 'node:test'
import { feeParse } from './foc-deps.js'
import { open, seal, unwrapKey, wrapKey } from './seal.js'

const bytes = (s) => new TextEncoder().encode(s)
const text = (b) => new TextDecoder().decode(b)
const rand = () => crypto.getRandomValues(new Uint8Array(32))

test('a sealed blob is a FEE COSE_Encrypt with one A256KW recipient, and opens with the kek', async () => {
  const kek = rand()
  const blob = await seal(bytes('photo bytes'), kek)
  const env = feeParse(blob)
  assert.equal(env.tag, 96)
  assert.equal(env.algorithm, 3)
  assert.deepEqual(env.recipients.map((r) => r.algorithm), [-5])
  assert.equal(text(await open(blob, kek)), 'photo bytes')
  assert.equal(kek.some((b) => b !== 0), true, 'the caller\'s kek is not zeroed')
})

test('each seal uses a fresh content key', async () => {
  const kek = rand()
  const [a, b] = await Promise.all([seal(bytes('same'), kek), seal(bytes('same'), kek)])
  // A256KW is deterministic, so a reused CEK would wrap to the same bytes.
  assert.notDeepEqual(feeParse(a).recipients[0].wrappedKey, feeParse(b).recipients[0].wrappedKey)
})

test('open refuses the wrong kek and a tampered blob', async () => {
  const kek = rand()
  const blob = await seal(bytes('secret'), kek)
  await assert.rejects(open(blob, rand()), /no recipient/)
  const tampered = blob.slice()
  tampered[tampered.length - 1] ^= 1
  await assert.rejects(open(tampered, kek), { name: 'AuthenticationError' })
})

test('wrapKey/unwrapKey round-trip; the wrong kek fails loudly', async () => {
  const kek = rand()
  const key = rand()
  const wrapped = await wrapKey(kek, key)
  assert.equal(wrapped.length, 40)
  assert.deepEqual(await unwrapKey(kek, wrapped), key)
  await assert.rejects(unwrapKey(rand(), wrapped), { name: 'OperationError' })
  await assert.rejects(wrapKey(new Uint8Array(16), key), /32 bytes/)
})
