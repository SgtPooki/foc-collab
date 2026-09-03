#!/usr/bin/env node
/**
 * Build the publishable corgi page: bundle app.js with everything it
 * imports (synapse-core, viem, three) from the pinned node_modules into one
 * script, copy index.html, and inject the corgi config block. No runtime CDN.
 *
 * Usage:
 *   node apps/corgi/build.mjs <out-dir> [config.json]
 *
 * config.json: { "chain": "calibration", "payer": "0x…", "fromBlock": N,
 *                "adoptionThreshold": "1" }
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
  'esbuild', path.join(src, 'app.js'),
  '--bundle', '--format=esm', '--minify', '--target=es2022',
  `--outfile=${path.join(outDir, 'app.js')}`,
], { cwd: root, stdio: 'inherit' })

let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8')
if (configPath) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  if (!/^0x[0-9a-fA-F]{40}$/.test(config.payer ?? '')) throw new Error('config.payer must be an address')
  html = html.replace('</head>', `<script type="application/json" id="corgi-config">${JSON.stringify(config)}</script>\n</head>`)
}
fs.writeFileSync(path.join(outDir, 'index.html'), html)
console.log(`built ${outDir}${configPath ? ' (configured corgi)' : ' (payer from URL)'}`)
