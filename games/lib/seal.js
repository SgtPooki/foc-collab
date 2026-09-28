/**
 * The encryption seam: every encrypted byte the album writes or reads
 * goes through here, as a Filecoin Encryption Envelope (FEE, FIPs
 * discussion #1253): a COSE envelope, then AES-256-GCM ciphertext.
 *
 * seal(bytes, kek) makes a fresh content key (CEK) per object, encrypts
 * with it, and stores the CEK in the envelope wrapped under `kek` with
 * A256KW (COSE alg -5), the one recipient kind FEE v1 supports. The kek
 * is the album key; whoever holds it opens every object sealed to it,
 * including ones sealed before they got it.
 *
 * Backed by the vendored reference implementation (vendor/foc-encryption)
 * until FilOzone/synapse-sdk ships `@filoz/filecoin-encryption-envelope`
 * with AEAD (#967 is the wire format only). The swap happens in this file
 * alone. Blobs sealed before it will not open after it: the vendored
 * library predates the FIP amendments #967 adopts.
 *
 * Scheme 1 only (whole-object AES-GCM, 64 MiB cap): the browser buffers
 * a photo anyway (the encryption PRD rules out in-browser streaming).
 * Chunked range reads arrive with the production library.
 *
 * Decryption proves possession of the key and nothing more (FEE spec):
 * who wrote a sealed object is the signed plaintext's job, checked after
 * open() and before the fold.
 */
import { feeDecrypt, feeEncrypt, feeParse } from './foc-deps.js'

const A256KW = -5
const AES_GCM = 3

function key32(k, what) {
  if (!(k instanceof Uint8Array) || k.length !== 32) throw new Error(`${what} must be 32 bytes`)
}

/** A256KW (RFC 3394) wraps a 32-byte key under a 32-byte kek: 40 bytes out. */
export async function wrapKey(kek, key) {
  key32(kek, 'kek')
  key32(key, 'key')
  const wrapper = await crypto.subtle.importKey('raw', kek, 'AES-KW', false, ['wrapKey'])
  const inner = await crypto.subtle.importKey('raw', key, 'AES-GCM', true, ['encrypt'])
  return new Uint8Array(await crypto.subtle.wrapKey('raw', inner, wrapper, 'AES-KW'))
}

/** Inverse of wrapKey. Throws when kek is wrong: key wrap checks its own integrity. */
export async function unwrapKey(kek, wrapped) {
  key32(kek, 'kek')
  const wrapper = await crypto.subtle.importKey('raw', kek, 'AES-KW', false, ['unwrapKey'])
  const inner = await crypto.subtle.unwrapKey('raw', wrapped, wrapper, 'AES-KW', 'AES-GCM', true, ['encrypt'])
  return new Uint8Array(await crypto.subtle.exportKey('raw', inner))
}

/** Encrypts `bytes` to whoever holds `kek`; returns the FEE blob (envelope ‖ ciphertext). */
export async function seal(bytes, kek) {
  const cek = crypto.getRandomValues(new Uint8Array(32))
  try {
    const wrappedKey = await wrapKey(kek, cek)
    return await feeEncrypt(bytes, cek, { algorithm: AES_GCM }, [{ algorithm: A256KW, wrappedKey }])
  } finally {
    cek.fill(0) // the library zeroes only its own copy
  }
}

/** Decrypts a FEE blob with `kek`; throws on a wrong key, tampering, or anything not sealed this way. */
export async function open(blob, kek) {
  const envelope = feeParse(blob)
  for (const r of envelope.recipients) {
    if (r.algorithm !== A256KW || r.wrappedKey == null) continue
    let cek
    try {
      cek = await unwrapKey(kek, r.wrappedKey)
    } catch {
      continue // wrapped for some other kek
    }
    try {
      return await feeDecrypt(blob, cek)
    } finally {
      cek.fill(0)
    }
  }
  throw new Error('no recipient opens with this key')
}
