# Moat verdicts and GTM grounding for the capability story

2026-09-02. Two inputs gathered for the team-facing artifact: an
unbiased three-agent moat review (cursor, codex, gemini; full outputs in
scratchpad, verdicts summarized here), and revenue/ICP grounding mined
from the GTM sources in Drive and Notion.

## Moat review: three-agent consensus

Question posed: "most anything can be built anywhere now — what is the
actual moat, if any?" Kill verdicts were welcomed.

**Unanimous: no single primitive is exclusive to FOC.**
- Verifiable funding receipts: genuine vs AWS/Stripe opacity; not unique
  vs on-chain escrows or Arweave upfront-pay.
- Authorizer-gated writes: shipped and useful; the pattern exists
  elsewhere with different trust tradeoffs.
- Coordinator-free shared state: the weakest exclusivity claim — it is
  the SmartWeave/rollup pattern, replicable with a signed log on S3 plus
  chain anchoring.
- PDP: real differentiation vs pinning/blobs, but proofs are a sector
  baseline (Arweave SPoRA, Walrus Red Stuff).
- Retention veto: soft today (payer can rotate the authorizer; SP churn
  risk); hard retention is the payer-as-contract pattern, not a product.
- Storage+payments in one system: replicable by gluing streaming-payment
  contracts to any storage network.

**Unanimous: the actual moat is the bundle, not a primitive.** Codex:
"a developer can create a verifiable storage dataset where writes,
proofs, payer balances, provider compensation, termination, and
app-specific authorization all live in one public contract system" —
meaningful ONLY IF writes are cheap enough, retrieval good enough,
providers plentiful, and SDK support for authorizers/indexed reads
exists. "Without those, it is mostly positioning." Cursor's honest sell:
"auditable retention with programmable write law, no coordinator server,
at cold-storage economics — defensible, narrow, honest, not a monopoly."

**Named threats:** Walrus/Sui DX parity (closest architectural threat),
Arweave/AO sponsored-write app framework, an AWS "verifiable
transparency log + Object Lock + audit API" product, our own write
economics (~$0.01/action), and marketing ahead of custody reality
(deletion, authorizer rotation, session-key blast radius).

**Strategic consequence for the artifact:** the moat is not inherited,
it is BUILT — and the build list is exactly our feature-ask ranking
(SDK authorizer path, indexed reads, batching, payment hooks). The
motivational story writes itself: our defensibility equals our
integration completeness, and today it is unfinished.

## GTM grounding (sources named per figure)

From the H2 GTM Strategy / Stack Leads deck (Shannon Wells, July 2026):
- Network KPI: $20M onchain ARR run-rate; >=33% of network revenue
  covering PGF + block rewards (100% trajectory in 3 yrs); 20
  high-profile paying brands.
- H2 north star: 5 recurring power users in ONE repeatable ICP, same
  core problem and workflow, $500+/mo onchain ARR for 2 consecutive
  months, in a 10%+ CAGR market. (A growth-team section states a
  $50+/mo variant; the deck is internally inconsistent — quote as
  written, do not reconcile silently.)
- Quarterly KPIs: 90 qualified opportunities, 45 qualified POCs, $10K
  booked, 5 power users.
- Priority bets: (1) Agents as ICP (MCP distribution; provenance/audit
  validation), (2) IPFS brand expansion (Filecoin Pin, highest-
  converting path, "the one place we have evidence of product-market
  fit"). Design partners: 2-3 by end of August; paid pilots 1 per track
  by Q4 at the $500+/mo threshold.
- Named targets: Circle, Tempo, Avalanche, Coinbase/Base, C2PA/Appia,
  Venice AI, Gensyn; distribution: Braintrust, Arize, Helicone, MintMCP.
- Juan's FDS framing — map storage requirements to FOC's unique
  capabilities; find where S3 is a bad fit; small niches with breakout
  growth — is the exact assignment the capability ladder answers.
- Key GTM position: "Wallet + payment friction is a DX problem to
  solve, not a reason to limit our audience" — direct support for the
  tier-3 passkey/payments asks.

From the Infura Migration page (2026-08-19/20, GTM ⇄ Product OS):
- Reality anchor: FWSS settles $21-40/MONTH network-wide (Aug $21.62,
  Jul $39.46, Jun $25.30). Storacha cohort ARR ~$1,320; USDFC
  transacted grew ~$500 → ~$2.3k in that migration.
- The Infura deal ($105-210/mo at list $2.5/TiB/mo) would be 2.6-9.7x
  TOTAL monthly settled revenue and the first new logo since Storacha.
- "No new customer since the Storacha cohort."
- Network scale: 14.9 TB live, 6.9 TB ingested in 30 days; a single
  42 TiB deal is 3-6x the entire live network.

**The gap that motivates everything: today's settled revenue (~$260-480
annualized) vs the $20M ARR KPI. The flywheel thesis explains the gap:
builders lose money by construction, so the flywheel has no first
turn.**

