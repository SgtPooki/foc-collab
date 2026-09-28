/**
 * Album keys, shaped after Keysmith (the proposed FOC key layer, a child
 * of the "Retrieval ACL and encryption v1" PRD) so the swap is a
 * replacement, not a redesign.
 *
 * - The album key (AK) is 32 random bytes. The owner's wallet unlocks it:
 *   a typed-data signature over a per-album nonce yields a key-encryption
 *   key (KEK), and the album piece carries nonce + A256KW(KEK, AK), which
 *   is public. The wallet alone recovers AK on any device; nothing else
 *   needs backing up. Keysmith keeps the same wrapped root in data set
 *   metadata; ours rides in a piece, because the owner's data set already
 *   exists and its metadata is write-once.
 * - A member's X25519 key comes from their own wallet (a signature over a
 *   fixed message), so hardware wallets only ever sign.
 * - A grant is AK wrapped to a member's X25519 public key: ephemeral ECDH,
 *   HKDF, A256KW (ECDH-ES+A256KW in spirit). Written here because FEE
 *   defers `-31`; replace with the library's recipient when it lands.
 * - The discovery tag is HMAC(AK), so outsiders cannot find an album's
 *   contributors by tag.
 *
 * `sign(typedData)` is the wallet: it signs EIP-712 typed data and
 * returns the 65-byte hex signature. `providerSigner` adapts an EIP-1193
 * provider; in node, viem's `account.signTypedData` fits as is.
 *
 * Signatures feed key derivation, so they must be reproducible. EOA
 * wallets (MetaMask, Rabby, Frame, Ledger, Trezor, viem/ethers signers)
 * sign deterministically (RFC 6979); MPC/threshold wallets may not, and
 * smart accounts and passkey wallets return signatures that are not
 * stable at all. So, as Keysmith and swarm-id do:
 * - providerSigner refuses a contract account (code at the address) before
 *   the first prompt;
 * - keys use r ‖ low-s (never v, which wallets report variously);
 * - a new derivation signs twice and compares: new albums, and a member's
 *   first key. After that the member's published public key is the
 *   commitment: one prompt, re-derive, compare, and fail loudly on drift;
 * - the album key is random and wrapped (A256KW checks its integrity), so
 *   a drifted owner signature fails at unwrap instead of making a new key.
 */
import { calibration, secp256k1, x25519 } from './foc-deps.js'
import { fromB64u, toB64u } from './identity.js'
import { unwrapKey, wrapKey } from './seal.js'

const DOMAIN = { name: 'foc-collab album', version: '1' } // fixed forever: no chainId, no contract
const DOMAIN_TYPES = [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }] // what eth_signTypedData_v4 needs spelled out
const enc = (s) => new TextEncoder().encode(s)
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (h) => Uint8Array.from(h.replace(/^0x/, '').match(/../g) ?? [], (b) => parseInt(b, 16))
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

async function hkdf(ikm, salt, info) {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: enc(info) }, base, 256))
}

/** r ‖ low-s of a 65-byte signature: the same bytes whichever of the two valid s a wallet returned. */
function signatureSecret(sigHex) {
  const sig = fromHex(sigHex)
  if (sig.length !== 65) throw new Error('expected a 65-byte signature')
  return secp256k1.Signature.fromCompact(sig.subarray(0, 64)).normalizeS().toCompactRawBytes()
}

async function derive(sign, typedData, label, { check = false } = {}) {
  const first = signatureSecret(await sign(typedData))
  if (check && hex(signatureSecret(await sign(typedData))) !== hex(first)) {
    throw new Error('this wallet signs the same message differently each time, so it cannot hold a key; try another wallet')
  }
  return hkdf(first, new Uint8Array(0), label)
}

function albumKeyTypedData(nonceHex) {
  return {
    domain: DOMAIN,
    types: { AlbumKey: [{ name: 'purpose', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'nonce', type: 'bytes16' }] },
    primaryType: 'AlbumKey',
    message: { purpose: 'foc-collab/album/v1', chainId: calibration.id, nonce: nonceHex },
  }
}

function encryptionKeyTypedData() {
  return {
    domain: DOMAIN,
    types: { EncryptionKey: [{ name: 'purpose', type: 'string' }] },
    primaryType: 'EncryptionKey',
    message: { purpose: 'foc-collab/encryption/v1' },
  }
}

/** A new album: { ak, lock }. `lock` is public and goes in the album piece. Two wallet prompts (determinism check). */
export async function newAlbumKey(sign) {
  const nonce = `0x${hex(crypto.getRandomValues(new Uint8Array(16)))}`
  const kek = await derive(sign, albumKeyTypedData(nonce), 'foc-collab/album-kek/v1', { check: true })
  const ak = crypto.getRandomValues(new Uint8Array(32))
  return { ak, lock: { nonce, wrapped: toB64u(await wrapKey(kek, ak)) } }
}

