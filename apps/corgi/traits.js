/**
 * Corgi traits from an address. Pure and deterministic: the same address
 * always yields the same corgi, and 20 address bytes give a wide space of
 * coats, patterns, builds, accessories, and personalities. Shared by the
 * 3D playground and the 2D fallback sprites.
 */

const COATS = [
  { name: 'red', body: '#d9823b', dark: '#a8551c' },
  { name: 'fawn', body: '#e0a25f', dark: '#b9783c' },
  { name: 'sable', body: '#a35f2a', dark: '#5d3312' },
  { name: 'black', body: '#2f2a28', dark: '#151212' },
  { name: 'cream', body: '#e9c79a', dark: '#c9a170' },
  { name: 'ginger', body: '#c9652c', dark: '#8f3f14' },
  { name: 'blue merle', body: '#9aa3ad', dark: '#3f4750' },
  { name: 'chocolate', body: '#6b4226', dark: '#3d2313' },
  { name: 'white', body: '#f4efe6', dark: '#d9cfbf' },
  { name: 'brindle', body: '#a97a45', dark: '#4f341a' },
]
const PATTERNS = ['solid', 'saddle', 'tricolor', 'merle', 'eyepatch', 'mask', 'blaze']
const TAILS = ['nub', 'fluffy', 'curled']
const ACCESSORIES = ['none', 'none', 'collar', 'bandana', 'bow', 'glasses', 'hat', 'scarf', 'backpack', 'flower']
// rare pulls: about 1 in 85 addresses wears the crown, 1 in 128 has odd eyes
const CROWN_ODDS = 3
const ODD_EYES_ODDS = 2
const ACCENTS = ['#2b6cb0', '#c53030', '#2f855a', '#6b46c1', '#b7791f', '#d53f8c', '#0f766e', '#f59e0b']
const EYES = ['#2b2b2b', '#5b3a1a', '#b7791f', '#3b82f6']
const PERSONALITIES = ['energetic', 'lazy', 'curious', 'social', 'goofy']
const TEMPO = { energetic: 1.35, lazy: 0.7, curious: 1, social: 1.05, goofy: 1.15 }

function bytesOf(address) {
  const hex = String(address ?? '').replace(/^0x/i, '').padEnd(40, '0')
  const out = []
  for (let i = 0; i < 20; i++) out.push(Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0)
  return out
}

function unit(byte) {
  return byte / 255
}

function shiftHex(hex, dl) {
  // lighten (dl > 0) or darken (dl < 0) a hex colour by a fraction
  const n = Number.parseInt(hex.slice(1), 16)
  const ch = (shift) => {
    const v = (n >> shift) & 255
    const out = dl > 0 ? v + (255 - v) * dl : v * (1 + dl)
    return Math.max(0, Math.min(255, Math.round(out)))
  }
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Full trait sheet for an address. */
export function traitsOf(address) {
  const b = bytesOf(address)
  const coat = COATS[b[0] % COATS.length]
  const jitter = (unit(b[1]) - 0.5) * 0.16 // subtle per-corgi coat variation
  const pattern = coat.name === 'blue merle' ? 'merle' : PATTERNS[b[2] % PATTERNS.length]
  const personality = PERSONALITIES[b[12] % PERSONALITIES.length]
  return {
    coat: { name: coat.name, body: shiftHex(coat.body, jitter), dark: shiftHex(coat.dark, jitter), light: shiftHex(coat.body, 0.75) },
    pattern,
    socks: b[3] % 5, // 0..4 white legs
    bib: b[4] % 3 !== 0, // white chest most of the time
    size: 0.8 + unit(b[5]) * 0.45, // 0.8 .. 1.25
    fluff: 0.9 + unit(b[6]) * 0.3, // body roundness
    ears: { size: 0.85 + unit(b[7]) * 0.45, tilt: (unit(b[8]) - 0.5) * 30, floppy: b[8] % 7 === 0 },
    tail: TAILS[b[9] % TAILS.length],
    length: 0.6 + unit(b[10]) * 0.3, // torso length; legs are always short
    accessory: b[16] < CROWN_ODDS ? 'crown' : ACCESSORIES[b[11] % ACCESSORIES.length],
    accent: ACCENTS[b[13] % ACCENTS.length],
    eyes: coat.name === 'blue merle' && b[14] % 2 === 0 ? EYES[3] : EYES[b[14] % 3],
    oddEye: b[15] < ODD_EYES_ODDS ? EYES[(b[14] + 2) % EYES.length] : null,
    personality,
    tempo: TEMPO[personality],
    seed: b.reduce((acc, v, i) => (acc * 31 + v + i) >>> 0, 7),
  }
}

/** Rarity label for the collectors: 'rare' for crown or odd eyes, else null. */
export function rarityOf(t) {
  if (t.accessory === 'crown' && t.oddEye) return 'legendary'
  if (t.accessory === 'crown' || t.oddEye) return 'rare'
  return null
}

/** Short human description, e.g. "fluffy sable corgi with a bandana". */
export function describe(t) {
  const bits = []
  if (t.fluff > 1.1) bits.push('fluffy')
  if (t.size < 0.9) bits.push('small')
  if (t.size > 1.15) bits.push('big')
  bits.push(t.pattern === 'solid' ? t.coat.name : `${t.pattern} ${t.coat.name}`)
  let s = `${bits.join(' ')} corgi`
  if (t.accessory !== 'none') s += ` with a ${t.accessory}`
  if (t.oddEye) s += ', odd eyes'
  return `${s}, ${t.personality}`
}
