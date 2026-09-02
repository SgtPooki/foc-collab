# Build brief: FOC Corgi (community-pet v1, production quality)

You are building a real, shippable web app. Work in this folder:
`/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/apps/corgi/`
Everything is in the private repo `sgtpooki/foc-collab`. Commit as you go.

## What it is (one sentence)

A community pet whose health is the real funding runway of its own Filecoin
Onchain Cloud (FOC) storage: feeding it is a USDFC payment anyone can make and
verify on-chain, and if the community stops funding it, it visibly declines and
eventually the storage terminates.

## Read these first (do not skip; they carry verified facts and design)

- `../../research/2026-09-01-idea-deep-dives.md` — the corgi design section:
  BYOW-only economics, two-layer health (mood vs life), death-before-zero with
  a memorial countdown, whale-proof mood (distinct feeders), the corgi park
  (adoption spawns owned corgis), generations. THIS IS THE SPEC. Follow it.
- `../../research/clusters/world-cluster-report.md` — the verified contract/SDK
  facts (runway read, attributed deposits, the 30-day window). Trust these but
  re-confirm against source before relying on any single call.
- `../../research/2026-09-01-build-order-and-capability-matrix.md` and
  `2026-09-01-expansion-synthesis.md` — where this sits and what's SHIPPED vs GAP.
- `../../CLAUDE.md` — repo rules (folds pure, no nested ternaries, every slow
  state shows progress, no secrets in the repo).

## Verified technical facts (re-confirm against source; cite file:line in code)

Source of truth: `/Users/sgtpooki/code/work/filoz/filozone/synapse-sdk` and
`/Users/sgtpooki/code/work/filoz/filozone/filecoin-services`. FOC observer MCP
(`get_system_context` then `query_sql`, network `mainnet` or `calibnet`) has
live `fp_deposit` / `fp_rail_settled` data if you need real numbers.

- Health source: `FilecoinPayV1.getAccountInfoIfSettled(token, owner)` returns
  `fundedUntilEpoch`; the SDK wraps it as `getAccountSummary` ->
  `runwayInEpochs` (synapse-core/src/pay/get-account-summary.ts) and
  `grossCoverageInEpochs`. Two health bars for free: runway (enters deficit)
  and grossCoverage (funds exhausted). Runway is per (token, payer ACCOUNT),
  so give each corgi its OWN dedicated payer wallet == corgi runway.
- Feeding is a DEPOSIT, not a bare transfer: `Pay.deposit(token, to, amount)`
  is permissionless for any `to` (FilecoinPayV1.sol ~465). It credits the
  payments account immediately and emits
  `DepositRecorded(token indexed, from indexed, to indexed, amount)`
  (FilecoinPayV1.sol ~109). A wallet transfer does NOT extend runway; a deposit
  does. Use plain `deposit` (not `depositWithPermit`, which loses funder
  attribution).
- Attributed feed log = `eth_getLogs` for `DepositRecorded` filtered by
  `to = corgiPayer`. No SDK helper exists for event history (this is a known
  GAP); use viem `getLogs` with chunked ranges (Filecoin RPC caps lookback), or
  the FOC observer / an indexer. Building a small reusable "account activity"
  read is a legit and encouraged side-deliverable.
- 30-day memorial window: `DEFAULT_LOCKUP_PERIOD = 2880*30` epochs
  (PriceListUSDFC.sol ~14); `EPOCHS_PER_DAY = 2880`. On termination
  `rail.endEpoch = lockupLastSettledAt + lockupPeriod`. Declare death BEFORE
  runway zero (e.g. under a 30-day threshold) so the memorial page is
  guaranteed to be viewable while data still exists.
- USDFC token: calibration `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0`,
  mainnet `0x80B98d3aa09ffff255c3ba4A241111Ff1262F045`. Native FIL = address(0).

## v1 scope (build this, production quality)

- **BYOW-only.** No sponsored feeding. If people do not pay, it declines. Every
  action is the player's own money.
