import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readExif } from './exif.js'

/**
 * A minimal JPEG whose APP1 carries a TIFF with IFD0 (Make, Model, Exif
 * and GPS pointers), an Exif IFD (DateTimeOriginal, LensModel) and a GPS
 * IFD, in the given byte order. Strings longer than 4 bytes and all
 * rationals live out of line, as in real files.
 */
function jpegWithExif({ little = false, gps = true } = {}) {
  const tiff = new Uint8Array(512)
  const v = new DataView(tiff.buffer)
  const u16 = (at, x) => v.setUint16(at, x, little)
  const u32 = (at, x) => v.setUint32(at, x, little)
  let data = 300 // out-of-line values go here
  const ascii = (s) => {
    const at = data
    tiff.set(new TextEncoder().encode(`${s}\0`), at)
    data += s.length + 1
    return { type: 2, n: s.length + 1, at }
  }
  const rationals = (pairs) => {
    const at = data
    pairs.forEach(([a, b], i) => { u32(at + i * 8, a); u32(at + i * 8 + 4, b) })
    data += pairs.length * 8
    return { type: 5, n: pairs.length, at }
  }
  const ifd = (offset, entries) => {
    u16(offset, entries.length)
    entries.forEach(([tag, val], i) => {
      const e = offset + 2 + i * 12
      u16(e, tag)
      if (val.inline != null) { // a LONG pointer or a short ASCII ref
        u16(e + 2, val.type)
        u32(e + 4, val.n)
        if (val.type === 4) u32(e + 8, val.inline)
        else tiff.set(new TextEncoder().encode(val.inline), e + 8)
        return
      }
      u16(e + 2, val.type)
      u32(e + 4, val.n)
      u32(e + 8, val.at)
    })
    u32(offset + 2 + entries.length * 12, 0)
  }
  tiff.set(new TextEncoder().encode(little ? 'II' : 'MM'))
  u16(2, 42)
  u32(4, 8)
  const ifd0 = [[0x010f, ascii('Apple')], [0x0110, ascii('Apple iPhone 15')], [0x8769, { type: 4, n: 1, inline: 100 }]]
  if (gps) ifd0.push([0x8825, { type: 4, n: 1, inline: 200 }])
  ifd(8, ifd0)
  ifd(100, [[0x9003, ascii('2026:09:28 14:05:09')], [0xa434, ascii('iPhone 15 back camera 6.1mm f/1.6')]])
  if (gps) {
    ifd(200, [
      [0x0001, { type: 2, n: 2, inline: 'N\0' }],
      [0x0002, rationals([[40, 1], [44, 1], [3000, 100]])], // 40°44'30.00"
      [0x0003, { type: 2, n: 2, inline: 'W\0' }],
      [0x0004, rationals([[73, 1], [59, 1], [3600, 100]])], // 73°59'36.00"
    ])
  }
  const app1Body = new Uint8Array([...new TextEncoder().encode('Exif\0\0'), ...tiff])
  const len = app1Body.length + 2
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1Body, 0xff, 0xda, 0, 2, 0xff, 0xd9])
}

for (const little of [false, true]) {
  test(`reads date, camera, lens, and location from a ${little ? 'little' : 'big'}-endian EXIF block`, () => {
    assert.deepEqual(readExif(jpegWithExif({ little })), {
      taken: '2026-09-28 14:05:09',
      camera: 'Apple iPhone 15', // Model already names the maker
      lens: 'iPhone 15 back camera 6.1mm f/1.6',
      gps: { lat: 40.741667, lon: -73.993333 }, // west is negative
    })
  })
}

test('a photo without GPS has no location, and nothing else changes', () => {
  const out = readExif(jpegWithExif({ gps: false }))
  assert.equal(out.gps, undefined)
  assert.equal(out.camera, 'Apple iPhone 15')
})

test('anything that is not a JPEG with EXIF gives no fields, never an exception', () => {
  assert.deepEqual(readExif(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), {}) // PNG
  assert.deepEqual(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2])), {}) // JPEG, no APP1
  assert.deepEqual(readExif(new Uint8Array(0)), {})
  const truncated = jpegWithExif().subarray(0, 60)
  assert.doesNotThrow(() => readExif(truncated))
})
