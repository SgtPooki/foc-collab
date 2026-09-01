# Deep dives: Baton, Mosaic Race, Corgi Tamagotchi

2026-09-01, from discussion after the four-agent peer review. Three ideas
promoted from the catalog with Russell's additions. Companion to
`2026-09-01-acl-games-strategy.md` and the peer-review synthesis.

## 1. The Baton — game AND agentic-workflow infrastructure

One shared artifact (story, drawing, code file, task); exactly one holder
may append at a time. The authorizer stores `currentHolder`; handoff
pieces update it atomically; a deadline forfeits an idle baton.

**Russell 2026-09-01: this matches the GTM strategy and agentic ICP.**
The workflow reading: a serverless task queue with exactly-one-active-
worker, a signed audit trail of who did what when, and timeout-based
reassignment — no orchestrator server. Connects to the FilOz agent-
provenance work (foc-agent-provenance-PRD, foc-wg-agents).

**Handoff discovery (how an agent knows who's next), composable
mechanisms, all authorizer/log state:**
- Worker registry: agents register with capability tags
  (`{agent, capabilities: [review, test, deploy]}`), in the authorizer
  or as registration pieces.
- Capability-addressed open claim: handoff names a capability, not an
  agent ("next: anyone with capability=review"); first passing claim
  wins. Agents only watch the log for claimable batons matching their
  capabilities — discovery-free coordination.
- Deadline forfeit: idle holder past the epoch deadline -> baton becomes
  claimable. Timeout-and-reassign as contract law.

Two products, one contract: the party game (exquisite corpse, relay
drawing) and the agent pipeline (spec -> implement -> review -> publish,
each leg a different agent, provenance for free). Latency is irrelevant
here — only one writer is ever active.

## 2. Proof-of-Attendance Mosaic Race — the event ritual

Event canvas; painting rights gated by WHO YOU ARE: check-in registers
your key in the authorizer's allowlist; regions carry different
eligibility (speakers, builders, SPs, remote); teams race to finish
images. The registry/allowlist demo of the ACL primitive set, timeboxed
and budgeted by construction, for a captive friendly audience.

**Russell's additions 2026-09-01:**
- Fund it from the ticket: a slice of the attendance fee buys FIL +
  USDFC for the event's data set so the mosaic is PAID TO PERSIST 50+
  years. "Your attendance literally funded permanent storage of the
  thing you made together."
- Closing artifact: at event end, publish a final rendering; attendees
  can claim it (NFT or similar). Every Filecoin event mints a mosaic —
  a repeatable ritual.
- Positioning: the enterprise-credible cousin of paint war.

## 3. Corgi Tamagotchi — the creature IS the data set

Global Tamagotchi (Gemini's idea) + Russell's mechanism insight that
collapses metaphor into reality:

- **Health = the payer account's actual funding runway** for the
  creature's data set — already on-chain, already queryable (payments
  status prints "funded until <date>"). No simulated biology needed.
- **Reviving/feeding-for-real = depositing USDFC to the payer wallet.**
  The corgi is alive because people keep paying to store it. This is the
  most legible possible demo of Filecoin Pay: keep the pet alive == keep
  the data funded.
- Care pieces (pats, treats, dress-up) are the social/cosmetic layer,
  folded like tic-tac-toe moves; global per-epoch quotas and per-key
  cooldowns when the authorizer arrives; "resurrection pass" holders can
  lift the death flag (Gemini) — or anyone can revive by funding.
- **Filecoin Corgi is an existing mascot** — keep THE corgi alive as a
  community ritual.

**Design session 2026-09-01 (Russell): BYOW-only, real stakes.**
No sponsored feeding — if people don't pay their own money, it dies, and
revival costs a chunk. Decisions and reasoning:

- **v1 needs no write path at all.** BYOW-only means interactions can BE
  payments: feeding = sending USDFC to the corgi's payer wallet. The
  page folds over DEPOSIT EVENTS instead of pieces — runway = health,
  deposit history = attributed feed log. No session keys, no authorizer,
  shippable immediately; cosmetic care pieces arrive later via ACL.
- **Two-layer health**, so health is closely tied to data-set liveness
  without being a raw readout (Russell: don't tie it DIRECTLY):
  - Mood (days): recent deposit activity; hungry/sad states create
    fundraiser urgency (streamer-donation-goal psychology).
  - Life (months): nonlinear runway thresholds — thriving > 3mo,
    sick < 1mo, critical < 2wk.
- **Death triggers BEFORE runway zero (Russell's correction).** At zero
  the SPs may actually drop the data, so a memorial triggered at zero
  may never be seen. Instead: death is declared while runway remains
  (e.g. under 30 days), and the remaining runway IS the memorial
  window — the memorial page counts down its own existence ("corgi died
  Oct 3; this memorial ceases to exist in 23 days"). Revival inside the
  window resurrects; the window closing is true disappearance. Not
  theater — settlement mechanics rendered as narrative.
- **Whale-proofing (Russell): one 500-USDFC donor must not end the
  game.** Mood is driven by DISTINCT RECENT FEEDERS, not amounts: a
  whale buys life (runway) but cannot buy happiness — a fully-funded,
  lonely corgi mopes until the community shows up. Money keeps it
  alive; only people keep it happy.
- Launch-side mitigations only: a modest genesis endowment so death
  isn't day-one, and NO quiet team bailouts (a secretly-immortal corgi
  fakes the demo).
- **Generations (planned, not optional)**: each death/revival is a new
  corgi generation; past corgis' final states live on a memorial wall,
  itself funded or forgotten. Death becomes lore instead of failure.
- **The corgi park (Russell 2026-09-01): people BUY corgis to add.**
  Deposits above an adoption threshold spawn a corgi owned by the
  sender; THE corgi (gen-0 mascot) is happy when it has company, so
  loneliness is cured diegetically — community members ARE the friends.
  Sprites derived deterministically from the owner's address hash
  (identicon-style: coat/size/bounce/accessory) — no art pipeline,
  verifiably unique, screenshot-bait. The screen becomes a live
  visualization of the supporter base: a crowded park IS a funded park.
  v2: naming/cosmetics as paid ACL pieces (the pay-for-features tier),
  and optional per-corgi vitality — lapsed corgis wander to the
  memorial wall. Every verb (feed, adopt, name, revive) remains a
  payment into runway; the population is the treasury wearing fur.

Scope check: v1 is SMALLER than tic-tac-toe (reads + wallet transfers
only). The authorizer/pieces layer is the v2 game, not a prerequisite.

## Sequencing implication

The corgi may deserve the "teaser" slot ahead of or beside Conway's Life:
smaller than paint war, fully buildable TODAY (no authorizer dependency),
natively tied to the payments story, and mascot-powered. Paint war
remains the birthday flagship; Baton-as-agent-infra runs on a separate
(GTM/agentic) track from the games ladder.
