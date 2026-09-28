import assert from 'node:assert/strict'
import { test } from 'node:test'
import { APP, foldAlbum, usablePhoto } from './fold.js'

const ROOT = '100'
const ID = 'a1b2c3d4'
const base = { v: 2, app: APP, album: ID }
const album = (src, pieceId, title, token = 'owner') => ({ ...base, type: 'album', title, src, pieceId: String(pieceId), token, ref: `album-${src}-${pieceId}` })
const photo = (src, pieceId, token, extra = {}) => ({
  ...base, type: 'photo', blob: `bafkzcib${src}x${pieceId}`, thumb: 'AAAA', w: 4, h: 3, src, pieceId: String(pieceId), token, ref: `photo-${src}-${pieceId}`, ...extra,
})
const remove = (src, pieceId, token, target) => ({ ...base, type: 'remove', target, src, pieceId: String(pieceId), token, ref: `rm-${src}-${pieceId}` })

test('an album exists once its creation piece is in the root data set; the lowest piece id there names it', () => {
  const s = foldAlbum({ root: ROOT, id: ID }, [album(ROOT, 7, 'second'), album(ROOT, 3, 'EthDenver 2026')])
  assert.equal(s.exists, true)
  assert.equal(s.title, 'EthDenver 2026')
  assert.equal(s.ignored, 1)
})

test('a creation piece outside the root data set does not create or rename the album', () => {
  const s = foldAlbum({ root: ROOT, id: ID }, [album('200', 1, 'hijack')])
  assert.equal(s.exists, false)
  assert.equal(s.title, null)
})

test('photos from any member count, grouped by data set and in piece id order within one', () => {
  const s = foldAlbum({ root: ROOT, id: ID }, [album(ROOT, 1, 't'), photo('300', 9, 'c'), photo('200', 5, 'b'), photo('300', 2, 'c'), photo(ROOT, 4, 'owner')])
  assert.deepEqual(s.photos.map((p) => `${p.src}:${p.pieceId}`), ['100:4', '200:5', '300:2', '300:9'])
})

test('pieces for another album, another app, or malformed photos are left out', () => {
  const s = foldAlbum({ root: ROOT, id: ID }, [
    album(ROOT, 1, 't'),
    photo('200', 1, 'b', { album: 'other' }),
    { ...photo('200', 2, 'b'), app: 'foc-chat' },
    photo('200', 3, 'b', { blob: 'not-a-cid' }),
    photo('200', 4, 'b', { w: 0 }),
    photo('200', 5, 'b', { thumb: 'has spaces' }),
    photo('200', 6, 'b', { caption: 'x'.repeat(201) }),
    photo('200', 7, 'b', { caption: 'fine' }),
  ])
  assert.deepEqual(s.photos.map((p) => p.pieceId), ['7'])
})

test('a photo is removed by its author or by the owner, never by another member', () => {
  const pieces = [
    album(ROOT, 1, 't'),
    photo('200', 1, 'bob'), photo('200', 2, 'bob'), photo('200', 3, 'bob'),
    remove('200', 4, 'bob', 'photo-200-1'), // author
    remove(ROOT, 5, 'owner-laptop', 'photo-200-2'), // owner, any identity in root
    remove('300', 1, 'eve', 'photo-200-3'), // another member: ignored
    remove('200', 6, 'mallory', 'photo-200-3'), // same data set, different identity: ignored
  ]
  assert.deepEqual(foldAlbum({ root: ROOT, id: ID }, pieces).photos.map((p) => p.pieceId), ['3'])
})

test('a removal counts whether it arrives before or after its photo', () => {
  const pieces = [remove('200', 1, 'bob', 'photo-200-2'), album(ROOT, 1, 't'), photo('200', 2, 'bob')]
  assert.deepEqual(foldAlbum({ root: ROOT, id: ID }, pieces).photos, [])
  assert.deepEqual(foldAlbum({ root: ROOT, id: ID }, [...pieces].reverse()).photos, [])
})

test('usablePhoto requires a PieceCID, a base64url thumbnail, and positive integer size', () => {
  assert.equal(usablePhoto(photo('200', 1, 'b'), ID), true)
  assert.equal(usablePhoto(photo('200', 1, 'b', { h: 2.5 }), ID), false)
  assert.equal(usablePhoto(photo('200', 1, 'b', { thumb: 'x'.repeat(96 * 1024 + 1) }), ID), false)
})
