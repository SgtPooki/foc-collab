/**
 * Deterministic SVG corgi. Traits come from the owner's address bytes, so a
 * park corgi is verifiably unique to its adopter with no art pipeline. The
 * mascot uses the payer address the same way. Pure: string in, string out.
 */

import { traitsOf as sharedTraits } from './traits.js'

/** 2D view of the shared trait sheet (traits.js). */
export function traitsOf(address) {
  const t = sharedTraits(address)
  return {
    coat: { name: t.coat.name, body: t.coat.body, light: t.coat.light },
    accessory: t.accessory,
    collar: t.accent,
    scale: t.size,
    earTilt: t.ears.tilt,
    blaze: t.pattern === 'blaze' ? 2 : 0,
    tempo: 2.4 / t.tempo, // seconds per bounce
  }
}

function eyes(life, mood) {
  if (life === 'dead') return '<path d="M56 46 l6 6 M62 46 l-6 6 M76 46 l6 6 M82 46 l-6 6" stroke="#2b2b2b" stroke-width="2.4" stroke-linecap="round"/>'
  if (life === 'critical') return '<path d="M54 50 q5 -4 10 0 M74 50 q5 -4 10 0" stroke="#2b2b2b" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
  if (mood === 'lonely' || life === 'sick') {
    return '<circle cx="59" cy="49" r="3.2" fill="#2b2b2b"/><circle cx="79" cy="49" r="3.2" fill="#2b2b2b"/><path d="M53 43 l10 3 M85 43 l-10 3" stroke="#2b2b2b" stroke-width="2" stroke-linecap="round"/>'
  }
  if (mood === 'ecstatic') return '<path d="M54 50 q5 -6 10 0 M74 50 q5 -6 10 0" stroke="#2b2b2b" stroke-width="2.6" fill="none" stroke-linecap="round"/>'
  return '<circle cx="59" cy="49" r="3.4" fill="#2b2b2b"/><circle cx="79" cy="49" r="3.4" fill="#2b2b2b"/><circle cx="60.2" cy="47.8" r="1" fill="#fff"/><circle cx="80.2" cy="47.8" r="1" fill="#fff"/>'
}

function mouth(life, mood) {
  if (life === 'dead') return '<path d="M63 64 q6 -4 12 0" stroke="#2b2b2b" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
  if (life === 'critical' || life === 'sick' || mood === 'lonely') return '<path d="M63 65 q6 -3 12 0" stroke="#2b2b2b" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
  if (mood === 'ecstatic' || mood === 'happy') {
    return '<path d="M61 62 q8 8 16 0" stroke="#2b2b2b" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M66 66 q3 5 6 0" fill="#e07a8a"/>'
  }
  return '<path d="M63 62 q6 4 12 0" stroke="#2b2b2b" stroke-width="2.2" fill="none" stroke-linecap="round"/>'
}

function accessory(t) {
  const c = t.collar
  if (t.accessory === 'collar') return `<path d="M52 74 q17 10 34 0" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round"/><circle cx="69" cy="80" r="3" fill="#f2c94c"/>`
  if (t.accessory === 'bandana') return `<path d="M50 72 q19 12 38 0 l-14 16 z" fill="${c}"/>`
  if (t.accessory === 'bow') return `<path d="M42 22 l8 5 -8 5 z M58 22 l-8 5 8 5 z" fill="${c}"/><circle cx="50" cy="27" r="2.2" fill="#fff"/>`
  if (t.accessory === 'glasses') return `<circle cx="59" cy="49" r="7" stroke="#2b2b2b" stroke-width="1.8" fill="none"/><circle cx="79" cy="49" r="7" stroke="#2b2b2b" stroke-width="1.8" fill="none"/><path d="M66 49 h6" stroke="#2b2b2b" stroke-width="1.8"/>`
  if (t.accessory === 'hat') return `<path d="M56 24 h26 l-3 -12 h-20 z" fill="${c}"/><rect x="52" y="23" width="34" height="3" rx="1.5" fill="${c}"/>`
  return ''
}

function blaze(t) {
  if (t.blaze === 0) return ''
  const w = t.blaze === 1 ? 5 : 9
  return `<path d="M${69 - w / 2} 30 h${w} l${w / 3} 34 h-${w * 1.6} z" fill="${t.coat.light}"/>`
}

/**
 * SVG markup for one corgi. `life` and `mood` pick the expression; the
 * viewBox is 0 0 140 120 so callers size it with CSS.
 */
export function corgiSvg(address, { life = 'fine', mood = 'content', title = '' } = {}) {
  const t = traitsOf(address)
  const dead = life === 'dead'
  const body = t.coat.body
  const light = t.coat.light
  const ear = (x, flip) => `<path transform="rotate(${flip ? -t.earTilt : t.earTilt} ${x} 34)" d="M${x - 9} 36 L${x} 8 L${x + 9} 36 z" fill="${body}"/><path transform="rotate(${flip ? -t.earTilt : t.earTilt} ${x} 34)" d="M${x - 4} 32 L${x} 16 L${x + 4} 32 z" fill="#f0b6b6"/>`
  const posture = dead ? 'transform="translate(0 8) scale(1 0.92)"' : ''
  const opacity = dead ? 'opacity="0.78"' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 120" role="img" aria-label="${title || `${t.coat.name} corgi, ${life}, ${mood}`}" data-coat="${t.coat.name}" data-accessory="${t.accessory}">
  <g ${posture} ${opacity} style="transform-origin:70px 100px">
    <ellipse cx="70" cy="110" rx="40" ry="5" fill="rgba(0,0,0,0.12)"/>
    <rect x="46" y="86" width="9" height="20" rx="4" fill="${body}"/>
    <rect x="85" y="86" width="9" height="20" rx="4" fill="${body}"/>
    <rect x="46" y="98" width="9" height="8" rx="3" fill="${light}"/>
    <rect x="85" y="98" width="9" height="8" rx="3" fill="${light}"/>
    <path d="M100 82 q14 -8 12 -20 q-6 8 -14 12 z" fill="${body}"/>
    <ellipse cx="70" cy="84" rx="34" ry="22" fill="${body}"/>
    <ellipse cx="70" cy="92" rx="24" ry="13" fill="${light}"/>
    ${ear(50, false)}${ear(88, true)}
    <circle cx="69" cy="48" r="26" fill="${body}"/>
    <path d="M52 52 q17 -8 34 0 l-3 18 q-14 8 -28 0 z" fill="${light}"/>
    ${blaze(t)}
    <ellipse cx="69" cy="58" rx="5" ry="3.6" fill="#2b2b2b"/>
    ${eyes(life, mood)}
    ${mouth(life, mood)}
    ${accessory(t)}
  </g>
</svg>`
}

export const SPRITE_STYLE_HINT = 'Set width via CSS; the SVG scales.'
