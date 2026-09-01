# Baton agent-infrastructure: three-agent peer review synthesis

2026-09-01. Reviewers: Gemini, Codex, Cursor — prompted neutrally (kill
verdicts explicitly welcomed, steelman-against required), grounded in the
agent GTM deck / HYP-2 / foc-provenance PRD facts and read access to the
filecoin-services and synapse-sdk source. Target:
`2026-09-01-baton-agent-infrastructure.md`.

## Verdicts (unanimous on all three questions)

**Q1 Feasibility: v0 yes, v1 yes with corrections, v2 NOT as written.**
The fold/piece/ordering core is proven by this repo. The economics layer
(bonds, escrowed bounties) has mechanical flaws that make it a real
contract-engineering project, not a flourish.

**Q2 Merit: exceptional GTM showcase, weak platform bet.** Gemini: "a
terrible generalized task queue, but an exceptional, necessary GTM
showcase — build to v1." Codex: "worth a narrow spike, not a product bet
yet." Cursor: "good demo, weak platform bet." The steelman held by all
three: most teams can't make their OWN agents reliable; Postgres/Temporal
wins for every single-org case on latency, cost, privacy, and debugging.
The narrow claim worth validating with design partners: **credible
cross-org handoff receipts where neither party runs the coordinator** —
not "better orchestration."

**Q3 Implications: powerful primitive, sharp edges** — griefing, escrow
custody liability, MEV, content liability, and a narrative tension we
must resolve (below).

## Design corrections to fold back into the architecture doc

1. **The authorizer cannot read piece bodies (Codex).** It receives
   operationData (CIDs, metadata), never the stored JSON. All
   protocol-critical fields — relay id, piece type, leg, previous-piece
   CID, body hash, deadline — must be duplicated into signed piece
   METADATA for contract-side enforcement. Schema change at L1/L2.
2. **Folds must be parameterized "as of epoch N" (Codex).** A fold that
   reads the current epoch for deadline forfeit yields different answers
   over time; historical verification breaks. Either as-of-epoch folds
   or explicit anchored forfeit pieces.
3. **Session keys cannot post bonds (Gemini).** Funding is owner-level;
   bond-at-claim only works via a pre-funded internal ledger in the
   authorizer, degrading plug-and-play MCP UX. v2 blocker.
4. **Acceptance-triggered bounties are self-dealable (Codex).** A worker
   hands off to its own Sybil successor to release its own payment.
   Needs owner-acceptance, quorum, or bonded registries.
5. **MEV on claims with money attached (all three).** Piece order is
   deterministic ex-post but block-producer-chosen ex-ante; bounty
   claims invite frontrunning. Fine while claims are free (v0/v1).
6. **Escrow is a separate contract funded by direct user transactions
   (Gemini+Codex).** isAuthorized is nonpayable and not the payment
   path; Filecoin Pay rails are not an inline bounty mechanism.
7. **Multi-tenant log, not per-relay data sets (Gemini+Codex).** The
   1 USDFC lockup dominates all other costs; per-relay data sets are
   cost-prohibitive at volume. Resolves open question #1.
8. **Contract enforcement is transaction-order, not piece-id-order
   (Codex).** Equivalent for single-writer purposes; the doc must not
   imply the authorizer reasons over future piece ids.
9. **Stale checkout note (Codex):** the local filecoin-services working
   tree predates the ACL merge (code is on origin/main). Pull before the
   authorizer spike.
10. **Payer griefing (Cursor):** any authorized writer can burn the
    relay creator's storage budget with junk the fold ignores but the
    chain bills. Authorizer quotas are budget protection, not just spam
    hygiene.

## Cost model (Codex, order-of-magnitude)

~0.011 USDFC operation fee per piece → ~0.022 USDFC per leg (claim +
handoff), plus ~0.0004–0.001 FIL gas per piece (authorizer adds state
writes; P-256 would add ~150–500k gas if ever done in Solidity). Tiny
per relay; the data-set lockup is the real unit economics driver.

## The narrative tension to resolve before GTM messaging

Cursor: the payer's `SchedulePieceRemovals` is a real delete button —
the same mechanism we celebrate as moderation for games *undermines*
"permanent provenance" and "neutral ground" claims for the agent
product. Any provenance messaging must state the custody model honestly:
tamper-EVIDENT and non-repudiable while retained, removable by the
payer. (Same boundary discipline the foc-provenance PRD already
practices; keep the two products' claims consistent.)

Also flagged (Codex/Cursor): public logs leak sensitive work product —
cross-org pipelines need artifact encryption; and public reject pieces
constitute an agent-reputation record with defamation/moderation
implications when disputes are subjective.

## Revised roadmap (reflecting unanimous advice)

- **BUILD: v0 spike** — schemas (with metadata duplication per
  correction 1), as-of-epoch fold, tests, a 3-leg demo relay run by
  heterogeneous harnesses via baton-mcp, provenance-timeline page,
  `verify` command. Zero new chain infra; tic-tac-toe difficulty.
- **SHARE: v1 authorizer as a spike shared with the games track**
  (single-writer + deadline + quotas/budget). Co-design authorizer and
  fold so they cannot drift (Cursor's "authorizer drift" risk).
- **PARK: v2 economics** (bonds, escrow, DAGs, 8004 sync) until a
  design partner names cross-org handoff-with-receipts as a pain. The
  dispute/custody/self-dealing problems are a product, not a milestone.
- **MESSAGE carefully**: demo tagline stays "the orchestrator is a data
  set"; never "trustless multi-agent orchestration" (Cursor), and state
  the removal-custody boundary plainly.

## Follow-on catalog (merged, deduped)

- Human-in-the-loop review relay: agent produces → agent checks → human
  signs final acceptance (Gemini's RLHF/data-labeling variant of the
  same shape; micro-payment on approval).
- Multi-org security-audit relay / bug bounty: fuzzer → triage → PoC
  across firms, bounty split (Gemini; Cursor's cross-vendor audit demo
  is the sales-tool version with a regulator-readable timeline).
- Compliance evidence packet: pipeline receipts for regulated data
  processing, exported by `verify` (Codex — the most direct extension
  of the provenance PRD's DeFi persona).
- Cross-org procurement relay: request → bid → fulfill → inspect →
  accept with a signed acceptance chain (Codex).
- OSS "merge train" relay: triage → patch → review → release as legs
  (Cursor; fits the OSS-maintenance narrative).
- Live hackerhouse event: dozens of specialized MCP agents relay-build
  a chaotic project on stage (Gemini) — the stage-show version of the
  game skin.
- Conference mosaic x baton: checked-in keys run timeboxed relays
  building a shared artifact (Cursor; composes with the PoA mosaic).
- Multi-signed oracle pipeline: agents aggregate off-chain data; the
  complete piece is a verified payload (Gemini).
- Quorum/escrow trigger: threshold-signed "release" as a minimal
  primitive without full workflow semantics (Cursor).
