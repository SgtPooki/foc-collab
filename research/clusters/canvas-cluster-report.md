# Canvas cluster feasibility report

2026-09-01. Feature-feasibility analysis for the shared-canvas idea cluster on
Filecoin Onchain Cloud: (1) paint war, (2) Proof-of-Attendance Mosaic Race,
(3) Conway's Life seeding event, (4) plot auctions as a layer inside the
canvas. Companion to `../2026-09-01-build-order-and-capability-matrix.md` and
`../2026-09-01-acl-games-strategy.md`. Every SHIPPED/GAP call below was
verified against source; citations are to:

- FWSS = `filozone/filecoin-services/service_contracts/src/FilecoinWarmStorageService.sol`
- SigLib = `filozone/filecoin-services/service_contracts/src/lib/SignatureVerificationLib.sol`
- IAuth = `filozone/filecoin-services/service_contracts/src/interfaces/IDataSetAuthorizer.sol`
- Prices = `filozone/filecoin-services/service_contracts/src/lib/PriceListUSDFC.sol`
- Rails = `filozone/filecoin-services/service_contracts/src/lib/Rails.sol`
- PDPV = `filozone/filecoin-services/service_contracts/lib/pdp/src/PDPVerifier.sol`
- SDK = `filozone/synapse-sdk/packages/`

Legend: **SHIPPED** (works with current contracts+SDK), **PATTERN** (possible
today with custom contracts or app-level code), **GAP** (needs a
filecoin-services, filecoin-pay, or SDK feature).

## Corrections to assumed facts

Two claims circulating in the planning docs do not survive contact with the
code:

1. **CreateDataSet is NOT authorizer-gated.** The authorizer path exists for
   exactly three operations: AddPieces (SigLib:235), SchedulePieceRemovals
   (SigLib:269), and TerminateService (SigLib:295). CreateDataSet always goes
   through the payer/session-key signature check
   (`verifyCreateDataSetSignature`, SigLib:191-210; FWSS wrapper at
   FWSS:1460) — logically necessary, since no dataSetId exists yet to look up
   an authorizer for. Consequence: an authorizer can never gate who spins up
   new event canvases. Canvas creation is and remains a payer-side decision;
   any "self-serve event creation" product is an app/payer-contract layer.

2. **"1 USDFC lockup per data set" is really ~0.62 USDFC + fees.** The fixed
   lockup at creation is `DATASET_FEE_PER_MONTH * DEFAULT_LOCKUP_PERIOD /
   EPOCHS_PER_MONTH + LIFECYCLE_RESERVE_TARGET` = 0.12 + 0.50 = 0.62 USDFC
   (Rails:57; Prices:20,43-46), plus a one-time $0.025 creation fee
   (Prices:37) and an ongoing $0.12/month dataset fee (Prices:20). 100 event
   canvases ≈ $62 locked (recoverable at teardown), $2.50 in creation fees,
   $12/month burn. Per-event data sets are affordable; **the real cost driver
   for canvas games is per-write operation fees, not lockups** (see
   Throughput & economics).

## Verified substrate facts shared by all four ideas

### What the authorizer sees (the coordinates question)

For AddPieces, FWSS forwards
`abi.encode(clientDataSetId, nonce, pieceDataArray, allKeys, allValues)` as
`operationData` (SigLib:242), and the interface documents metadata-based ACLs
as an intended use (IAuth:19-22). So the authorizer sees:

- every piece CID in the batch,
- every per-piece metadata entry,
- the digest and raw signature (it recovers the signer itself, on any curve —
  IAuth:16-18),
- and for removals, the piece ids (SigLib:276).

It does **not** see piece content — only the CID commitment is on-chain. So:

> **Pixel coordinates are visible to the authorizer only if declared in
> pieceMetadata, and the authorizer cannot verify the declaration matches the
> actual piece bytes.**

Region/coordinate enforcement is therefore a two-half PATTERN:

1. authorizer gates on declared coords/action-type in pieceMetadata
   (allowlist, region ownership, cooldown per region);
2. the client fold discards any piece whose decoded content coords mismatch
   its signed metadata (the metadata is part of the signed AddPieces struct,
   PIECE_METADATA_TYPEHASH SigLib:26-27, so a mismatch is provable cheating
   by that signer, not tampering).

Half 2 is advisory in the sense that a client that skips it renders wrong
state — same trust model as the fold itself. The metadata budget fits
coordinates comfortably: max 3 keys/piece, key ≤32 bytes, value ≤96 bytes
(FWSS:226-229, enforced FWSS:852-869). E.g. `region="x12y34-x15y37"`,
`kind="pixel"`, `snapshot=""` all fit.

### Authorizer mechanics

