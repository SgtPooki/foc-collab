# The Baton as agent infrastructure: a serverless relay protocol on FOC

2026-09-01. Deep dive on the agent-ICP side of the Baton (the game side is
a thin skin over the same protocol). Aligned with the existing FilOz agent
GTM work: the `foc-provenance` PRD (signed execution receipts on FOC) and
`filecoin-8004-server` (agent session-key registration/renewal).

## One-sentence pitch

A task queue with exactly-one-active-worker, capability-based handoff,
timeout reassignment, and a cryptographically signed provenance chain —
where the entire coordination plane is a Filecoin Onchain Cloud data set:
no orchestrator server, no message broker, no database.

## Why this fits the agentic ICP (and extends the provenance PRD)

The provenance PRD sells single-agent receipts and states its structural
gap honestly: the operator authors its own record, so receipts prove
non-repudiation, not completeness or truthfulness. The Baton narrows that
gap for multi-agent work, because **verification is built into the
workflow instead of bolted on after**: the next agent must inspect the
previous leg's output before claiming, and its claim piece IS a
counterparty attestation ("I accepted this input and built on it").
A relay's provenance chain is receipts that another party consumed and
countersigned in order to proceed — a materially stronger artifact than a
self-published log, and exactly the "credible evidence packet" the PRD's
DeFi persona wants, generalized to pipelines.

What the substrate uniquely offers agents:
- **Ordering authority without a coordinator**: piece-id order resolves
  claim races deterministically (proven by the tic-tac-toe seat-claim
  fold — same mechanism, different payload).
- **Exactly-one-active-worker** enforced by contract (v1), not by
  politeness or a lock server.
- **Timeout-and-reassign as protocol law**: deadline forfeit is the
  retry semantics every workflow engine reimplements.
- **Audit trail as a side effect**: the log is the provenance chain; a
  static page folds it into a human-readable relay timeline.
- **Latency is a non-issue**: agent legs run minutes-to-hours; 30-60s
  commit time is noise. This ICP is where FOC's latency profile is
  simply irrelevant.

## Architecture: four layers

### L0 — the log (exists today)
One FOC data set per relay (or per tenant). Pieces are signed JSON,
ordered by piece id. Reuses the foc-collab stack verbatim: canonical
serialization, signature-verify-then-fold, domain separation
(`app`, `log` fields), piece-size padding/caps.

### L1 — the relay protocol (piece schemas + fold)
Piece types (all signed by their author; `v: 1`, `app: 'foc-baton'`,
`log: <dataset>`):

- `baton-create` — task spec: description, input artifact CIDs, an
  ordered list of legs or a DAG of capability requirements
  (`legs: [{capability: 'spec'}, {capability: 'implement'}, ...]`),
  deadline policy (per-leg epochs), completion criteria, optional bounty
  declaration.
- `register` — agent enrollment: agent id (address), capability tags,
  endpoint metadata (optional; for humans reading the log), pointer to
  an 8004/ERC-8004 identity or session-key registration.
- `claim` — "I take the baton for leg N": references the create piece
  and the previous leg's `handoff`. First valid claim in piece order
  wins; later claims are ignored by the fold. The claim implicitly
  attests the claimer validated the prior leg's output.
- `handoff` — leg completion: output artifact CIDs, a receipt digest
  (foc-provenance AER-compatible), and the next leg's capability (or a
  named agent). Atomically releases holdership.
- `reject` — the claimer inspected the prior output and refuses it:
  names the defect, re-opens the PREVIOUS leg for claiming. Disputes are
  visible, ordered, and attributable.
- `complete` — final leg's handoff with terminal flag; fold marks the
  relay done.
- Forfeit is implicit: current epoch past the holder's deadline means
  the fold treats the leg as claimable again (anyone can also append an
  explicit `forfeit` marker piece for legibility, but the fold derives
  it from time, not trust).

Fold output per relay: current leg, holder, deadline, chain of
(agent, input CIDs, output CIDs, receipt digests), dispute history,
status. Deterministic on every client — an auditor recomputes the same
timeline from the public log.

Artifacts: work products are pieces in the same data set (small) or a
per-relay artifact data set (large), referenced by CID from handoffs.
Either way the deliverables inherit PDP possession proofs.

### L2 — the authorizer (v1 hardening)
A `BatonAuthorizer` attached via `setDataSetAuthorizer`:

- Holds the registry: `agent -> capabilities`, optionally synced from an
  ERC-8004 identity registry rather than self-asserted.
- Enforces single-writer: while leg N is held, only the holder's signer
  passes `isAuthorized` for handoff pieces; claim pieces pass only when
  the leg is open (unclaimed, rejected, or deadline-lapsed).
- Enforces per-agent quotas and piece-size caps (spam control).
- Optional bonding: claiming requires a stake in the authorizer;
  abandoning (deadline forfeit) slashes it; completing returns it plus
  bounty share. Turns reliability into an economic property.
- Sybil stance: agents are wallets (secp256k1) — natural for this ICP,
  no P-256 question. Registration can require a bond or an 8004 record.

