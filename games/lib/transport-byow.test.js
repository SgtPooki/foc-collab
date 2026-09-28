import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OWN, SPONSORED, upload } from './transport-byow.js'

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