- `setDataSetAuthorizer(dataSetId, authorizer)`: payer-only, target must be a
  deployed contract or address(0), rotatable (FWSS:1540-1545); auto-cleared
  on data set teardown (FWSS:748).
- `isAuthorized` is state-mutating, capped at 150M gas, behind a
  transient-storage reentrancy latch (SigLib:301,306-318,330). Nonces,
  cooldowns, quotas, registries, and external reads (e.g. of an auction
  contract) are all in budget.
- `dataSetId` is a call parameter (IAuth:24-31), so **one deployed authorizer
  can serve unlimited data sets** — the natural multi-tenant/white-label
  pattern; no per-event deployment needed.
- `isAuthorized` is nonpayable and called by FWSS, so it cannot take payment
  in-line; monetization lives in the authorizer's own separately-called
  functions (`buyPass`, `upgradeTier`) whose state `isAuthorized` reads.

### Throughput & economics (the batching tension)

- **Batching is SHIPPED — per signer.** `piecesAdded` accepts a
  `Cids.Cid[]` batch (FWSS:782), the SDK has a `PieceBatchingService`
  (SDK synapse-sdk/src/storage/piece-batching.ts) that coalesces uploads into
  one addPieces tx, and the message cap is 64 KiB − 288 bytes
  (SDK synapse-core/src/utils/constants.ts:101) — hundreds of pieces per tx.
- **But one signature per addPieces call** (extraData decodes a single
  `(nonce, keys, values, signature)`, FWSS:796): all pieces in a batch share
  one chain-level signer. Therefore:
  - If per-player limits are enforced **at the authorizer via chain
    signatures** (the r/place cooldown as contract law), each player action is
    its own tx: $0.008 base + $0.003/piece op fee (Prices:38-39) ≈
    **$0.011 per pixel**. 100k contested pixels ≈ $1,100 in op fees alone,
    plus one SP-submitted tx each.
  - If chain writes go through **one shared session key** with player
    identity as app-level P-256 signatures inside the JSON (foc-collab's
    current model), batching amortizes to ≈ $0.003/pixel — but cooldowns
    become client/relay-advisory, not contract-enforced.
  This tension is the cluster's #1 gap (see ranking).
- Nonces are client-chosen with a used-nonce map, not sequential (FWSS:279,
  799-802) — concurrent writers do not serialize on nonce.
- No per-epoch piece-count cap exists in FWSS or PDPVerifier; the throughput
  bound is the SP (Curio) tx pipeline plus 30s blocks and the documented
  30-60s write visibility. `MAX_ENQUEUED_REMOVALS = 2000` (PDPV:48,815) caps
  a single moderation sweep's pending removals.
- Piece size bounds: min 127 bytes, max ~1 GiB
  (SDK synapse-core/src/utils/constants.ts:83-86). Tiny pixel pieces are fine.

### SDK surface

- **Authorizer support is a GAP, confirmed.** "authorizer" appears only in
  the generated ABI (SDK synapse-core/src/abis/generated.ts). No
  `setDataSetAuthorizer` helper, no authorizer-aware write path. Signing is
  `sessionClient ?? client` throughout (SDK synapse-sdk/src/storage/
  context.ts:967); accepting an arbitrary-curve player signature that a
  custom authorizer would verify means hand-rolling extraData with
  synapse-core's typed-data module and calling `SP.addPieces` directly —
  possible (the store/presign/commit split exists) but unergonomic.
- **Reads are SHIPPED**: `getPieces` cursor async-generator
  (SDK synapse-sdk/src/storage/context.ts:1194), `getActivePiecesByCursor`
  (SDK synapse-sdk/src/warm-storage/service.ts:291), SP-agnostic download,
  FilBeam CDN.
- **Naming trap**: `synapse-core/src/auction/` is the FilecoinPay
  protocol-fee Dutch auction (fees sold for FIL, price decays 75%/week) —
  nothing to do with plot auctions. Do not let the module name mislead
  planning or estimation.

## Idea 1 — Paint war

### Direction A: richer product/gameplay

