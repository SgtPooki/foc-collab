#!/usr/bin/env node
/**
 * Build the publishable tic-tac-toe page: bundle the FOC deps from the
 * pinned node_modules (no runtime CDN), copy the page sources, and inject
 * the shared-storage config block.
 *
 * Usage:
 *   node scripts/build-page.mjs <out-dir> [config.json]
 *
 * Without a config file the build is a local-transport page (dev/demo).
 * The config file is the JSON printed by scripts/setup-game-log.mjs.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const src = path.join(root, 'games/tic-tac-toe')
const [outDir, configPath] = process.argv.slice(2)
if (!outDir) {
  console.error('usage: node scripts/build-page.mjs <out-dir> [config.json]')
  process.exit(1)
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

execFileSync('npx', [
  'esbuild', path.join(src, 'foc-deps.js'),
  '--bundle', '--format=esm', '--minify',
  `--outfile=${path.join(outDir, 'vendor-foc.js')}`,
], { cwd: root, stdio: 'inherit' })

for (const f of ['index.html', 'fold.js', 'fold-byow.js', 'discover.js', 'identity.js', 'transport.js', 'transport-foc.js']) {
  fs.copyFileSync(path.join(src, f), path.join(outDir, f))
}
// The BYOW transport is shared with node (proof scripts import it straight
// from node_modules through foc-deps.js); the page gets the bundled copy.
fs.writeFileSync(
  path.join(outDir, 'transport-byow.js'),
  fs.readFileSync(path.join(src, 'transport-byow.js'), 'utf8').replace("from './foc-deps.js'", "from './vendor-foc.js'"),
)

if (configPath) {
  const config = JSON.stringify(JSON.parse(fs.readFileSync(configPath, 'utf8')))
  const page = path.join(outDir, 'index.html')
  const html = fs.readFileSync(page, 'utf8').replace(
    '</head>',
    `<script type="application/json" id="foc-config">${config}</script>\n</head>`,
  )
  fs.writeFileSync(page, html)
}

console.log(`built ${outDir}${configPath ? ' (shared storage)' : ' (local transport only)'}`)
