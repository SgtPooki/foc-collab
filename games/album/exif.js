/**
 * The few EXIF fields a shared album cares about, read from a JPEG's APP1
 * segment. Pure: bytes in, fields out; anything unexpected yields fewer
 * fields, never an exception. Other formats (HEIC, PNG) return {}.
 *
 * Returns { taken?, camera?, lens?, gps?: { lat, lon } }:
 *   taken   DateTimeOriginal as 'YYYY-MM-DD HH:MM:SS' (camera local time)
 *   camera  Make and Model ('Apple iPhone 15'), Model alone if it repeats Make
 *   lens    LensModel
 *   gps     decimal degrees, 6 places (about 10 cm)
 */
const IFD0 = { make: 0x010f, model: 0x0110, exif: 0x8769, gps: 0x8825 }
const EXIF = { taken: 0x9003, lens: 0xa434 }
const GPS = { latRef: 0x0001, lat: 0x0002, lonRef: 0x0003, lon: 0x0004 }
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

/** The TIFF block inside a JPEG's Exif APP1 segment, or null. */
function tiffOf(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 4 || view.getUint16(0) !== 0xffd8) return null
  let at = 2
  while (at + 4 <= bytes.length) {
    const marker = view.getUint16(at)
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null // start of scan: no EXIF ahead
    const length = view.getUint16(at + 2)
    const isExif = marker === 0xffe1 && length >= 8 && String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'Exif'
    if (isExif) return bytes.subarray(at + 10, at + 2 + length)
    at += 2 + length
  }
  return null
}

/** Reads IFD entries: Map<tag, value>, where value is a string, number, or number[]. */
function readIfd(tiff, view, little, offset) {
  const out = new Map()
  if (offset + 2 > tiff.length) return out
  const count = view.getUint16(offset, little)
  for (let i = 0; i < count; i++) {
    const entry = offset + 2 + i * 12
    if (entry + 12 > tiff.length) break
    const tag = view.getUint16(entry, little)
    const type = view.getUint16(entry + 2, little)
    const n = view.getUint32(entry + 4, little)
    const size = (TYPE_SIZE[type] ?? 0) * n
    if (size === 0) continue
    const at = size <= 4 ? entry + 8 : view.getUint32(entry + 8, little)
    if (at + size > tiff.length) continue
    out.set(tag, readValue(tiff, view, little, type, n, at))
  }
  return out
}

function readValue(tiff, view, little, type, n, at) {
  if (type === 2) return new TextDecoder().decode(tiff.subarray(at, at + n)).replace(/\0.*$/s, '').trim()
  const values = []
  for (let i = 0; i < n; i++) {
    if (type === 3) values.push(view.getUint16(at + i * 2, little))
    else if (type === 4) values.push(view.getUint32(at + i * 4, little))
    else if (type === 5) {
      const den = view.getUint32(at + i * 8 + 4, little)
      values.push(den === 0 ? 0 : view.getUint32(at + i * 8, little) / den)
    }
  }
  return n === 1 ? values[0] : values
}

function degrees(dms, ref) {
  if (!Array.isArray(dms) || dms.length !== 3 || dms.some((v) => !Number.isFinite(v))) return null
  const value = dms[0] + dms[1] / 60 + dms[2] / 3600
  const signed = ref === 'S' || ref === 'W' ? -value : value
  return Math.round(signed * 1e6) / 1e6
}

export function readExif(bytes) {
  const tiff = tiffOf(bytes)
  if (tiff == null || tiff.length < 8) return {}
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength)
  const order = view.getUint16(0)
  if (order !== 0x4949 && order !== 0x4d4d) return {}
  const little = order === 0x4949
  const ifd0 = readIfd(tiff, view, little, view.getUint32(4, little))
  const exif = typeof ifd0.get(IFD0.exif) === 'number' ? readIfd(tiff, view, little, ifd0.get(IFD0.exif)) : new Map()
  const gpsIfd = typeof ifd0.get(IFD0.gps) === 'number' ? readIfd(tiff, view, little, ifd0.get(IFD0.gps)) : new Map()

  const out = {}
  const taken = exif.get(EXIF.taken)
  if (typeof taken === 'string' && /^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(taken)) out.taken = taken.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
  const make = typeof ifd0.get(IFD0.make) === 'string' ? ifd0.get(IFD0.make) : ''
  const model = typeof ifd0.get(IFD0.model) === 'string' ? ifd0.get(IFD0.model) : ''
  const camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`.trim()
  if (camera !== '') out.camera = camera.slice(0, 80)
  const lens = exif.get(EXIF.lens)
  if (typeof lens === 'string' && lens !== '') out.lens = lens.slice(0, 80)
  const lat = degrees(gpsIfd.get(GPS.lat), gpsIfd.get(GPS.latRef))
  const lon = degrees(gpsIfd.get(GPS.lon), gpsIfd.get(GPS.lonRef))
  if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) out.gps = { lat, lon }
  return out
}
