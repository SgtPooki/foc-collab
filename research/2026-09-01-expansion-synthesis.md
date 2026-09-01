# Expansion synthesis: four-cluster feasibility, merged

2026-09-01. Synthesis of the four cluster reports in `clusters/`
(canvas, living-world, baton, social) — each idea explored in directions
A (richer product) / B (economy) / C (enterprise) with every
SHIPPED/PATTERN/GAP call verified in source. This doc merges the
findings, corrects the capability matrix, and produces one master
feature-ask ranking.

## Corrections to prior docs (source beat our assumptions)

1. **Data sets are cheap; the write path is the cost driver.** The "1
   USDFC lockup" is really ~0.62 USDFC (recoverable) + $0.025 creation +
   $0.12/month (canvas report). 100 event canvases ≈ $62 locked. The
   binding cost is per-write op fees: ~$0.011/action when each player
   signs their own chain tx. Downgrades the "cheap many-small-datasets"
   ask; upgrades the batching ask (below).
2. **CreateDataSet is NOT authorizer-gated** (only AddPieces, Schedule-
   PieceRemovals, TerminateService are). Self-serve canvas/relay
   creation is a payer-side/app-contract layer, never authorizer policy.
3. **TerminateService IS authorizer-gated** — so a retention authorizer
   can veto BOTH piece removal and payer-side termination until epoch N,
   today. This materially softens the "payer's delete button" tension:
   retention-locked custody is a PATTERN (authorizer + endowment payer
   contract for the economic half), not a feature wait.
4. **Corgi v1 design corrections (world report):** feed via
   `FilecoinPay.deposit(USDFC, to: corgiPayer)` — permissionless for any
   `to`, credits runway immediately, emits sender-attributed
   `DepositRecorded` events — NOT a bare ERC20 transfer (doesn't extend
   runway). One dedicated payer wallet per corgi (runway is
   account-level). Two free health bars: `runwayInEpochs` (enters
   deficit) and `grossCoverageInEpochs` (funds exhausted). The ~30-day
   memorial window is protocol-guaranteed (DEFAULT_LOCKUP_PERIOD;
   rail.endEpoch on termination) — the death arc cites the chain.
5. **Baton v2 economics is more buildable than the peer review thought
   (baton report):** a Baton contract can be BOTH the data-set
   authorizer AND a Filecoin Pay rail operator naming itself validator —
   creator approves it as operator, it creates a per-leg rail with
   lockup = bounty, and releases via `modifyRailPayment` one-time
   payment when it authorizes the successor's claim.
   `commissionRateBps` + `serviceFeeRecipient` give the protocol fee
   natively. No raw-fund custody contract needed for the happy path.
   Still standing from the review: MEV on bounty claims, self-dealing
   (HITL's human acceptance neutralizes it for that product), and
   session-key agents can't approve operators or fund — worker bonds
   need the owner wallet.
6. **Region/coordinate rules are a two-half pattern (canvas):** the
   authorizer sees piece CIDs + ALL pieceMetadata (3 keys, ≤32/96 B)
   but never content — it gates on DECLARED coords; the fold discards
   content/metadata mismatches (provable cheating, since metadata is
   signed). Design every spatial rule this way from day one.
7. **Listing, not reading, is the consumer-scale bottleneck (social):**
   piece metadata is emit-only (indexed off-chain by design); no SDK
   read-back or filter exists. And CDN egress is payer-billed with no
   per-reader surface — a popular consumer app is an unbounded
   bandwidth bill.

## Master feature-ask ranking (merged across clusters)

1. **SDK authorizer path** — setDataSetAuthorizer helper,
   authorizer-aware presign/commit, bring-your-own-signer writes.
   Demanded by ALL FOUR clusters; today it's raw ABI + hand-rolled
   extraData. (Matrix row confirmed; spike #2 stays first.)
2. **Indexed read layer** — one product with three faces: metadata-
   filtered piece listing (social #1), payments account-activity with
   sender attribution (world #1), piece provenance id→epoch/signer/tx
   (canvas #5) — plus event push (wss) helpers. Everything's A
   direction hits this wall. Goldsky/foc-observer already index the
   events; the ask is SDK-fronting them.
3. **Multi-signer batched AddPieces** (canvas #1) — independently
   signed sub-operations in one tx, authorizer invoked per sub-op.
   Collapses contract-enforced per-player actions from $0.011 to
   ~$0.003 and un-bottlenecks the SP pipeline. THE crowd-scale blocker;
   also what makes "contract-law cooldowns" affordable at r/place
   scale.
4. **Payments hooks for B directions** — (a) actor-pays action fees
   (charge the WRITER at add time, with commission splits) and (b) an
   escrow/conditional-release primitive (or blessing + hardening of the
   operator/validator composition from correction 5 as the documented
   pattern). Unlocks paid classes/hints/adoptions/bids/bonds everywhere.
5. **WebAuthn/P-256 signer recovery proven on FEVM** — wallet-free
   commenters/players/agents; payload sizing already anticipates it;
   gas unproven. Make-or-break for consumer direction C.
6. **Sponsored-writes example authorizer restored** (#540 revert) —
   quick win; zero-onboarding writers precondition.
7. **Retention lock productized** — pattern exists today (correction
   3 + endowment); the ask is first-class packaging (irrevocable flag,
   term-prepaid) so compliance buyers don't audit a bespoke contract.
8. **Consumer-scale reads billing** — per-reader or sponsored CDN
   egress (social #5) and author-attributed removal ergonomics (pass
   piece ids at add time).
9. **Session-key reach into FilecoinPay** (baton #2) —
   setOperatorApproval/deposit are msg.sender-only, so session-key
   agents cannot participate economically (bonds, operator approvals)
   without their owner wallet. Distinct from, and additive to, the
   actor-pays ask.
10. **Piece-metadata headroom** (baton #4) — 3 keys x 96 B = 384 B
    total is too tight for DAG-relay edges and compliance protocol
    fields; digest-only packing is the interim pattern.
11. **App-level encryption recipe** (baton #5) — nothing in the stack
    addresses private cross-org relays; a documented envelope-
    encryption convention (who holds keys, how successors decrypt) is
    the missing piece for enterprise pipelines.

## What this changes in the build order

- **Corgi v1 gets even easier and MORE on-message**: deposit-based
  feeding is the intended API, the memorial window is protocol truth,
  and zero contracts are needed. Unchanged: build first.
- **Authorizer spike scope sharpens**: it should exercise the
  hand-rolled extraData/BYO-signer path (the SDK gap) and prototype the
  declared-metadata two-half pattern, since every later product uses
  both.
- **HITL relay strengthens as the baton flagship**: human acceptance
  kills self-dealing, and the rail-operator composition gives paid
  approval flows without custody contracts. The v2 "park" softens to
  "park bonds and open bounty markets; HITL payments are v1-adjacent."
- **Paint war birthday scope must choose its cooldown trust model
  explicitly**: contract-law cooldowns at ~$0.011/pixel (fine at
  birthday scale: 10k pixels ≈ $110) vs shared-key batching with
  advisory cooldowns at ~$0.003. Recommend contract-law for the
  birthday (the point IS the demo), batching ask for scale-out.
- **Guestbook C (comments-for-any-site) is the social cluster's
  enterprise wedge** — sequenced after the indexer ask has an answer,
  since embeddable reads can't enumerate the world.