| Feature | Status | Evidence / pattern |
|---|---|---|
| Timelapse / replay | SHIPPED | The piece log is the product: cursor reads (context.ts:1194) + download/FilBeam. |
| Accurate frame timing (piece → epoch) | PATTERN | `PiecesAdded` events via eth_getLogs/wss; no SDK helper (GAP #5). |
| Teams / factions | PATTERN | Authorizer role registry (the peer review's "Palette Duty"); or app-level in the fold. |
| Big canvases / late join | PATTERN | Snapshot pieces. New verified twist: the authorizer CAN restrict `snapshot`-tagged metadata pieces to the admin signer (it recovers signers and sees metadata, SigLib:242), making snapshot **authorship** tamper-resistant on-chain. Snapshot **correctness** stays unverifiable (a fold check is far beyond any gas budget) — the documented centralization point stands. |
| Live spectating | SHIPPED with caveat | 30-60s visibility; wss log subscription lowers perceived latency (PATTERN, client work). |
| Contested-pixel UX | PATTERN | Optimistic-pending + lost-the-race semantics, per peer-review correction 3; pure app work. |

### Direction B: economy/monetization

| Feature | Status | Evidence / pattern |
|---|---|---|
| Paid cooldown reduction, brushes, flair | PATTERN | Pass/tier registry in the authorizer; players call `buyPass{value}` directly (isAuthorized is nonpayable, called by FWSS — money never moves in-line). Fees route to the payer wallet to offset sponsored storage. |
| Plot rental | PATTERN | Region registry in authorizer + declared-coords gating (two-half pattern above). |
| Sybil-priced entry (fee gate) | PATTERN | One-time entry fee into the pass registry — also the peer review's recommended Sybil policy. |
| Prize pools / team treasuries with neutral custody | GAP | No escrow primitive in filecoin-pay (rails are payer→payee with operators); custom custody contract required (ask #3). |

### Direction C: enterprise/scale/multi-tenant

| Feature | Status | Evidence / pattern |
|---|---|---|
| White-label event canvases | SHIPPED mechanics | One parametric authorizer serves all data sets (dataSetId param, IAuth:24); per-event data sets at ~$0.65 upfront + $0.12/mo each. |
| Self-serve event creation gated by contract | Not possible via authorizer | CreateDataSet is not authorizer-gated (correction 1); needs a payer-side factory contract — PATTERN. |
| Thousands of concurrent writers with contract-enforced limits | GAP | One tx + ~$0.011 per player action (batching tension above). Ask #1. |
| Operator tooling (attach authorizer, rotate, monitor) | GAP | SDK has ABI only (ask #2). |

## Idea 2 — Proof-of-Attendance Mosaic Race

### Direction A: richer product/gameplay

- Region rights by registry/allowlist: PATTERN — organizer writes the
  attendee allowlist into the authorizer, or the authorizer verifies an
  event-issuer signature in-call (150M gas covers even a Solidity P-256
  verify at the ~150-500k estimate from the peer review). WHERE an attendee
  may paint uses the declared-coords two-half pattern — no protocol change,
  but it must be designed in from day one.
- Race mechanics (first-team-to-fill, streaks): SHIPPED substrate — pure
  fold logic over the same pieces.
- Multi-venue simultaneous canvases: SHIPPED — one data set per venue, one
  authorizer.

### Direction B: economy/monetization

- Sponsored tiles / paid region unlocks: PATTERN, same authorizer-registry
  shape as paint war.
- Sponsor-funded storage: SHIPPED by construction — the payer funds
  everything; "this canvas brought to you by X" is just whose wallet pays.
- Attendance-token resale/transfer markets: PATTERN (the "Cooldown Swap
  Meet" shape — transferable entitlements in authorizer state), custody-free.

### Direction C: enterprise/scale/multi-tenant

Strongest enterprise fit in the cluster: one parametric authorizer + one data
set per event + one payer wallet is a conference-platform architecture with
no protocol gaps. What's missing is purely ergonomics: SDK authorizer
helpers, a non-session-key signer path (both GAP, ask #2), and an operator
dashboard (app work). Per-event economics are a non-issue at hundreds of
events (correction 2).

## Idea 3 — Conway's Life seeding event

The cheapest of the four; its billing as the paint-war rehearsal holds up in
code.

- **A (gameplay):** one-claim-per-key = minimal nonce/quota authorizer —
  PATTERN. Seeding-window close = authorizer checks block.timestamp and
  rejects claim-tagged pieces after epoch X — PATTERN, fully trustless phase
  gating, nothing new needed. Deterministic fireworks playback = pure client
  fold — SHIPPED substrate. Variants (larger boards, multiple seeds per paid
  tier, generation-snapshot pieces) reuse paint-war patterns verbatim.
- **B (economy):** paid extra seeds / sponsor patterns — pass-registry
  PATTERN. Nothing else to monetize; correctly scoped as a teaser.
- **C (scale):** recurring seasonal events — per-event data sets, economics
  fine; same multi-tenant authorizer. No idea-specific GAPs beyond the
  shared SDK ergonomics one.

## Idea 4 — Plot auctions (layer inside the canvas)

### Does commit-reveal need anything on-chain? Mostly no.

The bid mechanics themselves need nothing: commit = a signed piece carrying
`hash(bid ‖ salt)`, reveal = a later piece with the preimage; both are
ordinary pieces, and piece-id order gives a total order. What DOES touch
chain:

1. **Phase deadlines** — two options, both PATTERN:
   - client-side, from `PiecesAdded` event epochs (weaker: relies on log
     reads every client must perform; SDK gap #5);
   - on-chain, the authorizer timestamp-gates `bid`/`reveal`-tagged metadata
     (sees metadata per SigLib:242, sees block.timestamp) — trustless, and
     the recommended shape.
2. **Money.** This is the real question — next section.

Free-stakes auctions (reputation/bragging rights) need no contract at all.

### Escrow custody

filecoin-pay has **no neutral escrow or conditional-release primitive**:
rails are payer→payee streams with operator approvals, and the only auction
in the stack is the protocol-fee Dutch auction
(SDK synapse-core/src/auction/auction.ts). Real-money bids therefore mean a
**custom auction contract holding USDFC** — PATTERN, but security-heavy
custody code, matching the strategy docs' caution and the "auction deferred"
birthday scope cut.

The clean composition once such a contract exists:

- reveals are submitted directly to the auction contract (a sealed-bid max
  is trivial on-chain — no fold needed for winner determination);
- the canvas authorizer reads plot ownership from the auction contract
  inside `isAuthorized` (external calls fine within 150M gas);
- winner-gets-region enforcement then rides the declared-coords two-half
  pattern, end to end PATTERN.

Micro-stakes are fine economically — bids are plain ERC-20 transfers to the
auction contract, not rails, so no per-bid lockup mechanics apply.

### Directions

- **A (gameplay):** blind vs. open auctions, team bidding, Dutch/candle
  formats — all fold + authorizer-phase-gating PATTERN; format choice is
  design, not feasibility.
- **B (economy):** real-money escrow GAP-as-product (ask #3); proceeds→payer
  storage offset PATTERN; rentals/sublets = transferable entries in the plot
  registry, PATTERN.
- **C (scale):** recurring auction seasons across many event canvases — the
  parametric auction+authorizer pair scales like everything else here; the
  custody contract is the concentrated risk and argues for ONE audited
  contract serving all events rather than per-event deploys.

## Answers to the special-attention questions

| Question | Answer |
|---|---|
| Can an authorizer see pixel coordinates? | Only if declared in pieceMetadata; forwarded in operationData (SigLib:242). Content is never visible; declared coords are unverifiable on-chain → two-half enforcement pattern required. |
| Auction escrow custody? | No filecoin-pay primitive; custom USDFC-holding contract (PATTERN, security-heavy). Ask #3. |
| Does commit-reveal need anything on-chain? | Not for the commitment; only phase deadlines (authorizer timestamp gating — PATTERN) and money (escrow). |
| Per-event data-set economics at 100s of events? | ~$0.645 upfront ($0.025 fee + 0.62 USDFC lockup) + $0.12/mo each (Prices:20,37; Rails:57). Affordable; per-write fees dominate instead. |
| Snapshot authority? | Trusted admin key, as the peer review said — but authorship IS on-chain enforceable (authorizer restricts snapshot-tagged pieces to the admin signer). Correctness stays off-chain trust. |
| Write throughput / batching? | addPieces batches (FWSS:782; SDK piece-batching.ts; 64KiB−288 cap) but one signature per call (FWSS:796). Contract-enforced per-player limits → 1 tx + ~$0.011 per action. No per-epoch piece cap found; SP pipeline + 30s blocks bound throughput. |

## Ranked: the 5 most valuable missing features for this cluster

1. **Multi-signer batched AddPieces** (filecoin-services). Accept a vector of
   independently-signed sub-operations in one addPieces tx, invoking the
   authorizer per sub-op (or once with the vector). Collapses
   contract-enforced crowd writes from ~$0.011 + 1 tx per player action to
   ~$0.003 amortized, and is THE blocker between "birthday demo" and
   "thousands of concurrent writers with real on-chain cooldowns".
2. **SDK authorizer support** (synapse-sdk). `setDataSetAuthorizer` helper,
   authorizer-aware presign/commit, and a bring-your-own-signer write path
   (non-session-key signatures for authorizer-gated data sets). Today it is
   raw ABI (generated.ts) plus hand-rolled extraData; every idea in the
   cluster needs it.
3. **Escrow / conditional-release primitive in filecoin-pay.** Bids, bonds,
   prize pools, and team treasuries all currently require bespoke custody
   contracts. One ask unblocks Direction B across all four ideas (and baton
   v2's economics).
4. **Content-committed metadata** (filecoin-services convention or SP-side
   check). A standard way for the authorizer to trust that declared metadata
   (coords, action type) matches piece content — e.g. a tiny inline payload
   or an SP-verified content commitment. Today every region/action rule needs
   dual authorizer+fold enforcement, which degrades silently to advisory when
   clients skip the fold half.
5. **Indexed piece-provenance read API** (SDK). Piece id → (add epoch,
   signer, tx) without raw eth_getLogs. Needed by every timelapse, deadline,
   and audit surface here; also the cheap substitute for #4's deadline half.
