/**
 * The shared page shell for a two-seat piece-log game: transport and
 * identity setup, wallet onboarding, lobby, discovery, optimistic pending
 * move and pending create, notifications, and the status line. A game
 * page supplies its folds, board renderer, and copy through `mountGame`
 * and keeps only its markup and styles.
 *
 * The page's markup must provide these ids: transport-label, intro,
 * wallet-row, connect, wallet-status, banner, lobby, create, games,
 * lobby-empty, game, share, join, link-back, rematch, notify, board,
 * status, log-info, byow-meta.
 *
 * Two modes, chosen by the transport: BYOW (schema v2, each player writes
 * to their own data set, opponents found through chain events) and the v1
 * single shared log used by the local demo and the publisher-key build.
 */
import { tagsFor } from './discover.js'
import { loadIdentity, signPiece, verifyAll } from './identity.js'
import { createTransport } from './transport.js'
import { hasWallet, provisionPlayer } from './wallet-byow.js'

const PENDING_TIMEOUT_MS = 3 * 60000 // give up on a submitted move or create after 3 minutes

/**
 * spec:
 *   app            domain-separation tag signed into every piece, e.g. 'foc-ttt'
 *   name           human name used in titles and notifications, e.g. 'tic-tac-toe'
 *   storagePrefix  sessionStorage key prefix, e.g. 'ttt'
 *   intro          the BYOW intro paragraph
 *   seatNames      { X, O } display names, e.g. { X: 'Red', O: 'Yellow' }
 *   status(state)  one-line game status (from the game's fold module)
 *   v1             { fold(game, pieces), lobby(pieces), seatOf(state, token) }
 *   v2             { foldByow(game, root, pieces), lobbyByow(pieces), seatOfHome(state, ds), dataSetsOf(state) }
 *   moveFields(m)  the board fields a pending move { ..., seat, sentAt } puts in its piece, e.g. { cell }
 *   landed(board, m) what the board holds where pending move m would land
 *   renderBoard(ctx) DOM nodes for the board; ctx = { state, seat, playable, ratifying, canMove,
 *                  pendingMove, prevBoard, place(move, label) } where place() appends the move
 */
