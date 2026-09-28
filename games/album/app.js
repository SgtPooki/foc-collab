/**
 * Shared album page. An album is `?album=<root>.<id>&from=<block>`: the
 * creator's data set, a random id, and the block it was made at (where
 * discovery starts). The access key never enters the URL; this browser
 * keeps it in localStorage once entered.
 *
 * Reading: discover every data set that posted pieces tagged with the
 * album's HMAC tag, list them, open each `foc-album` piece's sealed box
 * with the album key (pieces for other albums fail and drop out), check
 * the signature inside and the home binding, fold. Full-size photos are
 * fetched and opened only when viewed.
 *
 * Access. A link album seals everything under one album key, shared as a
 * pasted access key. A members-only album (`access: 'members'` on its
 * creation piece) seals under per-epoch keys derived from the album key,
 * which stays with the owner: people ask to join (a wallet-signed join
 * piece carrying their X25519 key), the owner approves (a keys piece
 * granting epoch keys 0..n), and removing someone starts a new epoch whose
 * key only the remaining members receive (album-key.js, fold.js).
 * `access` below hides the difference from the rest of the page.
 *
 * Writing (needs this browser's wallet player, own data set): a photo is
 * re-encoded through a canvas (1600px, strips EXIF), sealed, uploaded as
 * a raw blob; then a signed log piece carrying its PieceCID and a sealed
 * thumbnail is appended. Each contributor pays for their own photos.
 */
import {
  accessKeyFromText, accessKeyText, albumTag, encryptionKeyPair, grantTo, keyring, newAlbumKey, openAlbumKey, openGrant,
  providerSigner, publicAlbumTag,
} from '../lib/album-key.js'
import { bootByowPage } from '../lib/boot-byow.js'
import { homeLog } from '../lib/byow-engine.js'
import { tagsFor } from '../lib/discover.js'
import { fromB64u, pieceRef, signPiece, toB64u, verifyAll } from '../lib/identity.js'
import { open, seal } from '../lib/seal.js'
import { ensureChain } from '../lib/wallet-byow.js'
import { annotateWalletSigs, signWithWallet } from '../lib/wallet-sig.js'
import { readExif } from './exif.js'
import { APP, foldAlbum, foldMembers } from './fold.js'

const FULL_PX = 1600
const THUMB_PX = 320
const MAX_PHOTO_BYTES = 16 * 1024 * 1024 // a sealed 1600px JPEG is well under 1 MB; this bounds what a viewer downloads
const POLL_MS = 15000
const KEY_PREFIX = 'album:key:' // link albums: the access key; members-only albums: the owner's album key
const RING_PREFIX = 'album:keyring:' // a member's epoch keys for an album, as granted
const ENC_PREFIX = 'album:enc:' // this browser's cache of a wallet's X25519 private key (re-derivable)
const MODE_PREFIX = 'album:mode:' // an album's access mode, for the owner before its creation piece lands
const MINE_KEY = 'album:mine'

const short = (s) => (s == null ? '?' : `${String(s).slice(0, 6)}…${String(s).slice(-4)}`)
const b64uToB64 = (s) => s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (s.length % 4)) % 4)

function parseAlbumParam(value) {
  const m = /^(\d+)\.([0-9a-f]{16})$/.exec(value ?? '')
  return m == null ? null : { root: m[1], id: m[2] }
}

/** A JPEG no larger than maxPx on its longest side, redrawn on a canvas (so no EXIF survives). */
async function reencode(file, maxPx, quality) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b == null ? reject(new Error('could not encode the image')) : resolve(b)), 'image/jpeg', quality))
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h }
}

/** The fields of `exif` the contributor chose to keep, or undefined when none. */
function keptMeta(exif, keep) {
  const meta = {}
  if (keep.taken && exif.taken) meta.taken = exif.taken
  if (keep.camera && exif.camera) meta.camera = exif.camera
  if (keep.camera && exif.lens) meta.lens = exif.lens
  if (keep.gps && exif.gps) meta.gps = exif.gps
  return Object.keys(meta).length === 0 ? undefined : meta
}

