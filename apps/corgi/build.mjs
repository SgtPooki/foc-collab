#!/usr/bin/env node
/**
 * Build the publishable corgi page: bundle the synapse-core/viem surface
 * from the pinned node_modules into vendor.js (no runtime CDN), copy the
 * page sources, and inject the corgi config block.
 *
 * Usage:
 *   node apps/corgi/build.mjs <out-dir> [config.json]
 *
 * config.json: { "chain": "calibration", "payer": "0x…", "fromBlock": N,
 *                "adoptionThreshold": "5" }
 * Without a config the page reads ?payer=0x…&chain=…&fromBlock=N from the URL.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const src = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(src, '../..')
const [outDir, configPath] = process.argv.slice(2)
if (!outDir) {
  console.error('usage: node apps/corgi/build.mjs <out-dir> [config.json]')
  process.exit(1)
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

execFileSync('npx', [
  'esbuild', path.join(src, 'deps.js'),
  '--bundle', '--format=esm', '--minify', '--target=es2022',
  `--outfile=${path.join(outDir, 'vendor.js')}`,
], { cwd: root, stdio: 'inherit' })

for (const f of ['index.html', 'app.js', 'fold.js', 'sprite.js']) {
  fs.copyFileSync(path.join(src, f), path.join(outDir, f))
}
// chain.js imports the SDK surface from deps.js in source (so node tests
// resolve node_modules); the published page gets the bundle instead.
const chainSrc = fs.readFileSync(path.join(src, 'chain.js'), 'utf8')
fs.writeFileSync(path.join(outDir, 'chain.js'), chainSrc.replace("from './deps.js'", "from './vendor.js'"))

if (configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (!/^0x[0-9a-fA-F]{40}$/.test(config.payer ?? '')) throw new Error('config.payer must be an address')
  const page = path.join(outDir, 'index.html')
  const html = fs.readFileSync(page, 'utf8').replace(
    '</head>',
    `<script type="application/json" id="corgi-config">${JSON.stringify(config)}</script>\n</head>`,
  )
  fs.writeFileSync(page, html)
}
console.log(`built ${outDir}${configPath ? ' (configured corgi)' : ' (payer from URL)'}`)
