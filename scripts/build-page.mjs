#!/usr/bin/env node
/**
 * Build one game's publishable page: bundle the FOC deps from the pinned
 * node_modules (no runtime CDN), copy the game's sources plus the shared
 * modules from games/lib flattened next to them, and inject the config
 * block.
 *
 * Usage:
 *   node scripts/build-page.mjs <out-dir> [config.json] [--game <name>]
 *
 * --game defaults to tic-tac-toe. Without a config file the build is a
 * local-transport page (dev/demo). A BYOW config is { "mode": "byow" }.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const gameFlag = args.indexOf('--game')
const game = gameFlag === -1 ? 'tic-tac-toe' : args.splice(gameFlag, 2)[1]
const [outDir, configPath] = args
if (!outDir) {
  console.error('usage: node scripts/build-page.mjs <out-dir> [config.json] [--game <name>]')
  process.exit(1)
}
const src = path.join(root, 'games', game)
const lib = path.join(root, 'games/lib')

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

execFileSync('npx', [
  'esbuild', path.join(lib, 'foc-deps.js'),
  '--bundle', '--format=esm', '--minify',
  `--outfile=${path.join(outDir, 'vendor-foc.js')}`,
], { cwd: root, stdio: 'inherit' })

const isSource = (f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'foc-deps.js'
// Shared modules: the page gets copies pointed at the bundle instead of node_modules.
for (const f of fs.readdirSync(lib).filter(isSource)) {
  fs.writeFileSync(path.join(outDir, f), fs.readFileSync(path.join(lib, f), 'utf8').replaceAll("from './foc-deps.js'", "from './vendor-foc.js'"))
}
// Game modules: imports of ../lib/x.js become ./x.js since everything is flat.
for (const f of fs.readdirSync(src).filter((f) => f === 'index.html' || isSource(f))) {
  fs.writeFileSync(path.join(outDir, f), fs.readFileSync(path.join(src, f), 'utf8').replaceAll("from '../lib/", "from './"))
}

if (configPath) {
  const config = JSON.stringify(JSON.parse(fs.readFileSync(configPath, 'utf8')))
  const page = path.join(outDir, 'index.html')
  const html = fs.readFileSync(page, 'utf8').replace(
    '</head>',
    `<script type="application/json" id="foc-config">${config}</script>\n</head>`,
  )
  fs.writeFileSync(page, html)
}

console.log(`built ${game} at ${outDir}${configPath ? ' (configured)' : ' (local transport only)'}`)
