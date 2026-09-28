import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cachedFetch, idbBodyStore, memoryBodyStore } from './piece-cache.js'

test('a body store returns what was put, including null and refused-cap markers', async () => {
  const store = memoryBodyStore()
  await store.put('a', { v: 2 })
  await store.put('b', null)
  await store.put('c', 8192)
  assert.deepEqual([...await store.all()], [['a', { v: 2 }], ['b', null], ['c', 8192]])
})

test('with no IndexedDB (node, or blocked), the body store still works, in memory', async () => {
  const store = idbBodyStore(undefined)
  await store.put('a', { v: 2 })
  assert.deepEqual([...await store.all()], [['a', { v: 2 }]])
})

test('an IndexedDB that refuses to open falls back to memory instead of failing', async () => {
  const refusing = {
    open() {
      const request = {}
      queueMicrotask(() => {
        request.error = new Error('blocked')
        request.onerror()
      })
      return request
    },
  }
  const store = idbBodyStore(refusing)
  await store.put('a', 1)
  assert.deepEqual([...await store.all()], [['a', 1]])
})

// A Cache API stand-in: one named cache, Map-backed.
function fakeCaches({ failPut = false } = {}) {
  const entries = new Map()
  return {
    entries,
    async open() {
      return {
        async match(url) {
          return entries.has(url) ? new Response(entries.get(url)) : undefined
        },
        async put(url, response) {
          if (failPut) throw new Error('QuotaExceededError')
          entries.set(url, new Uint8Array(await response.arrayBuffer()))
        },
      }
    },
  }
}

test('cachedFetch downloads once, then serves the same bytes from the cache', async () => {
  const caches = fakeCaches()
  let fetches = 0
  const fetchBytes = async () => {
    fetches++
    return new Uint8Array([1, 2, 3])
  }
  assert.deepEqual(await cachedFetch('https://sp/piece/x', fetchBytes, caches), new Uint8Array([1, 2, 3]))
  assert.deepEqual(await cachedFetch('https://sp/piece/x', fetchBytes, caches), new Uint8Array([1, 2, 3]))
  assert.equal(fetches, 1)
})

test('cachedFetch still returns the bytes when the cache is full or missing', async () => {
  const fetchBytes = async () => new Uint8Array([9])
  assert.deepEqual(await cachedFetch('https://sp/piece/y', fetchBytes, fakeCaches({ failPut: true })), new Uint8Array([9]))
  assert.deepEqual(await cachedFetch('https://sp/piece/y', fetchBytes, undefined), new Uint8Array([9]))
})

test('cachedFetch passes fetch failures through (oversized pieces are not cached)', async () => {
  const caches = fakeCaches()
  await assert.rejects(cachedFetch('https://sp/piece/z', async () => {
    throw new Error('oversized piece')
  }, caches), /oversized/)
  assert.equal(caches.entries.size, 0)
})
