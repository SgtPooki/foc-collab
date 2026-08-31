/**
 * Player identity: a browser-generated ECDSA P-256 keypair. The public key
 * (base64url of the raw point) IS the player token that seats are assigned
 * to; the private key is non-extractable and lives in IndexedDB, so it
 * never leaves the player's browser — not even as bytes script can read. Every piece is
 * signed over a canonical serialization that includes the game id and the
 * token, so a log reader can neither forge pieces as another player nor
 * replay a signed piece into a different game. Verification is
 * deterministic, so every client drops exactly the same forgeries.
 *
 * Works in browsers and node (both expose WebCrypto as globalThis.crypto).
 */

const ALG = { name: 'ECDSA', namedCurve: 'P-256' }
const SIG = { name: 'ECDSA', hash: 'SHA-256' }
const subtle = globalThis.crypto.subtle

const toB64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const fromB64u = (s) => Uint8Array.from(
  atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))

/** Canonical serialization: JSON with recursively sorted object keys. */
export function canon(value) {
  if (Array.isArray(value)) return `[${value.map(canon).join(',')}]`
  if (value != null && typeof value === 'object') {
    const body = Object.keys(value).sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canon(value[k])}`)
    return `{${body.join(',')}}`
  }
  return JSON.stringify(value)
}

export async function generateIdentity() {
  // Non-extractable: the private key can sign but its material can never
  // be read back out by script (the public key is always exportable).
  const pair = await subtle.generateKey(ALG, false, ['sign', 'verify'])
  return {
    token: toB64u(await subtle.exportKey('raw', pair.publicKey)),
    privateKey: pair.privateKey,
  }
}

const DB = 'ttt-identity'
const STORE = 'keys'

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function openDb() {
  const request = indexedDB.open(DB, 1)
  request.onupgradeneeded = () => request.result.createObjectStore(STORE)
  return idbRequest(request)
}

/**
 * Loads (or creates and persists) this player's identity for a scope
 * ('shared' for real play; a per-tab id for the local demo). The whole
 * identity — non-extractable CryptoKey included — is stored in IndexedDB
 * via structured clone, so no key material ever exists as text.
 */
export async function loadIdentity(scope = 'shared') {
  const db = await openDb()
  const key = `identity:${scope}`
  const saved = await idbRequest(db.transaction(STORE).objectStore(STORE).get(key))
  if (saved?.privateKey != null && typeof saved?.token === 'string') return saved
  const identity = await generateIdentity()
  await idbRequest(db.transaction(STORE, 'readwrite').objectStore(STORE).put(identity, key))
  return identity
}

/** Returns the piece with `token` and `sig` attached. */
export async function signPiece(payload, identity) {
  const body = { ...payload, token: identity.token }
  const sig = await subtle.sign(SIG, identity.privateKey, new TextEncoder().encode(canon(body)))
  return { ...body, sig: toB64u(sig) }
}

/** True when the piece's signature verifies against its own token. */
export async function verifyPiece(piece) {
  if (piece == null || typeof piece !== 'object') return false
  const { sig, ...body } = piece
  if (typeof sig !== 'string' || typeof piece.token !== 'string') return false
  try {
    const publicKey = await subtle.importKey('raw', fromB64u(piece.token), ALG, false, ['verify'])
    return await subtle.verify(SIG, publicKey, fromB64u(sig), new TextEncoder().encode(canon(body)))
  } catch {
    return false
  }
}

/**
 * Maps forged/unsigned pieces to null (which the fold ignores) so the log
 * that reaches the fold contains only pieces provably authored by their
 * token. Runs between transport.list() and the fold; the fold stays pure.
 */
export async function verifyAll(pieces) {
  return Promise.all(pieces.map(async (p) => ((await verifyPiece(p)) ? p : null)))
}
