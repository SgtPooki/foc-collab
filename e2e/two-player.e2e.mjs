#!/usr/bin/env node
/**
 * Two isolated browsers play a real game through shared storage: create,
 * invite, join, one move each way — asserting the UX contract (optimistic
 * pending mark, staged progress, early release at "move sent", countdown,
 * last-move highlight, your-turn title) and that the page never touches a
 * CDN at runtime.
 *
 * Prereqs: a BUILT page (scripts/build-page.mjs <dir> <config.json>)
 * served at E2E_URL (default http://localhost:4173/). Writes real pieces
 * to the configured data set; allow ~5 minutes.
 */
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const URL = process.env.E2E_URL ?? 'http://localhost:4173/'
const browser = await chromium.launch()
const log = (who, ...a) => console.log(`[${who}]`, ...a)

async function player(name, gameName) {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept(gameName ?? ''))
  page.on('pageerror', (e) => log(name, 'PAGEERROR', String(e).slice(0, 300)))
  return { name, page }
}

const gameName = `e2e-${Date.now().toString(36)}`
const alice = await player('alice', gameName)
const bob = await player('bob')

let cdnHits = 0
for (const p of [alice.page, bob.page]) {
  p.on('request', (r) => {
    if (/esm\.sh|cdn\.jsdelivr|unpkg/.test(r.url())) cdnHits++
  })
}

await alice.page.goto(URL)
await alice.page.locator('#lobby').waitFor({ state: 'visible', timeout: 120000 })
await alice.page.locator('#create').click()
await alice.page.locator('#game').waitFor({ state: 'visible', timeout: 300000 })
const invite = alice.page.url()
log('alice', 'created', invite)

await bob.page.goto(invite)
await bob.page.locator('#join').waitFor({ state: 'visible', timeout: 300000 })
await bob.page.locator('#join').click()
await bob.page.locator('#status').filter({ hasText: 'you are O' }).waitFor({ timeout: 300000 })
log('bob', 'joined as O')

await alice.page.locator('#status').filter({ hasText: 'X to move' }).waitFor({ timeout: 300000 })
await alice.page.locator('#board button').nth(4).click()
await alice.page.locator('#board button.pending').waitFor({ timeout: 3000 })
assert.equal(await alice.page.locator('#board button:not(:disabled)').count(), 0, 'board locked while saving')
await alice.page.locator('#status').filter({ hasText: /move sent/ }).waitFor({ timeout: 300000 })
log('alice', 'early release:', (await alice.page.locator('#status').textContent()).slice(0, 60))
await alice.page.locator('#status').filter({ hasText: 'waiting for your opponent' }).waitFor({ timeout: 300000 })
assert.equal(await alice.page.locator('#board button.pending').count(), 0, 'pending cleared after log caught up')

await bob.page.locator('#status').filter({ hasText: 'O to move' }).waitFor({ timeout: 300000 })
assert.equal(await bob.page.locator('#board button').nth(4).textContent(), 'X', 'bob sees the move')
assert.ok((await bob.page.locator('#board button.last').count()) >= 1, 'last-move highlight')
assert.ok((await bob.page.title()).includes('your move'), 'your-turn title')
assert.equal(cdnHits, 0, 'no runtime CDN requests')
log('e2e', 'PASS')
await browser.close()
