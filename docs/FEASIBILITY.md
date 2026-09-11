# Feasibility: viewer saves / multiplayer state on FOC session keys

Assessment of the [viewer-saves idea](https://app.notion.com/p/filecoindev/Idea-viewer-saves-for-published-artifacts-session-key-writes-to-FOC-3cddc41950c1819fb40eeb2cbe14263a)
against the actual synapse-sdk (v1.2.1) and filecoin-pin source, 2026-08-31.

**Verdict: buildable and testable today.** Every primitive the design needs
exists and is exercised by code in this repo. One finding materially changes
the mode 1 (publisher-hosted key) risk story: session-key grants are
account-wide, not data-set-scoped. Details below.

## What is verified working, right now

- **The fold.** `games/tic-tac-toe/fold.js` (13 tests; `npm test` runs 109
  across the games, the engine, and the corgi as of 2026-09-11). Board state is a pure function of the ordered move log;
  illegal, out-of-turn, duplicate-seq, and garbage pieces are ignored
  identically by every client. This is the entire "game server."
- **The game UI.** `games/tic-tac-toe/index.html` plays today over a local
  transport (two tabs), exercising the exact fold the FOC transport uses.

## What the SDK provides (confirmed in source, spike scripts written)

- **Session-key browser path exists and is documented**
  (synapse-sdk `docs/.../developer-guides/session-keys.mdx`):
  `fromSecp256k1({ privateKey, root: ownerAddress, transport })` from
  `@filoz/synapse-core/session-key`, then `Synapse.create({ account: owner,
  sessionKey, ... })`. Two gotchas: call `sessionKey.syncExpirations()`
  before `Synapse.create` (it validates permissions), and a bare-address
  `account` requires wrapping the transport in viem's `custom()`.
- **Minting/authorizing keys is a solved CLI flow**: `filecoin-pin session
  create --validity-days N` (single-party), `session generate` +
  `session authorize <address>` (two-party BYOW), `session revoke`.
  The CLI prints `SESSION_KEY` (a plain secp256k1 private key) and persists
  nothing; the consumer stores it.
- **Writing a move**: `synapse.storage.createContext({ dataSetId })` then
  `ctx.upload(bytes)`. Minimum piece size is **127 bytes**
  (`MIN_UPLOAD_SIZE`), so move JSON is whitespace-padded; max is ~1 GiB.
- **Reading the log**: `ctx.getPieces({ batchSize })` is a cursor-based
  async iterator over `PDPVerifier.getActivePiecesByCursor`; it does
  **not** go through `getActivePieceCount`, so the filecoin-pin **#691 OOG
  is not on our read path**. `ctx.download({ pieceCid })` fetches and
  CID-validates bytes. Read side needs no key at all.
- **Ordering**: the contract assigns piece ids monotonically, so sorting by
  piece id gives every client the same total order. No Merkle-CRDTs, no
  prolly trees: CRDT machinery exists to merge concurrent writes *without*
  an ordering authority, and here the chain is the ordering authority. The
  fold already gives us the determinism CRDTs would buy (state is a pure
  function of the piece log; same-seq conflicts resolve first-piece-wins).
- **Browser loading**: the SDK is ESM-only (no UMD). The 2026-08-31 spike
  loaded it through esm.sh; the pages are built with esbuild
  (`scripts/build-page.mjs` bundles the SDK into `vendor-foc.js` and
  copies `games/lib` next to the page), so a built page is a directory
  with no runtime CDN.

## Player identity: signed pieces, not bare tokens

The log is public by construction, so a bare random token as player id
would be copyable by any reader: a game-4 spectator could append moves as
a game-1 player. Instead each browser generates an ECDSA P-256 keypair
(`games/lib/identity.js`): the public key is the token seats are
assigned to, every piece is signed over a canonical serialization that
includes the game id, and every client verifies signatures between
fetching and folding. The private key is generated non-extractable and
persisted in IndexedDB as a CryptoKey (structured clone), so the key BYTES
never exist as text and cannot be exfiltrated. Script that compromises the
page can still ask the key to sign while the page is open; non-
extractability prevents stealing the identity for later use elsewhere, not
in-page abuse. Forged, tampered, and cross-game-replayed pieces
fail verification identically everywhere (tested in `identity.test.js`,
including an end-to-end takeover attempt). Note this is game-level
integrity only: the shared session key still gates who can *write* to the
data set at all, and anyone can still burn the owner's storage spend with
junk pieces; that remains the account-wide-grant problem below.

**Update 2026-09-11: in BYOW the seat belongs to the data set, not the
token.** Writing to a data set already requires its owner's session key,
so the data set is the player; the token proves only that a piece was
not altered in flight. `games/lib/byow-engine.js` compares `src` and
`homes` for joins, ratification, and moves, and a page learns its seat
with `seatOfHome(state, myDataSet)`. The same wallet in another browser
(a new token, the same data set) is the same player. Tokens still own
seats in the v1 shared-log fold, where every writer shares one key. The
one BYOW case where the token distinguishes writers is a solo game: a
`create` piece carrying `cpu` (the token of a second identity in the
creator's browser) seats both players in the root data set, where piece
id is a total order.

## The finding that changes the design: grant scope is account-wide

Open question 1 in the idea doc asked whether authorization is add-piece
only, single data set, size-capped. Answer from the SessionKeyRegistry
integration (`synapse-core/src/session-key/permissions.ts`):

- Grants are `(owner, session address, permission-type) → expiry`.
  Permission types are `CreateDataSet`, `AddPieces`,
  `SchedulePieceRemovals`, `TerminateService`. You **can** grant
  `AddPieces` alone, but the grant covers **all of the owner's data
  sets**, not one, and there is **no size or spend cap**.
- Enforcement is on-chain per operation (unauthorized ops revert); the SDK
  only checks `requiredPermissions` at construction.

Consequences:

- **Mode 1** (key embedded in a public page): a leaked key (and it is
  public by construction) can add pieces to *any* of the publisher's data
  sets and grow the publisher's storage spend until expiry. Blast radius is
  the account, not the guestbook. Mitigation that works today: mint the key
  from a **dedicated throwaway wallet** holding only demo-scale funds, with
  short validity. That makes mode 1 demoable now, honestly.
- **Mode 2** (BYOW) is unaffected: whoever writes, pays and owns.
- filecoin-pin **#690** (session revocation broken) stays a hard
  prerequisite for any non-throwaway mode 1, exactly as the idea doc says.
- **Update 2026-09-01: the contract-level fix exists and is shipping.**
  FilOzone/filecoin-services#536 ("Optional dataset-level programmable
  acls", merged 2026-08-20, in the Calibnet v1.4.0 deployment, mainnet
  release in progress) lets a payer attach an `IDataSetAuthorizer` to one
  data set; FWSS then delegates that data set's entire write-authorization
  decision to it. The authorizer is state-mutating (can rate-limit,
  consume nonces, cap piece counts/sizes via `operationData`) and recovers
  signers itself on whatever curve it supports (quoting the interface). For this app that means:
  a permissive or sponsored authorizer on just the games data set replaces
  the embedded account-wide session key (blast radius collapses to the one
  data set), per-epoch move cooldowns become contract law, and, if P-256
  recovery proves practical on FEVM, players' existing browser WebCrypto
  identities could authorize writes directly, with no shared key at all.
  An `ExampleSponsoredDataSet` authorizer (exactly the publisher-sponsors-
  anyone-writes pattern) landed as #540 and was reverted only for release
  hygiene (#599); expect it back after the release. Remaining gaps: SDK/
  filecoin-pin tooling support, and the payer still funds all writes, so
  spend caps belong in the authorizer.

- **Update 2026-09-11: proven on calibration.** `scripts/spike-authorizer.mjs`
  deployed `contracts/authorizer/src/CooldownAuthorizer.sol` (payer may do
  anything; any other secp256k1 key may AddPieces, at most one piece per
  operation and once per 20 epochs per signer) at
  `0x3b129f01bd364c2306445b55b005aad3295d1aa1`, created data set 35407, and
  attached it with `FilecoinWarmStorageService.setDataSetAuthorizer` (live in
  the calibnet v1.4.0 deployment at `0x02925630df557F957f70E112bA06e50965417CA0`).
  A key generated seconds earlier, never registered anywhere, then wrote a
  piece through the unmodified SDK; the provider accepted and submitted
  the AddPieces transaction 3 seconds after storing the piece (the SDK's
  `onPiecesAdded` fires on submission, not confirmation; issue #7 measures
  the rest). The same key's second write inside the cooldown was refused
  by the chain. As of `@filoz/synapse-core` 0.8.1 the spike script does
  three things itself, and a page using an authorizer would too: it calls `setDataSetAuthorizer` with a hand-written ABI
  entry (the function is not in the SDK's FWSS ABI); it passes a far-future
  `expirations` value to the session-key account, since that account signs
  only when its local expirations allow and an authorizer key is not in the
  registry; and it treats an unnamed revert from the provider's `addPieces`
  simulation as the refusal signal. Metadata- or size-based rules need the authorizer to decode
  `operationData` itself; the Cid struct carries only the CommP bytes, so a
  byte-size cap would parse the multihash. Unlocked by this: sponsored
  writes (no wallet in the browser at all), per-epoch move cooldowns as
  contract law, and a shared team data set for crowd moves (issue #6).

## Test plan (in order, all artifacts in this repo)

This plan covers the shared-log build (schema v1, a publisher session key
in the page). The site's BYOW build (schema v2, no key in any page) has
its own proofs: `npm run proof:byow`, `npm run test:e2e:byow`, and
`npm run test:e2e:wallet`, described in
`research/2026-09-10-byow-proof-plan.md`.

1. `npm test`: fold correctness. **Done, green.**
2. `node scripts/spike-save-piece.mjs <dataSetId> '{"hello":1}'`: write a
   JSON piece with a session key (needs a funded wallet + one
   `filecoin-pin session create`; source `config.env` + `.env` first).
3. `node scripts/spike-list-pieces.mjs <dataSetId>`: enumerate + fetch,
   keyless.
4. Build the page with a config naming the shared data set
   (`node scripts/build-page.mjs <dir> <config.json>`; the builder embeds
   it as the `foc-config` JSON block and bundles the SDK) and serve the
   built directory. In browser A,
   create a game from the lobby and copy the invite link; in browser B,
   open it and join as O. Session keys are pasted once per browser
   (prompted, stored in localStorage, never in a URL), or embedded in the
   config for the zero-setup mode 1 demo, throwaway wallet only. Games
   themselves are pieces (`create`/`join`/`move`), so the lobby lists every
   game ever played by folding the same log.
5. Publish the game directory with the repo's `publish` skill and repeat
   step 4 from the published URL; that is the demo to screen-record.

## Costs (demo scale)

Per the idea doc: ~1 USDFC per-data-set lockup plus storage spend
(kilobytes) and gas per move. Each move is one on-chain piece-add.
Measured on the site, a move shows on the other side about a minute
after it is sent (`research/2026-09-01-expansion-synthesis.md` puts the
per-write fee near $0.011; issue #7 tracks where the minute goes). Fine
for turn-based games, which is why turn-based is the demo class. One data
set per wallet serves every game, and a solo game against the computer
adds only its own pieces to it.