export async function mountGame(spec) {
  const { app: APP, seatNames, status } = spec
  const seatName = (s) => (s == null ? s : seatNames[s])
  // Fold status lines name seats X and O; the page shows the game's own names.
  const pretty = (line) => String(line).replace(/\bX\b/g, seatNames.X).replace(/\bO\b/g, seatNames.O)

  const $ = (id) => document.getElementById(id)
  const labelEl = $('transport-label')
  labelEl.textContent = 'connecting to shared storage…'
  let transport
  try {
    transport = await createTransport()
  } catch (err) {
    console.error(err)
    labelEl.textContent = `could not connect (${err?.message?.slice(0, 120) ?? err}) — reload to retry`
    throw err
  }

  // Seat identity is a keypair generated in this browser: every appended
  // piece is signed, so log readers cannot alter a player's pieces. The
  // private key is a non-extractable CryptoKey in IndexedDB. On shared
  // storage one identity serves the whole browser; the local demo scopes
  // identities by a per-tab id so two tabs in one browser can face each
  // other (and keep their seats across reloads).
  function tabScope() {
    const key = `${spec.storagePrefix}-tab-id`
    let id = sessionStorage.getItem(key)
    if (id == null) {
      id = crypto.randomUUID()
      sessionStorage.setItem(key, id)
    }
    return id
  }
  const identity = await loadIdentity(transport.perTab ? tabScope() : 'shared')
  const token = identity.token
  labelEl.textContent = transport.label

  const params = new URLSearchParams(location.search)
  const gameId = params.get('game')

  // BYOW (schema v2): each player writes to their own data set; a game is
  // (game id, root data set) and the invite link carries both. The fold
  // follows the seat-owner sequencing rules in byow-engine.js. Otherwise
  // the page is the v1 single-shared-log game.
  const byow = typeof transport.addDataSet === 'function'
  const V = byow ? 2 : 1
  const root = byow ? (params.get('x') ?? transport.me?.ds ?? null) : null
  const fromBlock = params.get('from') // block the game was created at: where discovery starts
  if (byow && params.get('o')) transport.addDataSet(params.get('o'))
  let discovery = { hints: [], failed: [] } // last chain-event scan, for the meta line
  if (byow) $('intro').textContent = spec.intro
  const foldGame = (pieces) => (byow ? spec.v2.foldByow(gameId, root, pieces) : spec.v1.fold(gameId, pieces))
  const foldLobby = (pieces) => (byow ? spec.v2.lobbyByow(pieces) : spec.v1.lobby(pieces))
  // Who am I in a game: on BYOW the seat owner is my home data set (any
  // browser holding this wallet's session key is the same player); on the
  // shared log it is this browser's signing token.
  const mySeat = (state) => (byow ? spec.v2.seatOfHome(state, transport.me?.ds) : spec.v1.seatOf(state, token))
  const joinedByMe = (state) => byow && transport.me != null && (state.joins ?? []).some((j) => j.ds === transport.me.ds)
  const gameHref = (g) => {
    if (!byow) return `?game=${encodeURIComponent(g.game)}`
    const hint = discovery.hints.find((h) => h.ds === g.root && h.tags.type === 'create')
    const from = hint == null ? '' : `&from=${hint.block}`
    return `?game=${encodeURIComponent(g.game)}&x=${encodeURIComponent(g.root)}${from}`
  }

  let pieces = []
  let busy = null // label of the in-flight append, e.g. 'placing your X'
  let busyStage = null // transport progress: uploading / stored / submitted
  let pendingMove = null // { ...board fields, seat, sentAt } shown optimistically until the log confirms it
  let lastError = null
  let prevBoard = null // to highlight the opponent's latest move
  let prevSnapshot = null
  let lastNotifiedSeq = -1

  // A game created in this browser is tracked across the navigation to its
  // page: the create piece takes a while to settle on-chain, and until the
  // fold sees it the creator would otherwise look like a spectator.
  const PENDING_CREATE_KEY = `${spec.storagePrefix}:pending-create`
  function loadPendingCreate() {
    try {
      const p = JSON.parse(sessionStorage.getItem(PENDING_CREATE_KEY) ?? 'null')
      return p?.game === gameId && Number.isFinite(p.sentAt) ? p : null
    } catch {
      return null
    }
  }
  let pendingCreate = gameId == null ? null : loadPendingCreate()
  function settlePendingCreate(state) {
    if (pendingCreate == null) return
    if (state.seats.X != null) {
      pendingCreate = null
      sessionStorage.removeItem(PENDING_CREATE_KEY)
    } else if (Date.now() - pendingCreate.sentAt > PENDING_TIMEOUT_MS) {
      pendingCreate = null
      sessionStorage.removeItem(PENDING_CREATE_KEY)
      lastError = 'your game has not appeared on-chain yet — keep this page open, it will show once the piece settles'
    }
  }

  if (transport.writeExpiry) {
    const banner = $('banner')
    if (transport.writeExpiry < Date.now()) {
      banner.textContent = byow
        ? 'your session key has expired — reconnect your wallet to play'
        : 'the demo write key has expired — games are read-only until the publisher re-arms it'
      banner.hidden = false
    } else if (transport.writeExpiry < Date.now() + 3 * 3600000) {
      banner.textContent = `heads up: your write key expires ${new Date(transport.writeExpiry).toLocaleString()}`
      banner.hidden = false
    }
  }

  // BYOW onboarding: with no descriptor (or an expired one) the page is a
  // spectator and offers to make one from the connected wallet. Every stage
  // is shown; every failure names its step. Success reloads into play mode.
  const needsWallet = byow && (transport.me == null || (transport.writeExpiry && transport.writeExpiry < Date.now()))
  if (needsWallet) {
    $('wallet-row').hidden = false
    const walletStatus = $('wallet-status')
    const connect = $('connect')
    if (!hasWallet()) {
      connect.disabled = true
      walletStatus.textContent = 'no browser wallet found — install MetaMask (or any EIP-1193 wallet) on Filecoin calibration to play; you can still watch games'
    }
    connect.onclick = async () => {
      connect.disabled = true
      walletStatus.classList.remove('error')
      try {
        // Never clear what is saved first: provisionPlayer resumes from it and
        // only pays for the steps the chain does not already show done.
        const me = await provisionPlayer({ onProgress: (stage) => { walletStatus.textContent = `${stage}…` } })
        walletStatus.textContent = `ready: your data set #${me.ds}, reloading`
        location.reload()
      } catch (err) {
        console.error(err)
        walletStatus.textContent = `could not set up (${err?.message ?? err}) — fix and try again`
        walletStatus.classList.add('error')
        connect.disabled = false
      }
    }
  }

  function renderLobby() {
    $('lobby').hidden = false
    const create = $('create')
    create.disabled = busy != null
    create.textContent = busy ?? 'create a game'
    const games = foldLobby(pieces)
    $('lobby-empty').hidden = games.length > 0
    const joined = (g) => mySeat(g) != null || joinedByMe(g)
    const mine = games.filter((g) => joined(g))
    const open = games.filter((g) => !joined(g) && g.seats.O == null)
    const rest = games.filter((g) => !joined(g) && g.seats.O != null)
    create.disabled = busy != null || (byow && transport.me == null)
    if (byow && transport.me == null) create.textContent = 'spectating: connect a wallet to play'
    $('games').replaceChildren(
      ...lobbySection('your games', mine),
      ...lobbySection('open to join', open.slice(0, 15), open.length),
      ...lobbySection('other games', rest.slice(0, 15), rest.length),
    )
  }

  function lobbySection(title, games, total = games.length) {
    if (games.length === 0) return []
    const h = document.createElement('h2')
    h.textContent = total > games.length ? `${title} (${games.length} of ${total})` : title
    const ul = document.createElement('ul')
    ul.append(...games.map(lobbyRow))
    return [h, ul]
  }

  function lobbyRow(g) {
    const li = document.createElement('li')
    const mine = mySeat(g)
    if (mine != null && mine === g.next && g.winner == null && g.seats.O != null) {
      li.classList.add('your-turn')
    }
    const a = document.createElement('a')
    a.href = gameHref(g)
    a.textContent = g.name ?? g.game
    const span = document.createElement('span')
    span.className = 'meta'
    span.textContent = pretty(status(g)) + (mine != null ? ` — you are ${seatName(mine)}` : '')
    li.append(a, span)
    return li
  }

  function renderGame() {
    $('game').hidden = false
    const state = foldGame(pieces)
    const seat = mySeat(state)
    const iJoined = joinedByMe(state)
    const joinable = seat == null && pendingCreate == null && state.seats.X != null && state.seats.O == null && !iJoined
      && (!byow || transport.me != null)
    const join = $('join')
    join.hidden = !joinable
    join.disabled = busy != null
    // v2: X's first move ratifies the first joiner. Until then O is a candidate.
    const ratifying = byow && seat === 'X' && !state.ratified && state.joins.length > 0
    const playable = state.seats.O != null || ratifying
    renderByowMeta(state, iJoined)
    $('rematch').hidden = !(state.winner != null && seat != null && busy == null)
    $('notify').hidden = !('Notification' in window) || Notification.permission !== 'default'
      || seat == null || state.winner != null
    const canMove = seat != null && seat === state.next && state.winner == null
      && playable && busy == null && pendingMove == null
    const place = (move, label) => append(
      movePayload(state, spec.moveFields(move), ratifying),
      ratifying ? `${label}, seating data set #${state.joins[0].ds} as ${seatNames.O}` : label,
      { ...move, seat, sentAt: Date.now() },
    )
    $('board').replaceChildren(...spec.renderBoard({ state, seat, playable, ratifying, canMove, pendingMove, prevBoard, place }))
    const yourTurn = canMove
    document.title = yourTurn ? `● your move — ${spec.name}` : `${spec.name} on a piece log`
    // Notify when the player is not looking: a hidden tab, or a visible tab
    // in a window that does not have focus (another app or window in front).
    const away = document.hidden || !document.hasFocus()
    if (yourTurn && state.seq !== lastNotifiedSeq && away
      && 'Notification' in window && Notification.permission === 'granted') {
      lastNotifiedSeq = state.seq
      const n = new Notification(`your move — ${spec.name}`, { body: pretty(status(state)) })
      n.onclick = () => { window.focus(); n.close() }
    }
    const statusEl = $('status')
    statusEl.textContent = pretty(statusLine(state, seat, joinable, ratifying, iJoined))
    statusEl.classList.toggle('error', busy == null && lastError != null)
    statusEl.classList.toggle('busy', busy != null)
    const waitingOnOpponent = busy == null && lastError == null && state.winner == null
      && seat != null && state.seats.O != null && (seat !== state.next || pendingMove != null)
    statusEl.classList.toggle('waiting', waitingOnOpponent)
    $('log-info').textContent = `${state.applied} pieces applied, ${state.ignored} ignored`
  }

  function movePayload(state, fields, ratifying) {
    if (!byow) return { v: 1, type: 'move', game: gameId, seq: state.seq, ...fields }
    const move = { v: 2, type: 'move', game: gameId, seq: state.seq, prev: state.lastRef, ...fields }
    if (!ratifying) return move
    const join = state.joins[0]
    return { ...move, prev: join.ref, o: { token: join.token, ds: join.ds } }
  }

  // BYOW-only affordances: which data sets this board is folded from, read
  // problems, disputes (a piece vanished from its data set), and the
  // link-back fallback O can send if chain-event discovery is unavailable.
  function renderByowMeta(state, iJoined) {
    const meta = $('byow-meta')
    if (!byow) return
    meta.hidden = false
    const sets = spec.v2.dataSetsOf(state)
    for (const ds of sets) transport.addDataSet(ds)
    const problems = transport.problems()
    const disputes = transport.disputes()
    const lines = [`folded from data set${sets.length === 1 ? '' : 's'} ${sets.map((d) => `#${d}`).join(', ')}`]
    if (state.homes.O != null) lines.push(`${seatNames.X} writes to #${state.homes.X}, ${seatNames.O} writes to #${state.homes.O}`)
    if (fromBlock == null) lines.push('invite has no start block: opponent discovery falls back to the link-back button')
    if (discovery.failed.length > 0) lines.push(`chain scan skipped ${discovery.failed.length} block range(s) (${discovery.failed[0].error})`)
    if (problems.length > 0) lines.push(`cannot read ${problems.map((p) => `#${p.ds} (${p.error})`).join('; ')} — showing last known pieces`)
    if (disputes.length > 0) lines.push(`DISPUTED: ${disputes.length} piece(s) were removed from their data set after this browser saw them; the board keeps them`)
    meta.textContent = lines.join('. ')
    meta.classList.toggle('error', problems.length > 0 || disputes.length > 0)
    $('link-back').hidden = !(iJoined && !state.ratified)
  }

  function statusLine(state, seat, joinable, ratifying, iJoined) {
    if (busy != null && busyStage != null) return `${busy} — ${busyStage}`
    if (busy != null) return `${busy}`
    if (pendingMove != null) {
      const eta = Math.max(0, 60 - Math.round((Date.now() - pendingMove.sentAt) / 1000))
      if (eta > 0) return `move sent — your opponent sees it in ~${eta}s`
      return 'move sent — finalizing on-chain'
    }
    if (lastError != null) return lastError
    if (pendingCreate != null && state.seats.X == null) {
      const eta = Math.max(0, 60 - Math.round((Date.now() - pendingCreate.sentAt) / 1000))
      if (eta > 0) return `game created — you are X once it settles on-chain, ~${eta}s`
      return 'game created — you are X, finalizing on-chain'
    }
    if (ratifying) return `${state.joins.length} joined — your first move seats the first joiner as O`
    if (iJoined && !state.ratified) return 'you joined — X seats you with their first move'
    if (seat != null && seat !== state.next && state.winner == null && state.seats.O != null) {
      return `${status(state)} — you are ${seat}, waiting for your opponent`
    }
    if (seat != null) return `${status(state)} — you are ${seat}`
    if (joinable) return `${status(state)} — join to play`
    return `${status(state)} — spectating`
  }

  const render = () => (gameId == null ? renderLobby() : renderGame())

  // Pieces are immutable and object references are stable across polls
  // (transport caches by CID), so verification memoizes per object.
  const verdicts = new WeakMap()
  async function verifiedPieces(raw) {
    const unseen = raw.filter((p) => p != null && typeof p === 'object' && !verdicts.has(p))
    const results = await verifyAll(unseen)
    unseen.forEach((p, i) => verdicts.set(p, results[i]))
    return raw.map((p) => {
      if (p == null || typeof p !== 'object') return null
      const ok = verdicts.get(p)
      if (ok == null) return null
      if (ok.app !== APP) return null
      // Domain separation. v1: one shared log, so the log id must match this
      // transport's. v2: every piece names its home data set and the fold
      // checks it against where the piece was read from.
      if (!byow) return ok.log === transport.logId ? ok : null
      if (ok.v !== 2) return null
      return ok
    })
  }

  // Discovery through chain events (BYOW only): in a game, find every data
  // set holding a piece tagged with this game id, scanning from the create
  // block in the invite; in the lobby, find recent creates. Pure hints; the
  // fold verifies whatever they point at. Failures show in the meta line.
  async function discoverPeers() {
    if (!byow) return
    try {
      if (gameId != null && fromBlock != null) {
        discovery = await transport.discover({ app: APP, game: gameId, from: fromBlock })
      } else if (gameId == null) {
        discovery = await transport.discover({ app: APP })
      }
    } catch (err) {
      console.error(err)
      discovery = { hints: discovery.hints, failed: [{ error: err?.message?.slice(0, 80) ?? String(err) }] }
    }
  }

  function settlePendingMove(board) {
    if (pendingMove == null) return
    const landed = spec.landed(board, pendingMove)
    if (landed === pendingMove.seat) {
      pendingMove = null
    } else if (landed != null) {
      pendingMove = null
      lastError = 'your move lost a race with another piece — the board has been updated, pick again'
    } else if (Date.now() - pendingMove.sentAt > PENDING_TIMEOUT_MS) {
      pendingMove = null
      lastError = 'your move has not appeared in the log — the board is unlocked, check it and retry'
    }
  }

  async function refresh() {
    await discoverPeers()
    pieces = await verifiedPieces(await transport.list())
    if (gameId != null) {
      const state = foldGame(pieces)
      settlePendingCreate(state)
      settlePendingMove(state.board)
      const oldBoard = prevSnapshot
      if (oldBoard != null && oldBoard.some((cell, i) => cell !== state.board[i])) prevBoard = oldBoard
      prevSnapshot = state.board
    }
    render()
  }

  async function append(payload, label, move = null) {
    if (busy != null) return false // one in-flight append at a time
    busy = label
    busyStage = null
    pendingMove = move
    lastError = null
    render()
    try {
      const signed = await signPiece({ ...payload, app: APP, log: transport.logId }, identity)
      const tags = byow ? tagsFor(APP, payload.game, payload.type) : undefined
      await transport.append(signed, (stage) => {
        busyStage = stage
        render()
      }, tags)
      busy = null
      busyStage = null
      // pendingMove stays until refresh() sees the move in the log
      await refresh()
      return true
    } catch (err) {
      console.error(err)
      busy = null
      busyStage = null
      pendingMove = null
      lastError = `could not save (${err?.message?.slice(0, 120) ?? err}) — try again`
      render()
      return false
    }
  }

  async function newGame(name) {
    const game = `game-${crypto.randomUUID()}`
    // The invite carries the block the game was created after, so joiners'
    // clients and the creator's own scan start there and never earlier.
    const from = byow ? String(await transport.blockNumber()) : null
    const ok = await append({ v: V, type: 'create', game, name }, 'creating game')
    if (!ok) return
    sessionStorage.setItem(PENDING_CREATE_KEY, JSON.stringify({ game, sentAt: Date.now() }))
    if (!byow) {
      location.search = `?game=${encodeURIComponent(game)}`
      return
    }
    location.search = `?game=${encodeURIComponent(game)}&x=${encodeURIComponent(transport.me.ds)}&from=${from}`
  }

  $('create').onclick = () => {
    const name = prompt('Name the game (optional):')?.trim() || undefined
    newGame(name)
  }

  $('join').onclick = async () => {
    const state = foldGame(pieces)
    const payload = byow ? { v: 2, type: 'join', game: gameId, prev: state.lastRef } : { v: 1, type: 'join', game: gameId }
    if (!(await append(payload, `joining as ${seatNames.O}`))) return
    if (byow) {
      // Make this tab's own URL the link-back, so a plain share carries O's data set.
      const url = new URL(location.href)
      url.searchParams.set('o', transport.me.ds)
      history.replaceState(null, '', url)
    }
  }

  const copyButton = (id, text, idle) => {
    $(id).onclick = async () => {
      await navigator.clipboard.writeText(text())
      $(id).textContent = 'copied!'
      setTimeout(() => { $(id).textContent = idle }, 1500)
    }
  }
  copyButton('link-back', () => {
    const url = new URL(location.href)
    url.searchParams.set('o', transport.me.ds)
    return url.toString()
  }, `copy link for ${seatNames.X}`)
  copyButton('share', () => location.href, 'copy invite link')

  $('rematch').onclick = () => newGame('rematch')

  $('notify').onclick = async () => {
    await Notification.requestPermission()
    render()
  }

  // Adaptive polling: quick while a game is live on screen, relaxed in the
  // lobby or on finished games. The countdown re-renders once a second.
  function pollDelay() {
    if (gameId == null) return 12000
    const state = foldGame(pieces)
    if (state.winner != null) return 20000
    return 4000
  }
  async function pollLoop() {
    if (busy == null) await refresh().catch(console.error)
    setTimeout(pollLoop, transport.pollMs != null ? pollDelay() : 60000)
  }
  transport.onChange?.(() => { if (busy == null) refresh() })
  labelEl.textContent = `${transport.label} — loading pieces…`
  await refresh()
  labelEl.textContent = transport.label
  if (transport.pollMs != null) setTimeout(pollLoop, pollDelay())
  setInterval(() => { if ((pendingMove != null || pendingCreate != null) && busy == null) render() }, 1000)
}
