import assert from 'node:assert/strict'
import { test } from 'node:test'
import { privateKeyToAccount } from 'viem/accounts'
import {
  accessKeyFromText, accessKeyText, albumTag, encryptionKeyPair, grantTo, newAlbumKey,
  openAlbumKey, openGrant, providerSigner,
} from './album-key.js'

const owner = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
const member = privateKeyToAccount('0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a')
const signer = (account) => (typedData) => account.signTypedData(typedData)
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

test('the owner recovers the album key from the public lock with their wallet alone; no one else can', async () => {
  const { ak, lock } = await newAlbumKey(signer(owner))
  assert.equal(ak.length, 32)
  assert.match(lock.nonce, /^0x[0-9a-f]{32}$/)
  assert.deepEqual(await openAlbumKey(signer(owner), lock), ak)
  await assert.rejects(openAlbumKey(signer(member), lock), /did not create this album/)
})

test('two albums from one wallet get unrelated keys', async () => {
  const a = await newAlbumKey(signer(owner))
  const b = await newAlbumKey(signer(owner))
  assert.notDeepEqual(a.ak, b.ak)
  assert.notEqual(a.lock.nonce, b.lock.nonce)
})

test('a wallet that signs differently each time is refused before any key exists', async () => {
  let n = 0
  const flaky = (typedData) => (n++ % 2 === 0 ? owner : member).signTypedData(typedData)
  await assert.rejects(newAlbumKey(flaky), /differently each time/)
})

test('a wallet that returns the high-s form (and a different v) on the second prompt still gets its key', async () => {
  // Both (r, s) and (r, N - s) are valid signatures; only r and low-s feed the key.
  let n = 0
  const malleable = async (typedData) => {
    const sig = await owner.signTypedData(typedData)
    if (n++ % 2 === 0) return sig
    const s = BigInt(`0x${sig.slice(66, 130)}`)
    return `${sig.slice(0, 66)}${(N - s).toString(16).padStart(64, '0')}00`
  }
  const { ak, lock } = await newAlbumKey(malleable)
  assert.deepEqual(await openAlbumKey(signer(owner), lock), ak)
})

test('a lock whose nonce is not 16 bytes of hex is refused before the wallet is asked', async () => {
  let asked = false
  const sign = (typedData) => {
    asked = true
    return owner.signTypedData(typedData)
  }
  await assert.rejects(openAlbumKey(sign, { nonce: '0x1234', wrapped: 'AA' }), /not an album lock/)
  assert.equal(asked, false)
})

test('a grant opens only for its member and only for its album', async () => {
  const { ak } = await newAlbumKey(signer(owner))
  const bob = await encryptionKeyPair(signer(member), { check: true })
  const grant = await grantTo(ak, bob.publicKey, 'album-1')
  assert.deepEqual(await openGrant(bob.privateKey, grant, 'album-1'), ak)
  await assert.rejects(openGrant(bob.privateKey, grant, 'album-2'), /not for this wallet, or not for album album-2/)
  const eve = await encryptionKeyPair(signer(owner))
  await assert.rejects(openGrant(eve.privateKey, grant, 'album-1'), /not for this wallet, or not for album album-1/)
})

test('a grant to a low-order public key is refused: its shared secret would be public', async () => {
  const { ak } = await newAlbumKey(signer(owner))
  const lowOrder = new Uint8Array(32)
  lowOrder[0] = 1 // u = 1
  await assert.rejects(grantTo(ak, lowOrder, 'album-1'), /not a usable encryption key/)
})

test('a member\'s encryption key is the same on every device: derived from the wallet', async () => {
  const a = await encryptionKeyPair(signer(member))
  const b = await encryptionKeyPair(signer(member))
  assert.deepEqual(a.publicKey, b.publicKey)
})

test('the album tag is stable per album key and differs across albums', async () => {
  const { ak } = await newAlbumKey(signer(owner))
  const { ak: other } = await newAlbumKey(signer(owner))
  assert.equal(await albumTag(ak), await albumTag(ak))
  assert.notEqual(await albumTag(ak), await albumTag(other))
  assert.match(await albumTag(ak), /^[0-9a-f]{32}$/)
})

test('providerSigner sends eth_signTypedData_v4 JSON that signs the same as viem does directly', async () => {
  let codeChecks = 0
  const provider = {
    async request({ method, params }) {
      if (method === 'eth_getCode') {
        codeChecks++
        return '0x'
      }
      assert.equal(method, 'eth_signTypedData_v4')
      assert.equal(params[0], owner.address)
      const typed = JSON.parse(params[1])
      assert.deepEqual(typed.types.EIP712Domain, [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }])
      return owner.signTypedData(typed)
    },
  }
  const { ak, lock } = await newAlbumKey(providerSigner(provider, owner.address))
  assert.deepEqual(await openAlbumKey(signer(owner), lock), ak)
  assert.equal(codeChecks, 1) // two signatures, one EOA check
})

test('the access key round-trips as text and rejects anything else', () => {
  const ak = crypto.getRandomValues(new Uint8Array(32))
  assert.deepEqual(accessKeyFromText(` ${accessKeyText(ak)}\n`), ak)
  assert.throws(() => accessKeyFromText('short'), /not an album access key/)
})

test('providerSigner refuses a contract account before any signature prompt', async () => {
  const requests = []
  const contract = {
    async request({ method }) {
      requests.push(method)
      if (method === 'eth_getCode') return '0x6080604052'
      throw new Error(`unexpected ${method}`)
    },
  }
  await assert.rejects(newAlbumKey(providerSigner(contract, owner.address)), /smart-contract wallet/)
  assert.deepEqual(requests, ['eth_getCode'])
})
