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
