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
 * Writing (needs this browser's wallet player, own data set): a photo is
 * re-encoded through a canvas (1600px, strips EXIF), sealed, uploaded as
 * a raw blob; then a signed log piece carrying its PieceCID and a sealed
 * thumbnail is appended. Each contributor pays for their own photos.
 */
import {
  accessKeyFromText, accessKeyText, albumTag, newAlbumKey, openAlbumKey, providerSigner,
} from '../lib/album-key.js'
import { bootByowPage } from '../lib/boot-byow.js'
import { homeLog } from '../lib/byow-engine.js'
import { tagsFor } from '../lib/discover.js'
import { fromB64u, pieceRef, signPiece, toB64u, verifyAll } from '../lib/identity.js'
import { open, seal } from '../lib/seal.js'
import { ensureChain } from '../lib/wallet-byow.js'
import { APP, foldAlbum } from './fold.js'

const FULL_PX = 1600
const THUMB_PX = 320
const MAX_PHOTO_BYTES = 16 * 1024 * 1024 // a sealed 1600px JPEG is well under 1 MB; this bounds what a viewer downloads
const POLL_MS = 15000
const KEY_PREFIX = 'album:key:'
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

  const albumName = `${target.root}.${target.id}`
  let ak = null
  try {
    const saved = localStorage.getItem(KEY_PREFIX + albumName)
    if (saved != null) ak = accessKeyFromText(saved)
  } catch { /* a corrupt saved key: ask again */ }
  if (ak == null) {
    await mountUnlock()
    return
  }
  await mountAlbumView()

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
        const { ak: key, lock } = await newAlbumKey(await walletSigner())
        const id = [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')
        const from = String(await transport.blockNumber())
        const inner = await signPiece({ v: 2, app: APP, log: homeLog(me.ds), type: 'album', album: id, title }, identity)
        const box = toB64u(await seal(new TextEncoder().encode(JSON.stringify(inner)), key))
        const tag = await albumTag(key)
        await transport.append({ v: 2, app: APP, type: 'album', album: id, lock, box }, (stage) => setStatus(`creating the album: ${stage}`), tagsFor(APP, tag, 'album'))
        const name = `${me.ds}.${id}`
        localStorage.setItem(KEY_PREFIX + name, accessKeyText(key))
        rememberAlbum({ album: name, from, title })
        location.search = `?album=${name}&from=${from}`
      } catch (err) {
        fail('could not create the album', err)
        $('create').disabled = !canWrite
      }
    }
  }

  // ---------------------------------------------------------------- unlock
  async function mountUnlock() {
    $('unlock').hidden = false
    const ownAlbum = me != null && me.ds === target.root
    $('owner-open').hidden = !ownAlbum
    setStatus('this album needs its access key')
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
  async function findLock() {
    const [creation] = (await rootPieces()).sort((a, b) => Number(a.pieceId) - Number(b.pieceId))
    return creation?.lock ?? null
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
  async function mountAlbumView() {
    $('album').hidden = false
    const tag = await albumTag(ak)
    transport.addDataSet(target.root)
    const link = `${location.origin}${location.pathname}?album=${albumName}${fromBlock != null ? `&from=${fromBlock}` : ''}`
    $('share-link').textContent = link
    $('share-key').textContent = accessKeyText(ak)
    $('copy-link').onclick = () => navigator.clipboard.writeText(link).then(() => setStatus('link copied'))
    $('copy-key').onclick = () => navigator.clipboard.writeText(accessKeyText(ak)).then(() => setStatus('access key copied: send it separately from the link'))
    $('upload').disabled = !canWrite
    $('files').disabled = !canWrite

    const opened = new Map() // `${src}:${pieceId}` -> verified inner piece, or null for not ours
    const blocks = new Map() // `${src}:${pieceId}` -> PieceAdded block (display order only)
    const thumbs = new Map() // ref -> object URL
    let state = { exists: false, title: null, photos: [], ignored: 0 }
    let pending = 0 // photos uploaded but not yet folded in

    async function openPiece(p) {
      const key = `${p.src}:${p.pieceId}`
      if (opened.has(key)) return opened.get(key)
      let result = null
      try {
        const inner = JSON.parse(new TextDecoder().decode(await open(fromB64u(p.box), ak)))
        const [verified] = await verifyAll([inner])
        // The home binding: a piece counts only in the data set it was signed for.
        if (verified != null && verified.log === homeLog(p.src)) result = { ...verified, src: p.src, pieceId: p.pieceId }
      } catch { /* sealed for another album, or malformed */ }
      opened.set(key, result)
      return result
    }

    async function refresh() {
      const discovery = await transport.discover({ app: APP, game: tag, from: fromBlock })
      for (const h of discovery.hints) blocks.set(`${h.ds}:${h.pieceId}`, Number(h.block))
      const raw = (await transport.list()).filter((p) => p != null && !p.removed && p.app === APP && typeof p.box === 'string')
      const inner = (await Promise.all(raw.map(openPiece))).filter((p) => p != null)
      const before = state.photos.length
      state = foldAlbum(target, inner)
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
        if (!state.exists) setStatus('looking for the album on chain; a new album appears within a minute or two')
        else if (pending > 0) setStatus(`${pending} photo${pending === 1 ? '' : 's'} uploaded, appearing in the album shortly`)
        else if (!canWrite) setStatus(me == null ? 'viewing: connect your wallet (above) to add photos' : 'viewing: your session key expired; reconnect to add photos')
        else setStatus(`${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}`)
      }
      const contributors = new Set(state.photos.map((p) => p.src)).size
      const lines = [`${state.photos.length} photos from ${contributors} data set${contributors === 1 ? '' : 's'}, ${state.ignored} pieces ignored`]
      if (discovery?.failed?.length > 0) lines.push(`chain scan skipped ${discovery.failed.length} block range(s)`)
      const problems = transport.problems()
      if (problems.length > 0) lines.push(`cannot read ${problems.map((p) => `#${p.ds}`).join(', ')}`)
      $('meta').textContent = lines.join('. ')
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
      $('viewer-remove').hidden = !canWrite || !(isMine(photo) || me?.ds === target.root)
      const status = $('viewer-status')
      status.classList.remove('error')
      status.textContent = 'downloading and decrypting the full photo…'
      dialog.showModal()
      try {
        const sealed = await transport.fetchBlob(photo.src, photo.blob, MAX_PHOTO_BYTES)
        const bytes = await open(sealed, ak)
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

    // --------------------------------------------------------------- upload
    async function appendLog(body, label) {
      const inner = await signPiece({ v: 2, app: APP, log: homeLog(me.ds), ...body }, identity)
      const box = toB64u(await seal(new TextEncoder().encode(JSON.stringify(inner)), ak))
      await transport.append({ v: 2, app: APP, box }, (stage) => setStatus(`${label}: ${stage}`), tagsFor(APP, tag, body.type))
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
          const blob = await transport.appendBlob(await seal(full.bytes, ak), (stage) => setStatus(`${label}: ${stage}`), tagsFor(APP, tag, 'blob'))
          await appendLog({ type: 'photo', album: target.id, blob, thumb: toB64u(thumb.bytes), w: full.w, h: full.h, ...(caption ? { caption } : {}) }, label)
          pending++
        }
        busy = null
        $('files').value = ''
        await refresh()
      } catch (err) {
        fail('upload stopped', err)
      } finally {
        $('upload').disabled = !canWrite
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
