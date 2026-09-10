#!/usr/bin/env node
/**
 * Build the whole static site: the landing page plus every game as a
 * self-contained BYOW page under its own directory. Output is a plain
 * directory that any static host (GitHub Pages, an IPFS gateway, a
 * folder on disk) can serve; nothing in it is secret.
 *
 *   node scripts/build-site.mjs [out-dir]     (default dist/site)
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'dist/site'))
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
fs.copyFileSync(path.join(root, 'site/index.html'), path.join(outDir, 'index.html'))
fs.writeFileSync(path.join(outDir, '.nojekyll'), '')
for (const game of ['tic-tac-toe', 'connect-four']) {
  execFileSync('node', [
    path.join(root, 'scripts/build-page.mjs'),
    path.join(outDir, game),
    path.join(root, `site/${game}.config.json`),
    '--game', game,
  ], { stdio: 'inherit' })
}
// The corgi has its own bundler (three.js and all): apps/corgi/build.mjs.
execFileSync('node', [
  path.join(root, 'apps/corgi/build.mjs'),
  path.join(outDir, 'corgi'),
  path.join(root, 'apps/corgi/config.calibration.json'),
], { stdio: 'inherit' })
console.log(`site built at ${outDir}`)
