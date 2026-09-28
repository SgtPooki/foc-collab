import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fetchBounded, OWN, OversizedPiece, SPONSORED, upload } from './transport-byow.js'

// fetch answers `/len?n=` with a content-length and `/stream?n=` without one.
const realFetch = globalThis.fetch
before(() => {
  globalThis.fetch = async (url) => {
    const { pathname, searchParams } = new URL(url)
    const body = new Uint8Array(Number(searchParams.get('n'))).fill(7)
    if (pathname === '/len') return new Response(body, { headers: { 'content-length': String(body.length) } })
    const half = body.length / 2
    return new Response(new ReadableStream({
      start(c) {
        c.enqueue(body.subarray(0, half))
        c.enqueue(body.subarray(half))
        c.close()
      },
    }))
  }
})
after(() => {
  globalThis.fetch = realFetch
})

for (const [path, n, max, ok] of [
  ['len', 8192, undefined, true], // the default cap is 8 KiB, inclusive
  ['len', 8193, undefined, false], // refused from the header, before reading
  ['stream', 20000, undefined, false], // no header: refused while streaming
  ['len', 50000, 65536, true],
  ['stream', 50000, 65536, true],
]) {
  test(`fetchBounded ${path} n=${n} max=${max ?? 'default'}: ${ok ? 'returns the body' : 'refuses'}`, async () => {
    const got = fetchBounded(`http://p.test/${path}?n=${n}`, max)
    if (ok) assert.equal((await got).length, n)
    else await assert.rejects(got, OversizedPiece)
  })
}

test('upload resolves with the PieceCID once AddPieces is submitted, and passes the tags through', async () => {
  const stages = []
  let seen
  const ctx = {
    async upload(bytes, opts) {
      seen = { bytes, tags: opts.pieceMetadata }
      await null // the SDK calls back later, not inside upload()
      opts.onStored(1n, 'bafkzcibcid')
      opts.onPiecesAdded('0xtx', 1n, [{ pieceCid: { toString: () => 'bafkzcibcid' } }])
      return {}
    },
  }
  const cid = await upload(ctx, new Uint8Array([1, 2, 3]), (s) => stages.push(s), { app: 'foc-album' }, OWN)
  await null
  assert.equal(cid, 'bafkzcibcid')
  assert.deepEqual(seen.tags, { app: 'foc-album' })
  // The copy is what players read; the refactor kept it word for word.
  assert.deepEqual(stages, ['uploading to your data set', 'stored by your provider', 'submitted on-chain', 'confirmed'])
})

test('upload rejects when the storage context fails before AddPieces', async () => {
  const ctx = { upload: () => Promise.reject(new Error('provider down')) }
  await assert.rejects(upload(ctx, new Uint8Array(1), null, {}, SPONSORED), /provider down/)
})
