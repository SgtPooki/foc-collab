import assert from 'node:assert/strict'
import { test } from 'node:test'
import { describe, traitsOf } from './traits.js'

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