/** One line per kept field, for the viewer; location links to a map only when clicked. */
function metaNodes(meta) {
  if (meta == null) return []
  const parts = []
  if (meta.taken) parts.push(`taken ${meta.taken}`)
  if (meta.camera) parts.push(meta.camera)
  if (meta.lens) parts.push(meta.lens)
  const nodes = [document.createTextNode(parts.join(' · '))]
  if (meta.gps) {
    const { lat, lon } = meta.gps
    const a = document.createElement('a')
    a.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.textContent = `${lat}, ${lon}`
    nodes.push(document.createTextNode(`${parts.length > 0 ? ' · ' : ''}location `), a)
  }
  return nodes
}

function rememberAlbum(entry) {
  const list = JSON.parse(localStorage.getItem(MINE_KEY) ?? '[]').filter((a) => a.album !== entry.album)
  localStorage.setItem(MINE_KEY, JSON.stringify([entry, ...list].slice(0, 50)))
}

export async function mountAlbum() {
  const { $, labelEl, transport, identity, byow } = await bootByowPage({ storagePrefix: 'album', spectatorNote: 'you can still view an album you have the key to' })
  if (!byow) {
    $('status').textContent = 'this build has no shared storage'
    return
  }
  const params = new URLSearchParams(location.search)
  const target = parseAlbumParam(params.get('album'))
  const fromBlock = params.get('from')
  const me = transport.me
  const canWrite = me != null && !(transport.writeExpiry && transport.writeExpiry < Date.now())
  const provider = globalThis.ethereum ?? null

  let busy = null
  let lastError = null
  const setStatus = (text, { error = false } = {}) => {
    const el = $('status')
    el.textContent = text
    el.classList.toggle('error', error)
    el.classList.toggle('busy', busy != null && !error)
  }
  const fail = (what, err) => {
    console.error(err)
    busy = null
    lastError = `${what} (${err?.shortMessage ?? err?.message?.slice(0, 160) ?? err})`
    setStatus(lastError, { error: true })
  }

  async function walletSigner() {
    if (provider == null) throw new Error('no browser wallet found')
    if (me == null) throw new Error('connect your wallet first (the button above)')
    await ensureChain(provider)
    return providerSigner(provider, me.wallet)
  }

  if (target == null) {
    mountHome()
    return
  }
  $('albums-nav').hidden = false

  const albumName = `${target.root}.${target.id}`
  let ak = null
  try {
    const saved = localStorage.getItem(KEY_PREFIX + albumName)
    if (saved != null) ak = accessKeyFromText(saved)
  } catch { /* a corrupt saved key: ask again */ }
  setStatus('reading the album')
  const creation = await findCreation()
  const members = creation?.access === 'members' || localStorage.getItem(MODE_PREFIX + albumName) === 'members'
  const isOwner = me != null && me.ds === target.root
  if (!members) {
    if (ak == null) await mountUnlock()
    else await mountAlbumView(linkAccess(ak))
  } else if (isOwner) {
    if (ak == null) await mountUnlock({ ownerOnly: true })
    else await mountAlbumView(ownerAccess(ak))
  } else {
    const keys = await memberKeys()
    if (keys != null) await mountAlbumView(memberAccess(keys))
  }

  // ---------------------------------------------------------------- access
  // What the rest of the page needs from an album's keys: which key opens a
  // piece of a given epoch, which key and epoch new pieces are sealed with,
  // the discovery tag, and (members-only) how to follow membership changes.
  function linkAccess(key) {
    return {
      members: false,
      tag: albumTag(key),
      keyFor: () => key,
      current: () => ({ key, epoch: undefined }),
      update: async () => {},
    }
  }
  function ownerAccess(root) {
    let keys = []
    const access = {
      members: true,
      owner: true,
      get stale() { return keys.length === 0 }, // no keys until the current epoch is read
      tag: publicAlbumTag(albumName),
      keyFor: (e) => keys[e] ?? null,
      current: () => ({ key: keys.at(-1), epoch: keys.length - 1 }),
      async update(m) {
        if (keys.length !== m.epoch + 1) keys = await keyring(root, albumName, m.epoch)
      },
    }
    return access
  }
  function memberAccess(initial) {
    let keys = initial
    return {
      members: true,
      owner: false,
      removed: false,
      stale: true, // until membership is read: never seal with a key that may be an old epoch's
      tag: publicAlbumTag(albumName),
      keyFor: (e) => keys[e] ?? null,
      current: () => ({ key: keys.at(-1), epoch: keys.length - 1 }),
      async update(m) {
        const w = me?.wallet?.toLowerCase()
        this.removed = m.removed.includes(w)
        const grant = m.grants.get(w)
        if (grant != null && grant.epoch > keys.length - 1) {
          const priv = localStorage.getItem(ENC_PREFIX + w) // new epoch: open the fresh grant without a prompt if we can
          if (priv != null) {
            keys = await openGrant(fromB64u(priv), grant, albumName)
            storeRing(keys)
          }
        }
        this.stale = keys.length - 1 < m.epoch
      },
    }
  }
  function storeRing(keys) {
    localStorage.setItem(RING_PREFIX + albumName, JSON.stringify(keys.map(toB64u)))
  }

  // ------------------------------------------------------- members: entry
  // A members-only album for someone who is not its owner: ask to join,
  // wait, open with the wallet once approved, or learn they were removed.
  // Resolves with their keyring, or null while the page shows why not.
  async function memberKeys() {
    let cached = null
    try {
      const saved = JSON.parse(localStorage.getItem(RING_PREFIX + albumName) ?? 'null')
      if (Array.isArray(saved) && saved.length > 0) cached = saved.map(fromB64u)
    } catch { /* ask the chain again */ }
    if (me == null) {
      if (cached != null) return cached
      showMemberEntry()
      setStatus('only approved people can see this album: connect your wallet (above) to ask to join')
      return null
    }
    setStatus('checking your membership')
    const w = me.wallet.toLowerCase()
    const m = await membership()
    const myJoin = m.joins.find((j) => j.wallet.toLowerCase() === w)
    const grant = m.state.grants.get(w)
    // Current keys in hand: open. A newer grant opens without a prompt when this browser kept the wallet's key.
    if (cached != null && (grant == null || grant.epoch <= cached.length - 1)) return cached
    const priv = localStorage.getItem(ENC_PREFIX + w)
    if (grant != null && priv != null) {
      try {
        const keys = await openGrant(fromB64u(priv), grant, albumName)
        storeRing(keys)
        return keys
      } catch { /* the cached key is not the granted one: ask the wallet below */ }
    }
    showMemberEntry()
    if (m.state.removed.includes(w)) {
      $('member-note').textContent = 'The album\'s owner removed you. You keep what you already saw; nothing added since is visible to you.'
      setStatus('removed from this album')
      return null
    }
    if (grant != null) {
      $('member-note').textContent = 'You are a member. Sign once with your wallet to open the album\'s keys.'
      $('member-open').hidden = false
      setStatus('approved: open the album with your wallet')
      $('member-open').onclick = async () => {
        busy = 'opening'
        try {
          setStatus('sign in your wallet to open the album')
          const pair = await encryptionKeyPair(await walletSigner(), { published: myJoin?.enc ?? null })
          localStorage.setItem(ENC_PREFIX + w, toB64u(pair.privateKey))
          storeRing(await openGrant(pair.privateKey, grant, albumName))
          rememberAlbum({ album: albumName, from: fromBlock })
          location.reload()
        } catch (err) {
          fail('could not open the album', err)
        }
      }
      return null
    }
    if (myJoin != null) {
      $('member-note').textContent = 'You asked to join. The album\'s owner sees your request the next time they open it.'
      setStatus('waiting for the owner to approve you')
      return null
    }
    $('member-note').textContent = 'Only people the album\'s owner approves can see it. Asking shares your wallet address and a public encryption key with the owner; your wallet signs twice to make that key, and once more for the request.'
    $('request-access').hidden = false
    $('request-access').disabled = !canWrite
    if (!canWrite) setStatus('connect your wallet (above) to ask to join; the request goes in your own data set')
    $('request-access').onclick = async () => {
      busy = 'asking to join'
      $('request-access').disabled = true
      try {
        setStatus('asking to join: sign in your wallet (twice for your key, once for the request)')
        const pair = await encryptionKeyPair(await walletSigner())
        localStorage.setItem(ENC_PREFIX + w, toB64u(pair.privateKey))
        const body = await signWithWallet(provider, me.wallet, { v: 2, app: APP, type: 'join', album: target.id, ds: me.ds, enc: toB64u(pair.publicKey) })
        await transport.append(body, (stage) => setStatus(`asking to join: ${stage}`), tagsFor(APP, await publicAlbumTag(albumName), 'join'))
        rememberAlbum({ album: albumName, from: fromBlock })
        busy = null
        $('member-note').textContent = 'Request sent. The album\'s owner sees it the next time they open the album.'
        setStatus('request sent: waiting for the owner to approve you')
      } catch (err) {
        fail('could not ask to join', err)
        $('request-access').disabled = !canWrite
      }
    }
    return null
  }

  function showMemberEntry() {
    $('unlock').hidden = false
    $('key-entry').hidden = true
    $('member-entry').hidden = false
  }

  /** The album's public membership pieces, folded: { state: foldMembers(), joins }. */
  async function membership() {
    transport.addDataSet(target.root)
    const discovery = await transport.discover({ app: APP, game: await publicAlbumTag(albumName), from: fromBlock })
    for (const h of discovery.hints) transport.addDataSet(h.ds)
    const raw = (await transport.list()).filter((p) => p != null && !p.removed && p.app === APP && p.album === target.id && (p.type === 'join' || p.type === 'keys'))
    const annotated = await annotateWalletSigs(raw)
    return { state: foldMembers(target, annotated), joins: annotated.filter((p) => p.type === 'join' && p.walletOk === true && p.ds === p.src) }
  }

  // ------------------------------------------------------------------ home
  function mountHome() {
    $('home').hidden = false
    const mine = JSON.parse(localStorage.getItem(MINE_KEY) ?? '[]')
    $('my-albums-panel').hidden = mine.length === 0
    $('my-albums').replaceChildren(...mine.map((a) => {
      const li = document.createElement('li')
      const link = document.createElement('a')
      link.href = `?album=${a.album}${a.from != null ? `&from=${a.from}` : ''}`
      link.textContent = a.title ?? a.album
      li.append(link)
      return li
    }))
    $('create').disabled = !canWrite
    if (!canWrite) setStatus('connect your wallet (above) to start an album; you pay for your own storage')
    $('create').onclick = async () => {
      const title = $('new-title').value.trim().slice(0, 80)
      if (title === '') {
        setStatus('give the album a title', { error: true })
        return
      }
      busy = 'creating the album'
      $('create').disabled = true
      try {
        setStatus('creating the album: sign twice in your wallet')
        const membersOnly = document.querySelector('input[name=access]:checked')?.value === 'members'
        const { ak: key, lock } = await newAlbumKey(await walletSigner())
        const id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')
        const name = `${me.ds}.${id}`
        const from = String(await transport.blockNumber())
        const inner = await signPiece({ v: 2, app: APP, log: homeLog(me.ds), type: 'album', album: id, title }, identity)
        // A members-only album seals under epoch 0's key, which every member receives; the album key never leaves the owner.
        const sealKey = membersOnly ? (await keyring(key, name, 0))[0] : key
        const box = toB64u(await seal(new TextEncoder().encode(JSON.stringify(inner)), sealKey))
        const tag = membersOnly ? await publicAlbumTag(name) : await albumTag(key)
        const outer = { v: 2, app: APP, type: 'album', album: id, lock, box, ...(membersOnly ? { access: 'members', epoch: 0 } : {}) }
        await transport.append(outer, (stage) => setStatus(`creating the album: ${stage}`), tagsFor(APP, tag, 'album'))
        localStorage.setItem(KEY_PREFIX + name, accessKeyText(key))
        if (membersOnly) localStorage.setItem(MODE_PREFIX + name, 'members')
        rememberAlbum({ album: name, from, title })
        location.search = `?album=${name}&from=${from}`
      } catch (err) {
        fail('could not create the album', err)
        $('create').disabled = !canWrite
      }
    }
  }

  // ---------------------------------------------------------------- unlock
  async function mountUnlock({ ownerOnly = false } = {}) {
    $('unlock').hidden = false
    const ownAlbum = me != null && me.ds === target.root
    $('owner-open').hidden = !ownAlbum
    $('key-entry').hidden = ownerOnly
    setStatus(ownerOnly ? 'this is your members-only album: unlock it with your wallet' : 'this album needs its access key')
    const accept = (key, how) => {
      localStorage.setItem(KEY_PREFIX + albumName, accessKeyText(key))
      rememberAlbum({ album: albumName, from: fromBlock })
      setStatus(`${how}: opening`)
      location.reload()
    }
    $('key-open').onclick = async () => {
      let key
      try {
        key = accessKeyFromText($('key-input').value)
      } catch (err) {
        setStatus(err.message, { error: true })
        return
      }
      busy = 'checking the key'
      setStatus('checking the key against the album')
      try {
        if (!(await keyOpensAlbum(key))) throw new Error('that key does not open this album')
        accept(key, 'key accepted')
      } catch (err) {
        fail('could not open the album', err)
      }
    }
    $('owner-open').onclick = async () => {
      busy = 'unlocking with your wallet'
      try {
        setStatus('finding the album in your data set')
        const lock = await findLock()
        if (lock == null) throw new Error('your data set has no creation piece for this album')
        setStatus('sign in your wallet to unlock the album')
        accept(await openAlbumKey(await walletSigner(), lock), 'unlocked')
      } catch (err) {
        fail('could not unlock', err)
      }
    }
  }

  async function rootPieces() {
    transport.addDataSet(target.root)
    return (await transport.list({ full: true })).filter((p) => p != null && p.src === target.root && p.app === APP && p.type === 'album' && p.album === target.id)
  }
  async function findCreation() {
    const [first] = (await rootPieces()).sort((a, b) => Number(a.pieceId) - Number(b.pieceId))
    return first ?? null
  }
  async function findLock() {
    return (await findCreation())?.lock ?? null
  }
  async function keyOpensAlbum(key) {
    for (const p of await rootPieces()) {
      try {
        const inner = JSON.parse(new TextDecoder().decode(await open(fromB64u(p.box), key)))
        if (inner.album === target.id) return true
      } catch { /* not this key */ }
    }
    return false
  }

  // ------------------------------------------------------------ album view
  async function mountAlbumView(access) {
    $('album').hidden = false
    const tag = await access.tag
    transport.addDataSet(target.root)
    const link = `${location.origin}${location.pathname}?album=${albumName}${fromBlock != null ? `&from=${fromBlock}` : ''}`
    $('share-link').textContent = link
    $('copy-link').onclick = () => navigator.clipboard.writeText(link).then(() => setStatus('link copied'))
    if (access.members) {
      $('share-key-row').hidden = true
      $('share-warn').textContent = 'Only people you approve can see this album. Send the link; they ask to join from it.'
      $('share').hidden = !access.owner
      $('members-panel').hidden = !access.owner
    } else {
      $('share-key').textContent = accessKeyText(ak)
      $('copy-key').onclick = () => navigator.clipboard.writeText(accessKeyText(ak)).then(() => setStatus('access key copied: send it separately from the link'))
    }
    const canUpload = () => canWrite && !access.removed && !access.stale
    $('upload').disabled = !canUpload()
    $('files').disabled = !canUpload()
    let members = null // foldMembers() of a members-only album, refreshed with the photos

    const opened = new Map() // `${src}:${pieceId}` -> verified inner piece, or null for not ours
    const blocks = new Map() // `${src}:${pieceId}` -> PieceAdded block (display order only)
    const thumbs = new Map() // ref -> object URL
    let state = { exists: false, title: null, photos: [], ignored: 0 }
    let pending = 0 // photos uploaded but not yet folded in
    let listed = false // whether this visit has put the album on the albums home

    async function openPiece(p) {
      const key = `${p.src}:${p.pieceId}`
      if (opened.has(key)) return opened.get(key)
      const sealKey = access.keyFor(p.epoch)
      if (sealKey == null) return null // an epoch this browser has no key for (yet): try again later
      let result = null
      try {
        const inner = JSON.parse(new TextDecoder().decode(await open(fromB64u(p.box), sealKey)))
        const [verified] = await verifyAll([inner])
        // The home binding: a piece counts only in the data set it was signed for.
        if (verified != null && verified.log === homeLog(p.src)) result = { ...verified, src: p.src, pieceId: p.pieceId, epoch: p.epoch }
      } catch { /* sealed for another album, or malformed */ }
      opened.set(key, result)
      return result
    }

    async function refresh() {
      const discovery = await transport.discover({ app: APP, game: tag, from: fromBlock })
      for (const h of discovery.hints) blocks.set(`${h.ds}:${h.pieceId}`, Number(h.block))
      const listed = await transport.list()
      if (access.members) {
        const mine = listed.filter((p) => p != null && !p.removed && p.app === APP && p.album === target.id && (p.type === 'join' || p.type === 'keys'))
        members = foldMembers(target, await annotateWalletSigs(mine))
        await access.update(members)
        $('upload').disabled = !canUpload()
        $('files').disabled = !canUpload()
      }
      const raw = listed.filter((p) => p != null && !p.removed && p.app === APP && typeof p.box === 'string' && p.type !== 'keys')
      const inner = (await Promise.all(raw.map(openPiece))).filter((p) => p != null)
      const before = state.photos.length
      state = foldAlbum(target, inner, access.members ? { onlySrcs: members.memberSrcs } : {})
      pending = Math.max(0, pending - Math.max(0, state.photos.length - before))
      render(discovery)
    }

    function thumbUrl(photo) {
      if (!thumbs.has(photo.ref)) thumbs.set(photo.ref, `data:image/jpeg;base64,${b64uToB64(photo.thumb)}`)
      return thumbs.get(photo.ref)
    }
    const isMine = (photo) => me != null && photo.src === me.ds && photo.token === identity.token
    const blockOf = (photo) => blocks.get(`${photo.src}:${photo.pieceId}`) ?? Number.MAX_SAFE_INTEGER

    function render(discovery) {
      const title = state.title ?? (state.exists ? 'album' : 'album (not found yet)')
      $('heading').textContent = title
      document.title = `${title}: shared album`
      if (state.title != null && !listed) { // list it on the albums home under its title, most recent first
        listed = true
        rememberAlbum({ album: albumName, from: fromBlock, title: state.title })
      }
      const ordered = [...state.photos].sort((a, b) => blockOf(b) - blockOf(a)) // newest first
      $('grid').replaceChildren(...ordered.map((photo) => {
        const b = document.createElement('button')
        b.title = photo.caption ?? `photo by ${short(photo.src)}`
        if (isMine(photo)) b.classList.add('mine')
        const img = document.createElement('img')
        img.alt = photo.caption ?? 'album photo'
        img.src = thumbUrl(photo)
        b.append(img)
        b.onclick = () => view(photo)
        return b
      }))
      if (busy == null && lastError == null) {
        if (access.removed) setStatus('the album\'s owner removed you: you see what was shared before, nothing added since')
        else if (access.stale && !access.owner) setStatus('the album has new keys: reload and open it with your wallet to see and add new photos')
        else if (pending > 0) setStatus(`${pending} photo${pending === 1 ? '' : 's'} uploaded, appearing in the album shortly`)
        else if (!state.exists) setStatus('looking for the album on chain; a new album appears within a minute or two')
        else if (!canWrite) setStatus(me == null ? 'viewing: connect your wallet (above) to add photos' : 'viewing: your session key expired; reconnect to add photos')
        else setStatus(`${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}`)
      }
      const contributors = new Set(state.photos.map((p) => p.src)).size
      const lines = [`${state.photos.length} photos from ${contributors} data set${contributors === 1 ? '' : 's'}, ${state.ignored} pieces ignored`]
      if (discovery?.failed?.length > 0) lines.push(`chain scan skipped ${discovery.failed.length} block range(s)`)
      const problems = transport.problems()
      if (problems.length > 0) lines.push(`cannot read ${problems.map((p) => `#${p.ds}`).join(', ')}`)
      $('meta').textContent = lines.join('. ')
      if (access.owner && members != null) renderMembers()
    }

    // -------------------------------------------------------------- members
    // The owner's side of a members-only album: approve a request (grant the
    // current epoch's keyring), remove a member (start a new epoch whose keys
    // only the remaining members get), or bring a removed member back.
    function memberRow(wallet, label, action) {
      const li = document.createElement('li')
      const who = document.createElement('code')
      who.textContent = wallet
      const b = document.createElement('button')
      b.textContent = label
      b.disabled = busy != null || !canWrite
      b.onclick = () => action(wallet, b)
      li.append(who, b)
      return li
    }
    function renderMembers() {
      $('requests-head').hidden = members.requests.length === 0
      $('requests').replaceChildren(...members.requests.map((r) => memberRow(r.wallet, 'approve', grant)))
      $('members').replaceChildren(...members.members.map((w) => memberRow(w, 'remove', revoke)))
      if (members.members.length === 0) $('members').replaceChildren(Object.assign(document.createElement('li'), { textContent: 'nobody yet: share the link' }))
      $('removed-head').hidden = members.removed.length === 0
      $('removed').replaceChildren(...members.removed.map((w) => memberRow(w, 'let back in', grant)))
    }
    async function postKeys(epoch, grantees, revoke, label) {
      const ring = await keyring(ak, albumName, epoch)
      const entries = []
      for (const w of grantees) {
        const enc = members.encOf.get(w)
        if (enc == null) throw new Error(`no encryption key published by ${w}`)
        entries.push({ to: w, ...(await grantTo(ring, fromB64u(enc), albumName)) })
      }
      const piece = { v: 2, app: APP, type: 'keys', album: target.id, epoch, entries, ...(revoke.length > 0 ? { revoke } : {}) }
      await transport.append(piece, (stage) => setStatus(`${label}: ${stage}`), tagsFor(APP, tag, 'keys'))
    }
    async function grant(wallet, button) {
      busy = 'approving'
      button.disabled = true
      try {
        await postKeys(members.epoch, [wallet], [], `letting ${short(wallet)} in`)
        busy = null
        setStatus(`${short(wallet)} is in: they see the album within a minute or two`)
      } catch (err) {
        fail('could not approve', err)
      }
    }
    async function revoke(wallet, button) {
      busy = 'removing'
      button.disabled = true
      try {
        const remaining = members.members.filter((w) => w !== wallet)
        await postKeys(members.epoch + 1, remaining, [wallet], `removing ${short(wallet)}`)
        busy = null
        setStatus(`${short(wallet)} is out: nothing added from now on is visible to them`)
      } catch (err) {
        fail('could not remove', err)
      }
    }

    // --------------------------------------------------------------- viewer
    const dialog = $('viewer')
    let viewing = null
    $('viewer-close').onclick = () => dialog.close()
    dialog.addEventListener('close', () => {
      if ($('viewer-img').src.startsWith('blob:')) URL.revokeObjectURL($('viewer-img').src)
      viewing = null
    })
    async function view(photo) {
      viewing = photo
      $('viewer-img').src = thumbUrl(photo)
      $('viewer-caption').textContent = photo.caption ?? ''
      $('viewer-meta').replaceChildren(...metaNodes(photo.meta))
      $('viewer-remove').hidden = !canWrite || !(isMine(photo) || me?.ds === target.root)
      const status = $('viewer-status')
      status.classList.remove('error')
      status.textContent = 'downloading and decrypting the full photo…'
      dialog.showModal()
      try {
        const sealed = await transport.fetchBlob(photo.src, photo.blob, MAX_PHOTO_BYTES)
        const bytes = await open(sealed, access.keyFor(photo.epoch))
        if (viewing !== photo) return
        $('viewer-img').src = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
        status.textContent = `${photo.w}×${photo.h}, from data set #${photo.src}`
      } catch (err) {
        console.error(err)
        status.textContent = `could not load the full photo (${err?.message?.slice(0, 120) ?? err}); showing the thumbnail`
        status.classList.add('error')
      }
    }
    $('viewer-remove').onclick = async () => {
      const photo = viewing
      if (photo == null) return
      $('viewer-remove').disabled = true
      try {
        await appendLog({ type: 'remove', album: target.id, target: photo.ref }, 'removing')
        $('viewer-status').textContent = 'removed; it disappears for everyone within a minute or two'
      } catch (err) {
        $('viewer-status').textContent = `could not remove (${err?.message?.slice(0, 120) ?? err})`
        $('viewer-status').classList.add('error')
      } finally {
        $('viewer-remove').disabled = false
      }
    }

    // ------------------------------------------------------------- metadata
    // Read each chosen file's EXIF as soon as it is picked, so the choice of
    // what to keep is made with the details in front of the contributor.
    const exifOf = new Map() // File -> readExif() result
    const keepChoices = () => ({ taken: $('keep-taken').checked, camera: $('keep-camera').checked, gps: $('keep-gps').checked })
    function renderMetaList() {
      const files = [...$('files').files]
      $('meta-choices').hidden = files.length === 0
      const keep = keepChoices()
      $('meta-list').replaceChildren(...files.map((file) => {
        const li = document.createElement('li')
        const exif = exifOf.get(file)
        if (exif == null) {
          li.textContent = `${file.name}: reading…`
          return li
        }
        const found = []
        if (exif.taken) found.push(`taken ${exif.taken}`)
        if (exif.camera) found.push(exif.camera)
        if (exif.lens) found.push(exif.lens)
        if (exif.gps) found.push(`location ${exif.gps.lat}, ${exif.gps.lon}`)
        if (found.length === 0) {
          li.textContent = `${file.name}: no metadata found`
          return li
        }
        const kept = keptMeta(exif, keep)
        li.textContent = `${file.name}: ${found.join(' · ')} → keeping ${kept == null ? 'nothing' : Object.keys(kept).join(', ')}`
        if (exif.gps && keep.gps) li.classList.add('gps')
        return li
      }))
    }
    $('files').onchange = async () => {
      renderMetaList()
      for (const file of $('files').files) {
        try {
          exifOf.set(file, readExif(new Uint8Array(await file.arrayBuffer())))
        } catch {
          exifOf.set(file, {})
        }
        renderMetaList()
      }
    }
    for (const id of ['keep-taken', 'keep-camera', 'keep-gps']) $(id).onchange = renderMetaList

    // --------------------------------------------------------------- upload
    async function appendLog(body, label, sealWith = access.current()) {
      const inner = await signPiece({ v: 2, app: APP, log: homeLog(me.ds), ...body }, identity)
      const box = toB64u(await seal(new TextEncoder().encode(JSON.stringify(inner)), sealWith.key))
      const outer = { v: 2, app: APP, album: target.id, box, ...(sealWith.epoch !== undefined ? { epoch: sealWith.epoch } : {}) }
      await transport.append(outer, (stage) => setStatus(`${label}: ${stage}`), tagsFor(APP, tag, body.type))
      return pieceRef(inner)
    }
    $('upload').onclick = async () => {
      const files = [...$('files').files]
      if (files.length === 0) {
        setStatus('choose one or more photos first', { error: true })
        return
      }
      const caption = $('caption').value.trim().slice(0, 200) || undefined
      busy = 'uploading'
      lastError = null
      $('upload').disabled = true
      try {
        for (const [i, file] of files.entries()) {
          const label = `photo ${i + 1} of ${files.length}`
          setStatus(`${label}: resizing and encrypting`)
          const full = await reencode(file, FULL_PX, 0.85)
          const thumb = await reencode(file, THUMB_PX, 0.7)
          const meta = keptMeta(exifOf.get(file) ?? readExif(new Uint8Array(await file.arrayBuffer())), keepChoices())
          const sealWith = access.current() // the photo and its log piece share one epoch key
          const blob = await transport.appendBlob(await seal(full.bytes, sealWith.key), (stage) => setStatus(`${label}: ${stage}`), tagsFor(APP, tag, 'blob'))
          await appendLog({ type: 'photo', album: target.id, blob, thumb: toB64u(thumb.bytes), w: full.w, h: full.h, ...(caption ? { caption } : {}), ...(meta ? { meta } : {}) }, label, sealWith)
          pending++
        }
        busy = null
        $('files').value = ''
        exifOf.clear()
        renderMetaList()
        await refresh()
      } catch (err) {
        fail('upload stopped', err)
      } finally {
        $('upload').disabled = !canUpload()
      }
    }

    labelEl.textContent = `${transport.label}: album ${albumName}`
    busy = 'loading'
    setStatus('finding the album\'s contributors on chain')
    try {
      await refresh()
      if (busy === 'loading') { // an upload may have started meanwhile; leave its state alone
        busy = null
        render()
      }
    } catch (err) {
      fail('could not load the album', err)
    }
    setInterval(() => {
      if (busy == null) refresh().catch((err) => console.error(err))
    }, POLL_MS)
  }
}