/** The owner's way back to AK from a lock, with one wallet prompt. Throws for any other wallet. */
export async function openAlbumKey(sign, lock) {
  if (!/^0x[0-9a-f]{32}$/.test(lock?.nonce ?? '')) throw new Error('not an album lock: nonce must be 16 bytes of hex')
  const kek = await derive(sign, albumKeyTypedData(lock.nonce), 'foc-collab/album-kek/v1')
  try {
    return await unwrapKey(kek, fromB64u(lock.wrapped))
  } catch {
    throw new Error('this wallet did not create this album')
  }
}

/**
 * This wallet's X25519 pair: { privateKey, publicKey } (32 bytes each).
 * `published` is the base64url public key this wallet already posted (its
 * join piece), or null on first use. First use signs twice and compares;
 * later uses sign once and must reproduce `published`, else this throws
 * and the caller must not post a second key.
 */
export async function encryptionKeyPair(sign, { published = null } = {}) {
  const privateKey = await derive(sign, encryptionKeyTypedData(), 'foc-collab/encryption/v1', { check: published == null })
  const publicKey = x25519.getPublicKey(privateKey)
  if (published != null && toB64u(publicKey) !== published) {
    throw new Error('this wallet no longer reproduces the encryption key it published, so grants to that key cannot be opened here; was it restored into different wallet software?')
  }
  return { privateKey, publicKey }
}

// The album id is bound into the KEK, so a grant cannot be replayed as a grant to another album.
// noble rejects a low-order public key (its shared secret would be all zeros, known to anyone).
function grantKek(privateKey, publicKey, epk, recipient, albumId) {
  let shared
  try {
    shared = x25519.getSharedSecret(privateKey, publicKey)
  } catch (err) {
    throw new Error(`not a usable encryption key: ${err.message}`)
  }
  return hkdf(shared, concat(epk, recipient), `foc-collab/grant/v1:${albumId}`)
}

/** AK wrapped to a member's X25519 public key: { epk, wrapped }, both base64url, safe to publish. */
export async function grantTo(ak, recipientPublicKey, albumId) {
  const e = x25519.utils.randomPrivateKey()
  const epk = x25519.getPublicKey(e)
  const kek = await grantKek(e, recipientPublicKey, epk, recipientPublicKey, albumId)
  return { epk: toB64u(epk), wrapped: toB64u(await wrapKey(kek, ak)) }
}

/** The member's side of grantTo. Throws when the grant is for someone else or another album. */
export async function openGrant(privateKey, grant, albumId) {
  const epk = fromB64u(grant.epk)
  const kek = await grantKek(privateKey, epk, epk, x25519.getPublicKey(privateKey), albumId)
  try {
    return await unwrapKey(kek, fromB64u(grant.wrapped))
  } catch {
    throw new Error(`this grant is not for this wallet, or not for album ${albumId}`)
  }
}

/** The album's discovery tag: opaque to anyone without AK, the same for everyone with it. */
export async function albumTag(ak) {
  const key = await crypto.subtle.importKey('raw', ak, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc('foc-collab/album-tag/v1')))).slice(0, 32)
}

/**
 * An EIP-1193 provider as a `sign` function for `address`. Before the first
 * prompt it asks the wallet's chain for code at the address: a contract
 * account (Safe, smart wallets, ERC-4337) signs through ERC-1271, whose
 * signatures are not stable, so it cannot hold a derived key.
 */
export function providerSigner(provider, address) {
  let eoa = null
  return async (typedData) => {
    eoa ??= provider.request({ method: 'eth_getCode', params: [address, 'latest'] }).then((code) => {
      if (code != null && code !== '0x') throw new Error('this is a smart-contract wallet; album keys need a regular (EOA) wallet, because contract signatures are not reproducible')
    })
    await eoa
    const payload = { ...typedData, types: { EIP712Domain: DOMAIN_TYPES, ...typedData.types } }
    return provider.request({ method: 'eth_signTypedData_v4', params: [address, JSON.stringify(payload)] })
  }
}

/** The access key for a link share (AK as text), delivered on a second channel, never in the URL. */
export const accessKeyText = (ak) => toB64u(ak)
export const accessKeyFromText = (text) => {
  let ak = null
  try {
    ak = fromB64u(text.trim())
  } catch { /* not base64url: same answer as a wrong length */ }
  if (ak?.length !== 32) throw new Error('that is not an album access key')
  return ak
}
