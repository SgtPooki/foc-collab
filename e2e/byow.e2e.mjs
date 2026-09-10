#!/usr/bin/env node
/**
 * BYOW browser proof: two isolated browser contexts, two player
 * descriptors (two wallets, two data sets), one built BYOW page. Alice
 * creates a game in her data set and shares the invite link; Bob opens it,
 * joins from his own data set; Alice's page discovers his data set from
 * the PieceAdded event of his tagged join; Alice's first move seats him
 * as O; both boards converge by polling Filecoin Onchain Cloud. No lobby,
 * no publisher key in the page.
 *
 * Prereqs: a BUILT page (scripts/build-page.mjs <dir> <byow-config.json>)
 * served at E2E_URL (default http://localhost:4173/), and the two player
 * descriptor files. Writes real pieces; allow ~8 minutes.
 *
 *   E2E_PLAYER_A=.byow/player-a.json E2E_PLAYER_B=.byow/player-b.json node e2e/byow.e2e.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium } from 'playwright'

const URL = process.env.E2E_URL ?? 'http://localhost:4173/'
// Board differences per game: what to click and what to expect.
const GAMES = {
  'tic-tac-toe': {
    first: '#board button >> nth=4', firstMark: async (p) => (await p.locator('#board button').nth(4).textContent()) === 'X',
    second: '#board button >> nth=0', secondMark: async (p) => (await p.locator('#board button').nth(0).textContent()) === 'O',
    pending: '#board button.pending', last: '#board button.last', oToMove: 'O to move', xToMove: 'X to move',
  },
  'connect-four': {
    first: '#board .cell.drop >> nth=3', firstMark: async (p) => (await p.locator('#board .disc.X').count()) === 1,
    second: '#board .cell.drop >> nth=0', secondMark: async (p) => (await p.locator('#board .disc.O').count()) === 1,
    pending: '#board .disc.pending', last: '#board .disc.last', oToMove: 'Yellow to move', xToMove: 'Red to move',
  },
}
const GAME = GAMES[process.env.E2E_GAME ?? 'tic-tac-toe']
const A = fs.readFileSync(process.env.E2E_PLAYER_A ?? '.byow/player-a.json', 'utf8')
const B = fs.readFileSync(process.env.E2E_PLAYER_B ?? '.byow/player-b.json', 'utf8')
const T = 360000
const browser = await chromium.launch()
const log = (who, ...a) => console.log(`[${new Date().toISOString().slice(11, 19)}] [${who}]`, ...a)

let cdnHits = 0
async function player(name, descriptor, gameName) {
  const context = await browser.newContext()
  // The descriptor is what a player pastes once; seed it the same way.
  await context.addInitScript((d) => { localStorage.setItem('ttt:byow:me', d) }, descriptor)
  const page = await context.newPage()
  page.on('dialog', (d) => d.accept(gameName ?? ''))
  page.on('pageerror', (e) => log(name, 'PAGEERROR', String(e).slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error') log(name, 'CONSOLE', m.text().slice(0, 300)) })
  page.on('request', (r) => {
    if (/esm\.sh|cdn\.jsdelivr|unpkg/.test(r.url())) cdnHits++
  })
  return { name, page }
}

process.on('uncaughtException', async (err) => {
  console.error(err)
  for (const p of [alice, bob]) {
    for (const id of ['#transport-label', '#status', '#byow-meta', '#log-info']) {
      const text = await p.page.locator(id).textContent().catch(() => '?')
      log(p.name, id, String(text).slice(0, 200))
    }
  }
  process.exit(1)
})

const gameName = `byow-e2e-${Date.now().toString(36)}`
const alice = await player('alice', A, gameName)
const bob = await player('bob', B)

await alice.page.goto(URL)
await alice.page.locator('#lobby').waitFor({ state: 'visible', timeout: T })
assert.match(await alice.page.locator('#transport-label').textContent(), /your data set #/)
await alice.page.locator('#create').click()
await alice.page.locator('#game').waitFor({ state: 'visible', timeout: T })
const invite = alice.page.url()
assert.match(invite, /[?&]x=\d+/, 'invite carries the root data set')
assert.match(invite, /[?&]from=\d+/, 'invite carries the create block for discovery')
log('alice', 'created', invite)

await bob.page.goto(invite)
await bob.page.locator('#join').waitFor({ state: 'visible', timeout: T })
await bob.page.locator('#join').click()
await bob.page.locator('#status').filter({ hasText: /you joined/ }).waitFor({ timeout: T })
log('bob', 'joined from his own data set')

assert.ok(await bob.page.locator('#link-back').isVisible(), 'link-back fallback offered while unratified')
assert.match(bob.page.url(), /[?&]o=\d+/, 'bob\'s own URL now carries his data set')

await alice.page.locator('#status').filter({ hasText: /joined — your first move/ }).waitFor({ timeout: T })
log('alice', 'discovered bob through chain events:', (await alice.page.locator('#byow-meta').textContent()).slice(0, 120))
await alice.page.locator(GAME.first).click()
await alice.page.locator(GAME.pending).waitFor({ timeout: 3000 })
await alice.page.locator('#status').filter({ hasText: /move sent/ }).waitFor({ timeout: T })
await alice.page.locator('#status').filter({ hasText: 'waiting for your opponent' }).waitFor({ timeout: T })
log('alice', 'ratified bob as O with X at 4')

await bob.page.locator('#status').filter({ hasText: GAME.oToMove }).waitFor({ timeout: T })
assert.ok(await GAME.firstMark(bob.page), 'bob sees the first move')
assert.match(await bob.page.locator('#byow-meta').textContent(), /O writes to #/)
log('bob', 'is O; board shows X at 4; meta:', (await bob.page.locator('#byow-meta').textContent()).slice(0, 100))
await bob.page.locator(GAME.second).click()
await bob.page.locator('#status').filter({ hasText: 'waiting for your opponent' }).waitFor({ timeout: T })
await alice.page.locator('#status').filter({ hasText: GAME.xToMove }).waitFor({ timeout: T })
assert.ok(await GAME.secondMark(alice.page), 'alice sees the reply')
assert.ok((await alice.page.locator(GAME.last).count()) >= 1, 'last-move highlight')
assert.equal(cdnHits, 0, 'no runtime CDN requests')
log('e2e', 'PASS: two wallets, two data sets, two browsers converged')
await browser.close()