Note the layering discipline: **v0 needs no authorizer at all.** The
fold alone yields correct relay semantics on an honest-participant set
(claim races resolved by piece order), exactly as tic-tac-toe worked
before ACLs. The authorizer upgrades "correct among honest parties" to
"enforced against adversarial parties" without changing the protocol.

### L3 — the agent surface (the ICP hook)
What an agent developer actually touches:

- **`@foc/baton` JS lib**: piece schemas, fold, sign/verify, claim/
  handoff helpers over synapse-sdk. Thin — the tic-tac-toe modules
  refactored and renamed.
- **MCP server (`baton-mcp`)**: tools like `list_open_batons(capability)`,
  `claim(baton, leg)`, `handoff(baton, artifacts, next)`, `reject`,
  `status`. This is the distribution wedge: ANY agent harness (Claude
  Code, Codex, Cursor, custom runtimes) can join a relay by adding one
  MCP server. The provenance PRD already names MCP as the distribution
  surface; the Baton gives that surface a verb beyond "store".
- **CLI (`foc-baton`)**: same operations for CI and cron agents, plus
  `verify <relay>` — recompute the fold, check every signature and
  receipt digest, print the provenance chain. The `foc-provenance
  verify` story, extended to pipelines.
- **The watch loop**: v1 is polling (agents poll cheaply; latency
  tolerance is high). v2: chain-event subscription (PiecesAdded via
  websocket RPC) for push wakeups.
- Onboarding: wallet + session key via the existing filecoin-pin flow or
  the 8004 server; the session key is scoped by the authorizer to the
  relay data set (the ACL-scoping fallback from the peer review).

## Economics

- Storage: the relay creator pays (their data set, their runway) — the
  task-giver-pays model, matching how work is commissioned.
- Bounties (v2): escrowed in the authorizer at `baton-create`; released
  per-leg on the NEXT leg's claim (acceptance-triggered payment — you
  get paid when your successor accepts your work) or on `complete` for
  the final leg. Disputes (reject) freeze that leg's share. Filecoin Pay
  rails are candidates for streaming variants.
- The % take Russell floated lives here naturally: the escrow can skim a
  protocol fee on bounty release without touching isAuthorized payments.

## Failure modes and answers

- Claim race: two agents claim leg N → piece order decides; loser's
  claim is ignored by every fold identically (proven pattern).
- Holder dies: deadline forfeit → leg reopens; with bonding, the bond
  slashes. Deadlines are epochs, not wall clocks — no clock trust.
- Poisoned work: successor `reject`s with named defects; leg reopens;
  the dispute is permanent public record attached to the agent's id.
- Malicious spam: v0 honest-set assumption; v1 authorizer quotas/bonds.
- Log growth: relays are naturally bounded (legs are finite); archive =
  stop paying; long-lived tenant logs use the snapshot/partition
  homework from the games track.
- The PRD's completeness gap: still present per-leg (an agent writes its
  own handoff) but now bounded by counterparty acceptance — sell it as
  such, never as "trustless execution proof".

## What to build, in order

1. **v0 protocol spike (no new infra)**: piece schemas + fold + tests
   (pure, like fold.test.js); a demo relay of 3 real agent legs (e.g.
   spec -> implement -> review of an actual small artifact) run by three
   local agent processes over a calibration data set; a static
   provenance-timeline page folding the relay for humans. This is
   tic-tac-toe-difficulty and proves the whole thesis.
2. **baton-mcp**: wrap the v0 lib in an MCP server; re-run the demo with
   heterogeneous harnesses (Claude Code + Codex + a cron script) to
   prove the "any agent can join" claim.
3. **BatonAuthorizer v1**: single-writer + deadline + registry on
   calibration (shares the authorizer spike with the games track).
4. **verify CLI + receipt alignment** with foc-provenance's AER format —
   one receipt story across both products.
5. **v2 economy**: bonds, escrowed bounties, 8004 registry sync.

## GTM framing

- Demo (60s, matching the PRD's format): three different agent brands
  relay-build one artifact; the finished page shows the signed timeline;
  `foc-baton verify` recomputes it live. Tagline candidates: "the
  orchestrator is a data set" / "multi-agent pipelines with receipts".
- The game IS the top-of-funnel: exquisite-corpse relay as the public
  toy, same contract, so every player has already used the protocol the
  ICP buys.
- Design-partner question to validate (Shannon's framework): do teams
  running multi-agent pipelines need cross-vendor coordination with
  receipts, or is single-vendor orchestration (LangGraph, Temporal,
  in-harness subagents) good enough? The differentiated claim is
  neutral-ground coordination BETWEEN organizations' agents — two
  companies' agents cooperating with neither running the server.

## Open questions

1. Per-relay data sets vs. one tenant log with many relays (cost: 1
   USDFC lockup per data set vs. fold/read amplification).
2. Receipt format: adopt AER verbatim or a superset? (Decide with the
   provenance PRD owners — one format, two products.)
3. DAG relays (fan-out/fan-in legs) — v1 is linear; parallel legs are a
   fold extension, not a protocol change, but claim semantics need care.
4. Bounty denomination and escrow custody (authorizer contract audit
   surface grows substantially with money in it).
5. How much of 8004/ERC-8004 to depend on for identity vs. bare wallet
   addresses in v0.
