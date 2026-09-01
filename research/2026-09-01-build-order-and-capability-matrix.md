# What to build, in what order — and the capability matrix

2026-09-01. Consolidates the whole investigation (games strategy, both
peer-review rounds, deep dives) into a build order plus a living matrix
of substrate capabilities vs. the ideas they block.

## Build order (recommendation)

**1. NOW — Corgi v1 (ship this week).** Zero dependencies: chain reads +
wallet transfers, no authorizer, no write path. Fastest splash, payments
story embodied (health = runway, feeding = depositing, adoption spawns
address-derived corgis), mascot-powered. Also field-tests deposit-event
folding, which the HITL relay's payment legs reuse later.

**2. NOW, parallel — the authorizer spike** (checkout is updated to
main/v1.4.0): browser/SDK write path through a custom authorizer on
calibration, session key dropped from a test build. Unblocks BOTH the
games track and the baton track; every later item depends on it.

**3. NEXT — Baton v0 with the HITL review relay AS the demo.** Merge
the two winners: the v0 spike's scenario IS human-in-the-loop review —
agent drafts (leg 1) → different-vendor agent reviews (leg 2) → a HUMAN
signs final acceptance (leg 3), timeline page + `verify` CLI. Why HITL
as the flagship scenario: it matches how enterprises actually adopt
agents today (human sign-off required), the human's signature makes the
receipt chain credible in exactly the way the provenance PRD's persona
needs, and it needs none of the parked v2 economics. Targets GTM wedge
2B directly. Corrections from the peer review baked in from day one:
protocol fields in signed piece metadata, as-of-epoch folds.

**4. BIRTHDAY (Oct 15) — Paint war, reviewed scope.** Bounded canvas +
cooldown authorizer + blocklist + hard budget + snapshots + timelapse.
Life seeding as the calibration rehearsal only if it costs nothing
extra. Auction deferred.

**5. POST-BIRTHDAY, signal-gated:**
- PoA Mosaic Race — when there's an event to anchor it.
- Jukebox — second-wave builder story, catalog-constrained payloads.
- Baton v2 economics (bonds, escrow, DAGs) — only on a design partner
  naming cross-org handoff-with-receipts as a pain.
- Tamagotchi park v2 (named corgis, cosmetics) — after ACL tooling
  matures; monetization tier.

Rationale for the order: (1) is the only item shippable during the
mainnet-release week with zero risk; (2) is the critical-path unblocker;
(3) is the highest-leverage GTM artifact per effort and rides the
provenance wedge; (4) has a hard date; (5) are pulls, not pushes.

## Permanence: what exists, what's possible today, what to ask for

"Permanent" is the wrong word everywhere (nothing is); the sellable and
TRUE claim is **retention-locked and provably funded**: anyone can check
the runway and the lock on-chain. That is arguably stronger marketing
than Arweave-style "forever" because it is auditable, and the price
comparison holds: at ~$0.005/GB-month, 1 TB ≈ $5/month → **$1,000 funds
a TB for ~16 years; ~$3,000 for 50** — in the same band as (or below)
one-time permaweb pricing, with an inspectable balance instead of a
promise.

Ladder of permanence strength:
1. **Today, soft lock**: attach an authorizer that rejects
   SCHEDULE_PIECE_REMOVALS (verified: removals DO route through the
   authorizer). Weakness: the payer can rotate the authorizer via
   setDataSetAuthorizer, so the lock is revocable.
2. **Today, hard lock via custody**: make the PAYER a contract — an
   endowment contract that owns the data set, holds the deposit, tops
   up rails, and simply has no function to remove pieces, rotate the
   authorizer, or withdraw before epoch X. WORM storage on FOC with no
   filecoin-services changes. This is the pattern to prototype for the
   provenance/compliance story ("the evidence packet is held by a
   contract neither party can unwind for N years").
3. **Feature asks for filecoin-services** (turn the pattern into a
   product):
   - **Retention lock**: a dataset-level, irrevocable-until-epoch-X flag
     that blocks removals, authorizer rotation, AND payer-side
     termination (S3 Object Lock / compliance-WORM equivalent).
   - **Term-prepaid storage**: pay once for N years; rails funded and
     locked at creation (the "endowment" as a first-class product,
     not a custom contract).
   - Note SP-side reality honestly: payment lock guarantees the payer
     side; SP churn/refresh over decades is the protocol's repair
     problem — provable funding, not metaphysical permanence.

Also verified in source: the authorizer payload sizing comment
explicitly anticipates "perms + WebAuthn + P256" payloads — browser-key
(WebAuthn/passkey!) direct authorization is within the design's
assumptions, raising the priority of the P-256/WebAuthn spike.

## Capability matrix (living doc — update as things ship)

Legend: SHIPPED / PATTERN (possible today with a custom contract or
app-level code) / GAP (needs filecoin-services, SDK, or tooling work).

| Capability | Status | Blocks / unblocks |
|---|---|---|
| Dataset-level programmable ACL (authorizer) | SHIPPED (calibnet v1.4.0; mainnet imminent) | everything in the games+baton ladder past v0 |
| Data-set-scoped write authority (replaces account-wide session key) | SHIPPED (via authorizer) | public-key-in-page demos, guestbook, jukebox |
| State-mutating quotas/cooldowns/registries | SHIPPED | paint war mechanic, PoA mosaic, baton single-writer |
| Removal gating via authorizer (soft retention) | SHIPPED, revocable | compliance receipts (weak form) |
| SDK/filecoin-pin support for setDataSetAuthorizer + authorizer-mediated writes | GAP (ABI exposed; no ergonomic path) | spike #2 target; everything above at DX quality |
| Sponsored-writes example authorizer | GAP (merged then reverted for release hygiene; expected back) | zero-onboarding public writers |
| WebAuthn / P-256 signer recovery in authorizer | PATTERN anticipated in design; gas unproven | wallet-free players/agents; passkey UX |
| Retention lock (irrevocable until epoch X) | GAP (feature ask) | compliance evidence packets, "provably funded for N years" product |
| Term-prepaid / endowment storage | PATTERN today (payer-as-contract); GAP as product | permanence marketing, corgi endowments, memorial walls |
| Escrow / bounty custody | GAP (custom contract; security-heavy) | baton v2, bounty boards, RLHF micro-payments |
| Session keys can deposit/fund | CONSTRAINT (owner-only by design) | agent-pays flows; bonds-at-claim |
| Snapshot pieces w/ trusted writer | PATTERN (app-level) | paint war late-join, long logs, multi-tenant baton |
| Incremental sync (high-water piece id) | PATTERN (cursor API exists; client work) | crowd-scale reads |
| Push event subscription (PiecesAdded via wss) | PATTERN (RPC exists; client work) | lower-latency turn/leg notification |
| Artifact encryption for private relays | PATTERN (app-level) | cross-org pipelines with sensitive work product |
| Piece metadata as protocol carrier | SHIPPED (pieceMetadata exists) | baton contract-side enforcement (peer-review correction #1) |
| Agent identity registry (ERC-8004 / 8004-server) | PATTERN (server exists; integration unproven) | capability registries, reputation |
| MCP surface (baton-mcp, foc-storage-mcp) | GAP (to build) | wedge 1B distribution; "any harness joins" claim |
| Cheap many-small-datasets pricing | GAP (1 USDFC lockup per data set) | per-relay/per-game isolation; forces multi-tenant logs |
