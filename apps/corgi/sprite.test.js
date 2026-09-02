import assert from 'node:assert/strict'
import { test } from 'node:test'
import { corgiSvg, traitsOf } from './sprite.js'

test('traits are deterministic per address and differ across addresses', () => {
  const a = traitsOf('0x1111111111111111111111111111111111111111')
  assert.deepEqual(a, traitsOf('0x1111111111111111111111111111111111111111'))
  const b = traitsOf('0x0000000000000000000000000000000000000c02')
  assert.notDeepEqual(a, b)
  assert.ok(a.scale >= 0.85 && a.scale <= 1.15)
})

test('svg reflects life and mood and is self-contained markup', () => {
  const alive = corgiSvg('0x1111111111111111111111111111111111111111', { life: 'thriving', mood: 'ecstatic' })
  const dead = corgiSvg('0x1111111111111111111111111111111111111111', { life: 'dead', mood: 'lonely' })
  assert.ok(alive.startsWith('<svg') && alive.trim().endsWith('</svg>'))
  assert.notEqual(alive, dead)
  assert.ok(dead.includes('opacity="0.78"'))
  assert.ok(!alive.includes('http://') || alive.includes('xmlns="http://www.w3.org/2000/svg"'))
})
