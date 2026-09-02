# Companion notes: FOC Capability Ladder deck

2026-09-02. Per-figure sources and math for the deck. Deck file:
`foc-capability-ladder.html`. Distribution: FEE-encrypted on FOC,
in-browser password decryption; password shared out of band.

## Figures and sources

| Figure | Source | Notes |
|---|---|---|
| $21.62 / $39.46 / $25.30 settled (Aug/Jul/Jun) | Infura migration evaluation page (GTM ⇄ Product OS, 2026-08-19) | quoted as written |
| "No new customer since the Storacha cohort"; cohort ARR ~$1,320; USDFC transacted ~$500 -> ~$2.3K | same page | direct quotes |
| H1 target $1K ARR, achieved 852 USDFC | Pod Charter (Q2 budget check-in section) | |
| H2 target >$15K paid/settled before EO2026 | Pod Charter (Q3 budget update; doc types "EO2025", reporting period is Q3 2026) | |
| 5 power users at $500+/mo x 2 months | Pod Charter Q3 topline + H2 GTM deck | deck also contains a $50 variant in one section; $500 used per the Q3 budget doc |
| $20M network ARR, 20 brands, >=33% cryptoeconomics | H2 GTM Strategy / Stack Leads deck (July 2026) | network-level, not pod-level |
| Write fees 53-69% of monthly bill; egress 24-37% | Pricing Sensitivity sheet, scenario table (hobbyist $0.37/mo ... enterprise $19,024/mo) | sheet's own computed rows |
| addPieces $0.002/op proposed; $0.003/piece + $0.008 base current schedule | Pricing sheet ("Per Add Piece / Batch" row); canvas cluster report citing PriceListUSDFC.sol:38-39 | two sources, slightly different numbers, both shown |
| $0.011 per contract-enforced action | computed: 0.008 + 0.003 | one action per tx (per-player signature requirement) |
| ~$0.003 batched | computed: (0.008 + 61 x 0.003) / 61 = 0.00313 | 61 = ExaData batch cap per pricing sheet |
| $1,000 -> ~16 years/TiB | computed: 1000 / (2.5 x 2 copies) = 200 months = 16.7 yr | current list price; prices move |
| 30-day at-risk window after funding runs out | world cluster report: DEFAULT_LOCKUP_PERIOD 30 days (PriceListUSDFC.sol:14); rail.endEpoch on termination (FilecoinPayV1.sol:435) | |
| Moves visible in 30-60 s | measured in foc-collab e2e runs (early release at ~30 s; log catch-up ~94 s worst observed) | |
| ACLs live calibnet v1.4.0; mainnet in progress | filecoin-services main (deployments #601); team statement 2026-09-01 | |
| Moat verdicts | three external model reviews, 2026-09-02, kill-verdicts invited | full outputs summarized in research/2026-09-02-moat-and-gtm-grounding.md |
| "one place we have evidence of product-market fit" (IPFS bet) | H2 GTM deck, quoted | |
| Merged-then-reverted sponsored-writes contract | filecoin-services #540 / #599 | reverted for release timing |

## Deliberate exclusions

- No internal codenames for the prototypes.
- No mention of the encryption tooling used for distribution.
- The NYC "$500K/$2M ARR" figure Russell half-remembers was not found in
  the NYC docs (the $500K present is Q1 pod budget); left out of the
  deck rather than guessed.


## v1.4 pricing correction (2026-09-02)

The April Pricing Sensitivity sheet used proposed numbers that the shipped
v1.4 contracts changed. Deck now uses the current constants from
filecoin-services main, PriceListUSDFC.sol (after #583 pricing update and
#592 proving 0.20 -> 0.12):
- Storage $2.5/TiB/mo/copy (default 2 copies)
- addPieces $0.008 base per call + $0.003 per piece
- Egress $0.007/GB (the April sheet's $0.14/GB was ~20x too high; egress
  is now a minor line, so write fees dominate MORE, not less)
- Dataset fee $0.12/mo, create $0.025, removals $0.007, terminate $0.006,
  lifecycle reserve $0.50
Worked example on the deck (pricing sheet's SMB scenario at v1.4 rates,
10 TiB stored, 100k pieces added/mo, ~61/batch):
  add = 100000*0.003 + ceil(100000/61)*0.008 = $300 + ~$13 = ~$313
  storage = 10*2.5*2 = $50 ; egress (say 500GB) = $3.50
  add-fee share ~= 313/(313+50+3.5+~1) ~= 86%
So "write fees are the biggest line for piece-heavy workloads" holds and
is stronger at v1.4 than the old 53-69% (egress collapsed). The share is
workload-dependent (large-piece workloads shift toward storage); the deck
states the concrete SMB example rather than an "every tier" claim.
Moat attribution corrected: cross-checked with Codex/Cursor/Gemini and
verified against each named product; NOT described as human third-party
review.


## Scope correction (2026-09-02): the $22/mo figure

The ~$22/mo (Aug 2026, and $21-40 across Jun-Aug) is the FILECOIN WARM
STORAGE SERVICE (FWSS = FOC's warm-storage service) total settled
revenue network-wide, from the Infura migration evaluation, NOT a
"pod"-scoped number. Deck slide 2 labels it "FOC settled / mo". Distinct
from the pod's own goals (H1 $1K ARR target hit at 852 USDFC; H2 >$15K
settled) and from the network's $20M ARR goal. Do not relabel any of the
three as another's scope. Note the 852 USDFC (reported ARR/transacted)
and the ~$22/mo settled run-rate are different measures from different
dates/sources; both are shown as-is rather than conflated.

## Revenue figures corrected to live Filecoin Pay data (2026-09-02)

Source: pay.filecoin.cloud/mainnet + FOC observer (query_sql, fp_* tables),
2026-09-02. The Pod Charter names pay.filecoin.cloud/mainnet as THE ARR
metric; the deck now uses it instead of the FWSS-only $21-40/mo figure.

Settled revenue (recognized to providers, all rails, USDFC-equiv):
- Monthly: Jan $26, Feb $27, Mar $71, Apr $23, May $30, Jun $25,
  Jul $177, Aug $664, Sep (2 days) $277.
- Cumulative all-time: ~$1,320. Last 30 days: ~$663.
- August ($664) is a real ramp vs Jun ($25) but early and lumpy; do not
  annualize the peak as run-rate.
Gross transacted (deposit flow, NOT revenue): ~$54K stablecoin
(51.4K axlUSDC + 2.81K USDFC per dashboard). Locked: 2.57K axlUSDC +
2.73K USDFC. Network revenue burned: 64 FIL (dashboard) / ~6.6 in token
fees (0.5% of settled).
Accounts/rails: 159 distinct payer wallets, ~210 accounts total
(incl. payees), 1,535 active rails (2,636 created all-time).
New payer wallets per month: Nov'25 60 (launch), then 7,6,1,16,9,25,17,
10,7,1 — so NOT zero new wallets. The "no new customer since Storacha"
claim is GTM-scoped (no new QUALIFIED customer / power user), not literal
zero on-chain. Deck states it precisely: August jump is existing
customers settling more, self-serve wallets trickle in, no new qualified
logo. The FWSS-only "$21-40/mo" from the Infura doc was a subset; total
Filecoin Pay settled is higher and ramping.
