# Feasibility: viewer saves / multiplayer state on FOC session keys

Assessment of the [viewer-saves idea](https://app.notion.com/p/filecoindev/Idea-viewer-saves-for-published-artifacts-session-key-writes-to-FOC-3cddc41950c1819fb40eeb2cbe14263a)
against the actual synapse-sdk (v1.2.1) and filecoin-pin source, 2026-08-31.

**Verdict: buildable and testable today.** Every primitive the design needs
exists and is exercised by code in this repo. One finding materially changes
the mode 1 (publisher-hosted key) risk story: session-key grants are
account-wide, not data-set-scoped. Details below.

## What is verified working, right now

- **The fold.** `games/tic-tac-toe/fold.js` + 11 passing tests
  (`npm test`). Board state is a pure function of the ordered move log;
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
  nothing — the consumer stores it.
- **Writing a move**: `synapse.storage.createContext({ dataSetId })` then
  `ctx.upload(bytes)`. Minimum piece size is **127 bytes**
  (`MIN_UPLOAD_SIZE`), so move JSON is whitespace-padded; max is ~1 GiB.
- **Reading the log**: `ctx.getPieces({ batchSize })` is a cursor-based
  async iterator over `PDPVerifier.getActivePiecesByCursor` — it does
  **not** go through `getActivePieceCount`, so the filecoin-pin **#691 OOG
  is not on our read path**. `ctx.download({ pieceCid })` fetches and
  CID-validates bytes. Read side needs no key at all.
- **Ordering**: the contract assigns piece ids monotonically, so sorting by
  piece id gives every client the same total order. No Merkle-CRDTs, no
  prolly trees: CRDT machinery exists to merge concurrent writes *without*
  an ordering authority, and here the chain is the ordering authority. The
  fold already gives us the determinism CRDTs would buy (state is a pure
  function of the piece log; same-seq conflicts resolve first-piece-wins).
- **No bundler required**: the SDK is ESM-only (no UMD), but loads in the
  browser via esm.sh — which keeps published game pages self-contained
  single files.

## Player identity: signed pieces, not bare tokens

The log is public by construction, so a bare random token as player id
would be copyable by any reader — a game-4 spectator could append moves as
a game-1 player. Instead each browser generates an ECDSA P-256 keypair
(`games/tic-tac-toe/identity.js`): the public key is the token seats are
assigned to, every piece is signed over a canonical serialization that
includes the game id, and every client verifies signatures between
fetching and folding. The private key is generated non-extractable and
persisted in IndexedDB as a CryptoKey (structured clone), so the key BYTES
never exist as text and cannot be exfiltrated. Script that compromises the
page can still ask the key to sign while the page is open — non-
extractability prevents stealing the identity for later use elsewhere, not
in-page abuse. Forged, tampered, and cross-game-replayed pieces
fail verification identically everywhere (tested in `identity.test.js`,
including an end-to-end takeover attempt). Note this is game-level
integrity only: the shared session key still gates who can *write* to the
data set at all, and anyone can still burn the owner's storage spend with
junk pieces — that remains the account-wide-grant problem below.

## The finding that changes the design: grant scope is account-wide

Open question 1 in the idea doc asked whether authorization is add-piece
only, single data set, size-capped. Answer from the SessionKeyRegistry
integration (`synapse-core/src/session-key/permissions.ts`):

- Grants are `(owner, session address, permission-type) → expiry`.
  Permission types are `CreateDataSet`, `AddPieces`,
  `SchedulePieceRemovals`, `TerminateService`. You **can** grant
  `AddPieces` alone — but the grant covers **all of the owner's data
  sets**, not one, and there is **no size or spend cap**.
- Enforcement is on-chain per operation (unauthorized ops revert); the SDK
  only checks `requiredPermissions` at construction.

Consequences:

- **Mode 1** (key embedded in a public page): a leaked key — and it is
  public by construction — can add pieces to *any* of the publisher's data
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
  signers itself "on whatever curve it supports". For this app that means:
  a permissive or sponsored authorizer on just the games data set replaces
  the embedded account-wide session key (blast radius collapses to the one
  data set), per-epoch move cooldowns become contract law, and — if P-256
  recovery proves practical on FEVM — players' existing browser WebCrypto
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
  piece through the unmodified SDK: PieceAdded on-chain 3 seconds after the
  provider stored it. The same key's second write inside the cooldown was
  refused by the chain. What the SDK still lacks, as of `@filoz/synapse-core`
  0.8.1: `setDataSetAuthorizer` is not in its FWSS ABI (the spike hand-rolls
  the call); a session-key account only signs if its local `expirations`
  say it may, so a page using an authorizer passes a far-future expiry
  instead of reading the registry; and the refusal surfaces as an
  undecodable revert from the provider's `addPieces` simulation rather than
  a named error. Metadata- or size-based rules need the authorizer to decode
  `operationData` itself; the Cid struct carries only the CommP bytes, so a
  byte-size cap would parse the multihash. Unlocked by this: sponsored
  writes (no wallet in the browser at all), per-epoch move cooldowns as
  contract law, and a shared team data set for crowd moves (issue #6).

## Test plan (in order, all artifacts in this repo)

1. `npm test` — fold correctness. **Done, green.**
2. `node scripts/spike-save-piece.mjs <dataSetId> '{"hello":1}'` — write a
   JSON piece with a session key (needs a funded wallet + one
   `filecoin-pin session create`; source `config.env` + `.env` first).
3. `node scripts/spike-list-pieces.mjs <dataSetId>` — enumerate + fetch,
   keyless.
4. Add an embedded config block to the page (`<script
   type="application/json" id="foc-config">{ "dataset": <id>, "wallet":
   "<owner>" }</script>`) and serve `games/tic-tac-toe/`. In browser A,
   create a game from the lobby and copy the invite link; in browser B,
   open it and join as O. Session keys are pasted once per browser
   (prompted, stored in localStorage, never in a URL) — or embedded in the
   config for the zero-setup mode 1 demo, throwaway wallet only. Games
   themselves are pieces (`create`/`join`/`move`), so the lobby lists every
   game ever played by folding the same log.
5. Publish the game directory with the repo's `publish` skill and repeat
   step 4 from the published URL — that is the demo to screen-record.

## Costs (demo scale)

Per the idea doc: ~1 USDFC per-data-set lockup plus storage spend
(kilobytes) and gas per move. Each move is one on-chain piece-add, so a
move takes seconds-to-tens-of-seconds to land — fine for turn-based games,
which is exactly why turn-based is the right demo class.