- **A static page** (self-contained, no runtime CDN — this must publish to FOC
  and render from IPFS) that reads chain state and renders the corgi. State is
  a deterministic fold over the deposit-event log + the account runway read, in
  the spirit of the tic-tac-toe fold (`../../games/tic-tac-toe/fold.js`): keep
  the fold pure and synchronous; all async (RPC) happens before it.
- **Two-layer health:** life = runway thresholds (thriving > ~3mo, sick < ~1mo,
  critical < ~2wk); mood = number of DISTINCT recent feeder addresses in a
  window (so one whale buys life, not happiness). Sprites/states for each.
- **Feeding UX:** connect wallet, `deposit` USDFC to the corgi's payer account,
  full slow-state feedback (this is a repo rule) — pending, confirmed, error.
- **Attributed feed log:** who fed, how much, when — from `DepositRecorded`.
- **Adoption / corgi park:** a deposit above a threshold spawns a corgi owned by
  the sender; sprite derived deterministically from the sender address (no art
  pipeline). The mascot is happy when it has company. A crowded park is a funded
  park.
- **Death arc:** death declared before runway zero -> a memorial page that
  counts down its own remaining existence (the lockup tail) -> revival by a
  deposit resurrects. Never a static dead corgi forever; the protocol's
  termination is the true end.
- **Generations:** each death/revival is a new generation; past corgis on a
  memorial wall (fold over the log).

## Going beyond v1 (allowed and encouraged where it makes the product better)

The user explicitly greenlit writing our own contracts. v1 needs none, but a
strong v2 you may build if v1 is solid:
- A tiny **adoption/sponsorship helper contract** (deposit-with-split, or a
  sponsor-a-dataset flow) so naming/cosmetics/tiers or a small protocol fee are
  possible without the app holding custody. Check the "Sponsor a rail / fund a
  specific dataset" product-research note referenced in the research docs, and
  the shipped per-dataset authorizer (filecoin-services v1.4,
  `setDataSetAuthorizer` / `IDataSetAuthorizer`) if you gate anything.
- Do NOT block v1 on any contract. Ship the read-only + deposit v1 first.

## Hard rules

- Calibration for all testing. Give the corgi its OWN throwaway payer wallet;
  secrets go in a gitignored `.env` (see repo `.env.example`), never committed,
  never printed.
- No fabricated data. Every number on screen comes from a real chain read; if a
  read fails, show it, don't invent.
- Self-contained page (inline/bundled assets) so it publishes to FOC and renders
  offline/from IPFS. Bundle deps like the tic-tac-toe build does
  (`../../scripts/build-page.mjs`, esbuild) rather than runtime CDN.
- Design both light and dark; responsive; respect reduced-motion. Real
  typographic care — this is a public showpiece for the payments story.
- Tests: pure fold logic gets node:test unit tests (copy the tic-tac-toe test
  shape). A Playwright happy-path against a funded calibration corgi is the
  acceptance test.
- Any user-facing copy is in Russell's voice: no em-dashes, no emoji, plain and
  specific. Gate prose with the writing-core checker + my-voice overlay.
- Commit messages: subject + body only. NEVER add Claude/Anthropic trailers,
  Co-Authored-By, "Generated with", robot emoji, or any claude.ai URL.
- Publish via the repo `publish` skill (`.claude/skills/publish/SKILL.md`) when
  you have something demoable; return the inbrowser.link URL.

## Definition of done (v1)

1. `npm test` green: pure fold (health from runway, mood from distinct feeders,
   adoption spawns, death/revival transitions, generations) with unit tests.
2. A funded calibration corgi renders live: health reflects real runway, the
   feed log shows real attributed deposits, feeding through the UI actually
   deposits USDFC and updates the page.
3. Death-before-zero + memorial countdown + revival all demonstrated (you can
   force it by draining a test corgi's runway).
4. Published to FOC, shareable inbrowser.link URL returned, verified retrievable
   and rendering in a real browser (Playwright).
5. A short `README.md` in this folder: how to create/fund a corgi, run, test,
   and publish. And `.env.example`.

Start by reading the design doc and the world-cluster report, then scaffold the
pure fold + tests, then the read path, then the UI, then feeding, then death,
then publish. Ask the user only for genuine blockers (funds, a decision the
docs don't cover); otherwise build.
