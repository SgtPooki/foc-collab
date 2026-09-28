import assert from 'node:assert/strict'
import { test } from 'node:test'
import { APP, foldAlbum, foldMembers, usableMeta, usablePhoto } from './fold.js'

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

test('kept metadata rides along with its photo', () => {
  const meta = { taken: '2026-09-28 14:05:09', camera: 'Apple iPhone 15', gps: { lat: 40.741667, lon: -73.993333 } }
  const [p] = foldAlbum({ root: ROOT, id: ID }, [album(ROOT, 1, 't'), photo('200', 1, 'b', { meta })]).photos
  assert.deepEqual(p.meta, meta)
})

test('usableMeta accepts only known, well-formed fields; a photo with bad metadata is left out', () => {
  assert.equal(usableMeta(undefined), true)
  assert.equal(usableMeta({}), true)
  assert.equal(usableMeta({ lens: 'x' }), true)
  assert.equal(usableMeta({ serial: '123' }), false) // unknown field
  assert.equal(usableMeta({ taken: '2026:09:28 14:05:09' }), false) // raw EXIF format, not normalized
  assert.equal(usableMeta({ gps: { lat: 91, lon: 0 } }), false)
  assert.equal(usableMeta({ gps: { lat: 1, lon: 2, alt: 3 } }), false)
  assert.equal(usableMeta({ camera: 'x'.repeat(81) }), false)
  assert.equal(usableMeta(null), false)
  assert.deepEqual(foldAlbum({ root: ROOT, id: ID }, [album(ROOT, 1, 't'), photo('200', 1, 'b', { meta: { gps: 'here' } })]).photos, [])
})

// ---------------------------------------------------------------- members
const BOB = '0x00000000000000000000000000000000000000b0'
const EVE = '0x00000000000000000000000000000000000000e0'
const KEY = 'k'.repeat(43)
const join = (src, pieceId, wallet, extra = {}) => ({ ...base, type: 'join', ds: src, wallet, enc: KEY, walletOk: true, src, pieceId: String(pieceId), ...extra })
const keys = (pieceId, epoch, entries, revoke, src = ROOT) => ({ ...base, type: 'keys', epoch, entries: entries.map((to) => ({ to, epk: KEY, box: 'Ym94' })), ...(revoke ? { revoke } : {}), src, pieceId: String(pieceId) })

test('a join is a request until the owner grants it; a grant makes a member whose data set counts', () => {
  const asked = foldMembers({ root: ROOT, id: ID }, [join('200', 1, BOB)])
  assert.deepEqual(asked.requests, [{ wallet: BOB, enc: KEY, src: '200' }])
  assert.deepEqual([...asked.memberSrcs], [ROOT])
  const granted = foldMembers({ root: ROOT, id: ID }, [join('200', 1, BOB), keys(2, 0, [BOB])])
  assert.deepEqual(granted.members, [BOB])
  assert.deepEqual(granted.requests, [])
  assert.deepEqual([...granted.memberSrcs].sort(), [ROOT, '200'])
  assert.equal(granted.grants.get(BOB).epoch, 0)
  assert.equal(granted.encOf.get(BOB), KEY)
})

test('removal moves the epoch on, drops the member\'s data set, and a later grant brings them back', () => {
  const removed = foldMembers({ root: ROOT, id: ID }, [join('200', 1, BOB), keys(2, 0, [BOB]), keys(3, 1, [], [BOB])])
  assert.equal(removed.epoch, 1)
  assert.deepEqual(removed.members, [])
  assert.deepEqual(removed.removed, [BOB])
  assert.equal(removed.grants.has(BOB), false)
  assert.deepEqual([...removed.memberSrcs], [ROOT])
  assert.deepEqual(removed.requests, []) // an old join is not a new request
  const back = foldMembers({ root: ROOT, id: ID }, [join('200', 1, BOB), keys(2, 0, [BOB]), keys(3, 1, [], [BOB]), keys(4, 1, [BOB])])
  assert.deepEqual(back.members, [BOB])
})

test('keys pieces count only in root, only in piece id order, and never move the epoch back', () => {
  const s = foldMembers({ root: ROOT, id: ID }, [
    join('200', 1, BOB), join('300', 1, EVE),
    keys(5, 2, [BOB]),
    keys(9, 1, [EVE]), // later piece, older epoch: ignored
    keys(1, 0, [EVE], undefined, '300'), // not in root: ignored
  ])
  assert.equal(s.epoch, 2)
  assert.deepEqual(s.members, [BOB])
})

test('a join counts only if the wallet signed it and it names the data set it sits in', () => {
  const s = foldMembers({ root: ROOT, id: ID }, [
    join('200', 1, BOB, { walletOk: false }),
    join('300', 1, EVE, { ds: '200' }), // copied from another data set
  ])
  assert.deepEqual(s.requests, [])
})

test('a copy of a member\'s join does not make a removed member\'s data set count', () => {
  const s = foldMembers({ root: ROOT, id: ID }, [
    join('200', 1, BOB), keys(2, 0, [BOB]),
    join('666', 1, BOB, { ds: '200' }), // Eve's data set, Bob's join copied in
  ])
  assert.deepEqual([...s.memberSrcs].sort(), [ROOT, '200'])
})

test('in a members-only album only the owner\'s and members\' data sets count', () => {
  const pieces = [album(ROOT, 1, 't'), photo(ROOT, 2, 'owner'), photo('200', 3, 'bob'), photo('300', 4, 'eve')]
  const s = foldAlbum({ root: ROOT, id: ID }, pieces, { onlySrcs: new Set([ROOT, '200']) })
  assert.deepEqual(s.photos.map((p) => p.src), [ROOT, '200'])
})
