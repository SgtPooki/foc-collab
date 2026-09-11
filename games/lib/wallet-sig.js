/**
 * A wallet's word inside a piece. The key that writes a piece (a P-256
 * identity, or a guest key through an authorizer) is not the wallet
 * that paid, so an app that pairs pieces with deposits needs the wallet
 * to sign the piece body itself. This is EIP-191 personal_sign over the
 * canonical body (identity.js canon), with the wallet address in the
 * body and the signature outside it, under `walletSig`.
 *
 * Verification is async (secp256k1 recovery) and runs before the fold,
 * like signature verification in identity.js: it annotates the piece
 * with `walletOk: true` when the signature recovers to `wallet`. The
 * fold only reads the annotation.
 */
import { verifyMessage } from './foc-deps.js'
import { canon } from './identity.js'

const OUTSIDE = ['walletSig', 'sig', 'ref', 'src', 'pieceId', 'removed', 'walletOk', 'token']

/** The message a wallet signs for `body`: every signed field except the ones added after signing. */
export function walletMessage(body) {
  const inner = {}
  for (const k of Object.keys(body)) if (!OUTSIDE.includes(k)) inner[k] = body[k]
  return `foc-collab piece\n${canon(inner)}`
}

/** Asks the wallet (EIP-1193 provider) to sign `body` for `address`; returns the body with walletSig. */
export async function signWithWallet(provider, address, body) {
  const message = walletMessage({ ...body, wallet: address })
  const hex = `0x${Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, '0')).join('')}`
  const walletSig = await provider.request({ method: 'personal_sign', params: [hex, address] })
  return { ...body, wallet: address, walletSig }
}

/** True when piece.walletSig recovers to piece.wallet over the canonical body. */
export async function verifyWalletSig(piece) {
  if (piece == null || typeof piece !== 'object') return false
  if (typeof piece.wallet !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(piece.wallet)) return false
  if (typeof piece.walletSig !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(piece.walletSig)) return false
  try {
    return await verifyMessage({ address: piece.wallet, message: walletMessage(piece), signature: piece.walletSig })
  } catch {
    return false
  }
}

/** Annotates every piece that carries a valid wallet signature with walletOk: true. */
export async function annotateWalletSigs(pieces) {
  return Promise.all(pieces.map(async (p) => {
    if (p == null || typeof p !== 'object' || p.walletSig == null) return p
    return (await verifyWalletSig(p)) ? { ...p, walletOk: true } : p
  }))
}