Hypothesis tracker (schema read; wedges): Agent-Native Default Storage,
IPFS Pinning, Tradable Digital Assets, AI Governance, Stablecoins/
Payments, Agent Onboarding, Brand, Compliance. Strategic bets: Agents,
IPFS, Crypto Expansion, Data Sovereignty, Open Source. Visible rows:
H2 (developer tooling highest-potential ICP), H13 (finance-use-case
sell-through partners), H14 (agents as highest-potential ICP; FOC
uniquely designed to serve them). Row-level query failed on tool input;
individual pages fetchable if per-hypothesis detail is needed.

Not yet read: "Filecoin Onchain Cloud — Pricing Sensitivity" sheet and
the "Markets" deck (available if unit-economics slides need more depth).

## Overlap map: our destinations x GTM bets

- Signed hand-off chains / receipts (baton, HITL) -> Agents bet, AI
  Governance + Compliance wedges, provenance validation named in the
  deck's own execution plan. Strongest overlap.
- Guestbook/viewer-saves + published artifacts -> IPFS bet (Filecoin
  Pin path), Brand wedge.
- Retention/WORM products -> Compliance wedge, H13 finance partners.
- Funded-mascot / self-funding apps -> no GTM row exists; it is a
  Payments/Stablecoins wedge demo and a brand asset, not a tracked bet.
  Tag honestly as "demand undiscovered".
- Crowd canvases/events -> Brand wedge (awareness campaign fodder),
  not a revenue bet.

## Addendum (same day): pod targets, pricing sheet, encryption envelope

**FilOz/FOC pod's own revenue targets (NOT the network's $20M):**
From the Pod Charter doc (contains the funding request + Q2 check-in +
Q3 budget update):
- H1'26: $1K ARR target — ACHIEVED (852 USDFC ARR reported in Q1
  accomplishments); plus "4 onramps with collectively $1M ARR making
  paid onchain deals with FOC".
- H2'26 (Q3 budget update topline): >$15K paid/settled via FOC before
  EO2026 (doc types "EO2025"; reporting period is Q3 2026), from ~$1K
  transacted as of EOQ2. Plus 5 recurring power users at $500+/mo x 2
  months (confirms $500, resolving the deck's $50/$500 inconsistency),
  >20 active mainnet SPs meeting repair/replication SLAs, and — notable
  for our research — "Support for user private data (ACLs &
  encryption)" as a named H2 operational-readiness goal.
- NOT FOUND: a $500K or $2M ARR commitment from the June NYC trip. The
  $500K figure that does appear is the Q1 POD BUDGET allocation ("of
  ~$500K allocated"), and $1M appears only as the 4-onramps collective
  line. Flag to Russell rather than guess; the FDS-8 Secondary Planning
  doc and "FilOz 2026H2 Planning" gdoc remain unread candidates.

**Pricing Sensitivity sheet (proposed price list + scenario model):**
- Proposed prices: dataset creation $0.00112; proving floor $0.024/
  dataset/mo; storage $2.50/TiB/mo/copy (default 2x = $5 headline; the
  scenario lever tests $0.50/copy); addPieces $0.002/op (batch capped at
  61 by ExaData); egress up to $0.014/GB; deletion $0.002.
- THE finding: in the sheet's own scenario model, per-piece ADD FEES are
  53-69% of the monthly bill at every tier (hobbyist $0.37/mo through
  enterprise $19K/mo; effective $19-37/TiB/mo all-in), with egress
  another 24-37%. Storage itself is a minority of the bill. Direct
  internal corroboration for the builder-P&L thesis and the batching
  ask (its "Per Add Piece" row even names the spam-defense rationale
  and the SP batching disincentive).

**NYC colo doc extras:**
- The wedge backlog literally contains our thesis: "DApps: work with
  'heavy' files 'without a server'" (linking curiostorage filstream),
  plus verifiable attestations/compliance wedges.
- Agent-storage ICP already has named customer examples: Atomic Memory,
  Phala Network, AethirClaw; plus the Storacha-migration use-case
  buckets show real demand for private/encrypted storage and advanced
  access control.
- "Service Sponsorship (fund an existing rail by a 3rd party)" already
  has a product-research page (Sponsor a rail / fund a specific
  dataset) — prior art for the corgi's fund-a-specific-dataset
  question; link from Notion: Product research: Sponsor a rail.

**Encryption envelope for the internal deck:**
FEE (Filecoin Encryption Envelope), FIPs discussion #1253. Go impl:
filecoin-project/go-fee; the wire-format source of truth is Kuba's
TypeScript reference implementation Kubuxu/foc-encryption-demo
("foc-encryption"). Chunked AES-256-GCM (STREAM), CEK wrappable via
ECDH-ES+A256KW (X25519) or A256KW pre-shared key — the pre-shared-key
path is the password route (KDF -> A256KW). Plan: publish the deck FEE-
encrypted to FOC with a small self-contained viewer page that decrypts
in-browser with the password; internal content never sits public.
