# Social/media cluster — feature feasibility on FOC

2026-09-01. Covers: (1) guestbook / viewer-saves for published artifacts,
(2) internet jukebox / collaborative playlist, (3) append-only wiki
("The Archive"), (4) shared whiteboard. All claims verified in source;
paths are relative to `/Users/sgtpooki/code/work/filoz/`.

Substrate assumed: signed JSON pieces on a shared data set, client-side
fold, ~30-60s visibility, per-data-set state-mutating authorizer
(filecoin-services#536, calibnet v1.4.0), payer funds storage, FilBeam
CDN egress exists.

## Headline findings (the critical questions)

### 1. Retrieval UX at consumer scale — reads are fine, LISTING is the bottleneck

Two keyless retrieval paths per piece:

- **FilBeam CDN** when the data set has `withCDN`:
  `https://{payerAddr}.{net}.filbeam.io/{pieceCid}`
  (`filozone/synapse-sdk/packages/synapse-core/src/utils/piece-url.ts:38-45`).
- **Direct SP**: `GET {serviceURL}/piece/{cid}`
  (`piece-url.ts:71-74`).

CDN egress is metered **per data set**, with separate cache-hit vs
cache-miss quotas, billed by volume to the **payer**
(`filozone/synapse-sdk/packages/synapse-sdk/src/filbeam/service.ts:22-23,
94-125`). Consumer reads are CDN-grade for hot content, but every
anonymous reader spends the publisher's egress quota — there is no
per-reader billing surface.

Listing is the problem. `getPieces` is a cursor walk over
`PDPVerifier.getActivePiecesByCursor` in pages of 100 that returns only
`{id, cid, url}`, with scheduled removals filtered client-side
(`synapse-core/src/pdp-verifier/get-pieces.ts:76-121`). filecoin-pin's
`iterateDataSetPieces` is the same walk plus SP-side reconciliation
(`filecoin-project/filecoin-pin/src/core/data-set/get-data-set-pieces.ts:38-56`).

There is **no metadata filter and no way to read piece metadata back at
all**: FWSS only *emits* `PieceAdded` with the keys/values — the code
comment says "Metadata is indexed off-chain from this event"
(`filozone/filecoin-services/service_contracts/src/FilecoinWarmStorageService.sol:839,
872`) — and the StateView exposes only **data-set-level** metadata
getters (`FilecoinWarmStorageServiceStateView.sol:42-99`), nothing
per-piece. Clients must enumerate everything and fetch piece bodies to
know what a piece is.

**Verdict: GAP — metadata-filtered piece listing (indexer/subgraph read
in the SDK).**

### 2. Deletion / GDPR — user-initiated removal is a PATTERN, with one attribution wrinkle

Removals **do** route through the authorizer.
`verifySchedulePieceRemovalsAuthorization` forwards the requester's raw
signature, the EIP-712 digest, and
`operationData = abi.encode(clientDataSetId, pieceIds)` to
`IDataSetAuthorizer.isAuthorized`
(`filozone/filecoin-services/service_contracts/src/lib/SignatureVerificationLib.sol:247-278`;
callback entry at `FilecoinWarmStorageService.sol:876-898`). The
authorizer recovers the signer itself "on whatever curve it supports"
(`interfaces/IDataSetAuthorizer.sol:16-21`), so "you may remove pieces
you authored" is expressible.

The wrinkle: at **add** time the authorizer sees
`(clientDataSetId, nonce, pieceCids, metadata)` but **not** the assigned
piece ids (`SignatureVerificationLib.sol:242` — `pieceDataArray` only;
ids are assigned by PDPVerifier and reach FWSS as `firstAdded`,
`FilecoinWarmStorageService.sol:777, 782`). A removal authorizer must
therefore resolve pieceId→CID at removal time (isAuthorized is
state-mutating with a 150M gas ceiling,
`SignatureVerificationLib.sol:298-301`, so it can call PDPVerifier
views) against a cid→author record it kept at add time. Workable
PATTERN; ugly.

The SDK transport already exists: `deletePieces` signs with
`sessionClient ?? client` and submits via Curio's DELETE endpoint
(`filozone/synapse-sdk/packages/synapse-sdk/src/storage/context.ts:1244-1265`).
Constraints:

- Max 35 pieces per request; requests are rejected (429) while 35+
  removals are queued on-chain, and the queue drains only at the next
  proving period (`context.ts:1239-1242`). "Erase my 200 comments"
  takes multiple proving periods.
- Each `schedulePieceRemovals` call costs the payer $0.007
  (`lib/PriceListUSDFC.sol:39`).

GDPR caveats: removal is un-storage, not erasure of history already
replicated by readers; and the payer can always rotate the authorizer
(`setDataSetAuthorizer`, `FilecoinWarmStorageService.sol:1540-1543`), so
deletion guarantees are policy-of-the-payer, not protocol.

### 3. Media embeds — sizes fine, economics and streaming are the issues

Limits: `MIN_UPLOAD_SIZE` 127 B, `MAX_UPLOAD_SIZE` 1,065,353,216 B
(1 GiB × 127/128)
(`filozone/synapse-sdk/packages/synapse-core/src/utils/constants.ts:83-86`),
enforced at upload (`sp/upload.ts:40`,
`sp/upload-streaming.ts:120-133`). Images/audio fit trivially; even
video fits under 1 GiB per piece.

What actually breaks:

- Each embed is a separate on-chain piece-add paid by the **payer**
  (per-piece ADD_PIECES fee taken at `FilecoinWarmStorageService.sol:824`);
  sponsored writes mean anyone can grow the bill.
- 30-60 s visibility: "attach image" flows need optimistic local
  preview.
- The CDN serves whole pieces by CID — no range/transcode semantics in
  the SDK surface, so jukebox audio means whole-file fetch or app-level
  chunked pieces.

### 4. Multi-tenant — shared log wins today; per-tenant data sets are the right shape but too expensive

- Per-site data set: $0.025 creation fee (`lib/PriceListUSDFC.sol:36`)
  plus the ~1 USDFC lifecycle lockup per data set (capability-matrix
  GAP "cheap many-small-datasets pricing"). Buys: independent
  authorizer, independent CDN quota, payer-scoped blast radius, clean
  tenant offboarding (terminate the data set).
- Shared log with domain-separated pieces (`app`/`log` fields — already
  a repo rule) buys ~zero marginal cost per tenant, but one authorizer
  must multiplex tenant policy from `operationData`, one CDN egress
  bucket serves everyone, and one payer holds removal rights across all
  tenants — a GDPR and abuse-isolation smell.

For white-label (direction C) per-tenant data sets are correct; the
lockup cost is the blocker.

## Per-idea assessment

Directions: **A** richer product, **B** economy, **C**
enterprise/platform. Status: SHIPPED / PATTERN / GAP.

### Guestbook / viewer notes (the origin idea)

- **A (threads, media, moderation, search).** Core append + fold +
  P-256 identity: SHIPPED (per docs/FEASIBILITY.md; the authorizer
  replaces the account-wide session key). Threading and media: PATTERN
  (reply-to CID in the JSON body; media as separate pieces).
  Moderation: PATTERN — authorizer blocklists are legal because
  `isAuthorized` is state-mutating (`IDataSetAuthorizer.sol:8-10`);
  post-hoc takedown is payer-initiated removal, fine since the payer IS
  the site owner. Search: **GAP** (finding 1 — no metadata read path).
- **B (tips, paid pins, curation stakes).** Tips: plain wallet
  transfers, SHIPPED. Paid pin/priority: PATTERN — the authorizer can
  require a payment proof in `operationData`, but there is no native
  pay-to-write rail. Escrow/stakes: **GAP** (capability matrix).
- **C (comments-for-any-site widget).** The strongest enterprise story
  in the cluster. Needs: per-tenant data sets (blocked by lockup,
  finding 4); user-initiated deletion (PATTERN, finding 2);
  sponsored-writes authorizer restored (**GAP** — #540 merged, reverted
  in #599 for release hygiene); an embeddable read path that does not
  enumerate the world (**GAP**, finding 1). WebAuthn/P-256 signer
  recovery (anticipated by the authorizer payload sizing; gas unproven)
  would make commenters wallet-free — the make-or-break UX ask.

### Internet jukebox / collaborative playlist

- **A.** Enqueue pieces + player page: SHIPPED pattern (tic-tac-toe
  with a catalog fold). Catalog constraint: PATTERN — the authorizer
  gates on `operationData` contents (piece-CID allowlist of licensed
  tracks, `IDataSetAuthorizer.sol:18-21`). Audio serving via FilBeam by
  CID works; no range requests exposed → seek/streaming **GAP** at the
  SDK level.
- **B.** Pay-to-skip / priority queue: PATTERN (fee-in-authorizer);
  tips SHIPPED. Licensing is a legal problem, not a substrate one — the
  catalog allowlist is exactly the mitigation.
- **C.** White-label venue jukebox: same per-tenant economics as
  guestbook C; low enterprise pull. Treat as a builder-story demo
  (matches build-order item 5).
- **Biggest risk:** CDN egress is payer-billed (finding 1) — a popular
  jukebox is an unbounded bandwidth bill with no monetization hook.
  Needs per-reader or sponsored egress.

### Append-only wiki ("The Archive")

- **A.** Entries-fold-to-pages: SHIPPED pattern; revision history is
  free (the log IS the history). Search/backlinks: **GAP** (finding 1)
  — without an index read every client folds the whole wiki; snapshot
  pieces (PATTERN per the matrix) are mandatory at any real size, plus
  IndexedDB piece caching (localStorage ~5 MB is too small).
- **B.** Curation stakes / article bounties: **GAP** (escrow custody).
  Tip-the-editor: SHIPPED.
- **C.** The interesting framing: an append-only, retention-locked
  knowledge base is the compliance/provenance story (payer-as-contract
  endowment/WORM pattern from the build-order doc). But GDPR and
  "no deletes" are in direct tension — the honest C story is
  "auditable corporate record", not "public wiki".

### Shared whiteboard

- **A.** One stroke per epoch: SHIPPED pattern; cooldown-as-contract-law
  via the state-mutating authorizer is a SHIPPED capability. It is
  Paint War with free-form strokes and shares its entire checklist
  (blocklist, budget, snapshots, timelapse). Recommend **not** building
  it separately — fold into the Paint War birthday scope or sequence
  after.
- **B/C.** Same shape as guestbook B/C, weaker pull. Skip.

## Top 5 missing features for this cluster (ranked)

1. **Metadata-filtered piece listing / indexed reads in the SDK**
   (subgraph-backed `getPieces({metadata})`). Blocks search,
   threads-by-page, per-tenant views — every A direction. Piece
   metadata today is emit-only (`FilecoinWarmStorageService.sol:839`;
   StateView has no per-piece getter).
2. **Sponsored-writes example authorizer restored + SDK ergonomics**
   for `setDataSetAuthorizer` and authorizer-mediated writes
   (#540/#599). Zero-onboarding writers is the precondition for every
   consumer idea here.
3. **WebAuthn/P-256 signer recovery proven on FEVM** (payload sizing
   already anticipates "perms + WebAuthn + P256"). Wallet-free
   commenters/players; the single biggest UX unlock for direction C.
4. **Cheap many-small-datasets** (reduce/waive the ~1 USDFC lockup;
   batch creation). Unlocks per-tenant isolation for white-label C.
   The $0.025 creation fee is fine; the lockup is not.
5. **Author-attributed removal made first-class** — surface assigned
   pieceIds to the authorizer at add time so "delete your own piece"
   avoids the cid-mapping contortion of finding 2 — plus
   **per-reader/sponsored CDN egress billing** (FilBeam quotas are
   payer-only today, `filbeam/service.ts:22-23`) as the economic half
   of consumer scale.

## Build recommendation

Guestbook first (origin idea; exercises features 1-3; its C direction
is the enterprise wedge). Jukebox second as the builder story. Wiki
only in its compliance-record framing. Whiteboard merged into Paint
War.
