import assert from 'node:assert/strict'
import { test } from 'node:test'
import { privateKeyToAccount } from 'viem/accounts'
import { annotateWalletSigs, signWithWallet, verifyWalletSig, walletMessage } from './wallet-sig.js'
import { generateIdentity, signPiece, verifyAll } from './identity.js'

const key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const account = privateKeyToAccount(key)
// A fake EIP-1193 provider that signs personal_sign requests with a local key.
const provider = {
  async request({ method, params }) {
    if (method !== 'personal_sign') throw new Error(method)
    const [hex] = params
    const message = new TextDecoder().decode(Uint8Array.from(hex.slice(2).match(/../g).map((b) => parseInt(b, 16))))
    return account.signMessage({ message })
  },
}

test('a wallet-signed piece verifies, survives P-256 signing on top, and fails when tampered', async () => {
  const body = { v: 2, app: 'foc-jukebox', log: 'byow:1', type: 'pick', box: 'main', track: { kind: 'youtube', id: 'dQw4w9WgXcQ' } }
  const withWallet = await signWithWallet(provider, account.address, body)
  assert.equal(withWallet.wallet, account.address)
  assert.equal(await verifyWalletSig(withWallet), true)
  const identity = await generateIdentity()
  const signed = await signPiece(withWallet, identity)
  const [verified] = await verifyAll([signed])
  assert.ok(verified)
  const [annotated] = await annotateWalletSigs([verified])
  assert.equal(annotated.walletOk, true)
  const tampered = { ...annotated, track: { kind: 'youtube', id: 'AAAAAAAAAAA' } }
  assert.equal(await verifyWalletSig(tampered), false)
  const other = { ...annotated, wallet: '0x1111111111111111111111111111111111111111' }
  assert.equal(await verifyWalletSig(other), false)
})

test('the signed message excludes annotations and the P-256 fields, so verification is stable after listing', () => {
  const body = { v: 2, app: 'x', log: 'byow:1', type: 'pick', wallet: '0xabc' }
  const listed = { ...body, walletSig: '0x1', sig: 's', token: 't', ref: 'r', src: '1', pieceId: 5n, removed: false, walletOk: true }
  assert.equal(walletMessage(listed), walletMessage(body))
})
