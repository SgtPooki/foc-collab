import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describe, nameOf, traitsOf } from './traits.js'

test('traits are deterministic and bounded', () => {
  const a = traitsOf('0xd677eFcD0Ae24e42FD74B9865C16f3fDaBC82492')
  assert.deepEqual(a, traitsOf('0xd677efcd0ae24e42fd74b9865c16f3fdabc82492'.toUpperCase().replace('0X', '0x')))
  assert.ok(a.size >= 0.8 && a.size <= 1.25)
  assert.ok(a.socks >= 0 && a.socks <= 4)
  assert.match(a.coat.body, /^#[0-9a-f]{6}$/)
  assert.equal(typeof describe(a), 'string')
})

test('address space spreads across coats, patterns, and accessories', () => {
  const coats = new Set(), patterns = new Set(), acc = new Set()
  for (let i = 0; i < 400; i++) {
    const t = traitsOf(`0x${(i * 2654435761 >>> 0).toString(16).padStart(8, '0').repeat(5)}`)
    coats.add(t.coat.name); patterns.add(t.pattern); acc.add(t.accessory)
  }
  assert.ok(coats.size >= 8 && patterns.size >= 6 && acc.size >= 8)
})

// Adopted corgis are a contract with their owners: these descriptions must
// never change. Add a line for every real adopter before touching traits.js.
test('real adopters keep their corgi across versions', () => {
  const pins = [
    // first calibration adopter, 2026-09-03, feed tx 0xf614a98c…
    ['0x44f08D1beFe61255b3C3A349C392C560FA333759', 'big saddle white corgi with a bandana, energetic'],
    // the test feeder wallet
    ['0xd677eFcD0Ae24e42FD74B9865C16f3fDaBC82492', 'big saddle cream corgi with a bow, curious'],
  ]
  for (const [address, expected] of pins) assert.equal(describe(traitsOf(address)), expected)
  assert.equal(nameOf('0x44f08D1beFe61255b3C3A349C392C560FA333759'), 'Willow Jr.')
})
