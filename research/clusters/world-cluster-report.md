# Living-world cluster feasibility report

2026-09-01, produced by a research subagent (corgi/park, dungeon,
ecosystem worlds, escape room). Corgi v1 is fully SHIPPED at the contract
layer (runway read + attributed third-party deposits both exist on-chain);
the gaps are SDK/indexing ergonomics, not protocol.

## Critical questions (verified in source)

**1a. Runway read: YES, account-level, one view call.**
`FilecoinPayV1.getAccountInfoIfSettled(token, owner)` returns
`fundedUntilEpoch, currentFunds, availableFunds, currentLockupRate` —
lib/fws-payments/src/FilecoinPayV1.sol:1738-1759. The SDK wraps it:
`getAccountSummary` returns `runwayInEpochs`
(synapse-core/src/pay/get-account-summary.ts:77,137; math in
pay/resolve-account-state.ts:91-110). High-level
`PaymentsService.accountInfo()` also exists
(synapse-sdk/src/payments/service.ts:109).
Nuance for the health model: `runwayInEpochs` measures epochs until the
account "enters deficit" — until it can no longer maintain the 30-day
streaming lockup tail — NOT until funds hit zero.
`grossCoverageInEpochs` (>= runway by roughly the reserve size) is the
"funds fully exhausted" number (get-account-summary.ts:83-91). Two free
health bars.
Per-DATA-SET runway is not first-class: runway is per (token, payer
account); a data set contributes `rail.paymentRate` to the account's
`lockupRate`. `dataSetInfo` gives payer + pdpRailId
(FilecoinWarmStorageService.sol:149-163, mapping :273; `clientDataSets`
per payer :281), `getRail` gives the rate (SDK pay/get-rail.ts).
**Design consequence: give each corgi a dedicated payer wallet (or
endowment contract) so account runway == corgi runway.**

**1b. Deposit history with sender attribution: YES on-chain, GAP in SDK.**
`event DepositRecorded(IERC20 indexed token, address indexed from,
address indexed to, uint256 amount)` — FilecoinPayV1.sol:109, emitted
with `from = msg.sender` in `deposit()` (:482). All three topics indexed:
a page can `eth_getLogs` filtered by `to = corgiPayer` for an attributed
feed log. Caveats:
- `depositWithPermit` emits `from = to` (:524) — permit deposits lose
  funder attribution. Feeders use plain `deposit`.
- No SDK helper reads event history (deposit.ts only parses your own tx
  receipt). Page must use raw viem `getLogs`; Filecoin public RPCs cap
  lookback range, so full history needs chunked scans or an indexer
  (Goldsky / foc-observer already index these events). **#1 feature ask:
  an SDK "account activity" read.**
- **Design correction to the deep-dive: feeding should be
  `Pay.deposit(USDFC, to: corgiPayer, amt)` — NOT a bare ERC20 transfer
  to the payer wallet.** A wallet transfer doesn't extend runway until
  someone deposits it; `deposit` credits the payments account
  immediately, settles the recipient's lockup as a side effect (modifier
  at :470), and emits the attributed event.

**1c. Third-party funding: YES, permissionless by design.**
`deposit(token, to, amount)` credits any `to`; sender pays
(FilecoinPayV1.sol:460-483). SDK exposes `to`
(synapse-core/src/pay/deposit.ts:29-30,98; react hook
use-deposit-and-approve.ts). Anyone can feed the corgi; only owner-level
ops (withdraw :752, operator approvals) need the payer key. Adoption
("deposit >= threshold spawns your corgi") is a pure client-side fold
over DepositRecorded — zero new contracts for v1.

**1d. Runway zero → data at risk: a protocol-guaranteed ~30-day memorial
window.**
- Rails carry `lockupPeriod = DEFAULT_LOCKUP_PERIOD = 2880*30 epochs =
  30 days` (src/lib/PriceListUSDFC.sol:14). While healthy, 30 days of
  payments are locked ahead.
- When funds run short, `settleAccountLockup` advances lockup only as
  far as funds cover and stalls `lockupLastSettledAt`
  (FilecoinPayV1.sol:1522-1541).
- Termination: the payer CANNOT terminate while in deficit (client
  termination requires fully settled lockup, :429-433); the operator
  (WarmStorage) can. On `terminateRail`, `rail.endEpoch =
  lockupLastSettledAt + lockupPeriod` (:435) — the SP is guaranteed
  payment through endEpoch from locked funds, only for PROVEN epochs
  (`validatePayment` pro-rates, FilecoinWarmStorageService.sol:1557-1606).
- WarmStorage: `terminateService` callable by payer or SP
  (FWSS:1073-1121, events :125,:133); SP abandonment keeps the PDP rail
  alive for DEFAULT_LOCKUP_PERIOD for underfunded payers
  (src/lib/Rails.sol:169-211).
So: runway 0 → up to ~30 days of locked funds still pay the SP → after
endEpoch the SP may delete. The deep-dive's "death before zero + memorial
countdown" maps EXACTLY onto protocol mechanics: declare death at
runwayInEpochs==0 and the memorial window IS the lockup tail (readable as
rail.endEpoch after termination, or grossCoverage before). Not theater —
cite the chain.

## Per-idea directions

**Corgi / corgi park.**
- A (gameplay): mood = distinct `from` addresses in DepositRecorded
  within a window — SHIPPED (events) / PATTERN (client fold + log
  chunking) / GAP (SDK activity read; wss push for live feeding
  animations is PATTERN). v2 care pieces (pats, naming) via authorizer —
  SHIPPED contract-side, GAP SDK ergonomics.
- B (economy): adoption tiers = deposit thresholds, SHIPPED.
  Resurrection pass / % platform fee: `deposit` has no fee hook — a cut
  requires a thin splitter contract (fee to treasury, rest deposited) —
  PATTERN. Rails support `commissionRateBps` (FilecoinPayV1.sol:77-86)
  but operator-side only — GAP for native "deposit with fee".
- C (enterprise): brand mascot / DAO corgi = payer is a Safe or
  endowment contract — PATTERN today; term-prepaid endowment as product —
  GAP. Sponsored creatures trivially permissionless (anyone can deposit).

**Crowd-Controlled Dungeon.**
- A: action points, cooldowns, tier gates = state-mutating authorizer
  within the 150M gas budget (fee derivation, PriceListUSDFC.sol:33-41)
  — SHIPPED (calibnet) / GAP (SDK write path).
- B: paid classes/actions. The authorizer CANNOT charge the actor: all
  fees (ADD_PIECES_BASE_FEE etc., PriceListUSDFC.sol:38-41) come from
  the PAYER's lifecycle reserve, and contracts can't read deposit
  events. PATTERN: a purchase contract records entitlements; the
  authorizer reads that state at write time. GAP (big): an actor-pays /
  one-time-payment hook at AddPieces time — "this action costs the
  WRITER 0.1 USDFC" as a protocol primitive.
- C: branded dungeons, ticketed raids = purchase-contract pattern +
  endowed data set. PATTERN.

**Global ecosystem / cross-data-set worlds.**
- A: one authorizer instance can serve many data sets (receives
  dataSetId; setDataSetAuthorizer per set, FWSS:316-321) — PATTERN,
  cheap. Client folds over N logs — PATTERN.
- B/C: per-creature/per-room data sets taxed: CREATE_DATA_SET_FEE
  $0.025 + 0.12 USDFC/mo dataset fee + lockup reserve per set
  (PriceListUSDFC.sol:20-21,38) — "cheap many-small-datasets" GAP is the
  binding constraint; multi-tenant logs are the workaround. No
  cross-data-set atomicity — GAP, but folds tolerate it.

**Distributed Escape Room.**
- A: capability unlocks = commit-reveal / hash-preimage checks in the
  authorizer, mutating per-key permission state — PATTERN (pure
  Solidity, within gas budget).
- B: metered hints = sell decryption keys for encrypted hint pieces via
  a purchase contract — PATTERN (app-level encryption). Native
  paid-read/paid-retrieval microtransaction — GAP (FilCDN egress pricing
  pays the SP/CDN, PriceListUSDFC.sol:24-25; it is not a consumer
  paywall).
- C: corporate team-building rooms; ticket = entitlement NFT read by
  authorizer — PATTERN.

## Top 5 missing features for this cluster (ranked)

1. **SDK "account activity" read** — deposit/withdraw/settlement history
   for a payments account with sender attribution (wrapped, chunked
   getLogs over DepositRecorded/RailSettled + optional indexer backend).
   Blocks the corgi v1 centerpiece; reusable by every payments dashboard.
2. **Ergonomic authorizer path in SDK/filecoin-pin** (setDataSetAuthorizer
   + authorizer-mediated writes) — gates dungeon, escape room, park v2.
3. **Actor-pays action fees**: a one-time-payment hook charging the
   WRITER at AddPieces/authorizer time, with commissionRateBps-style fee
   splits — unlocks paid classes, hints, adoptions natively.
4. **Cheap many-small-datasets** (lower fixed per-dataset cost or
   first-class sub-logs) — per-creature/per-room isolation.
5. **Term-prepaid / endowment storage as product** (with retention lock)
   — corgi endowments, memorial-wall permanence, brand mascots.

**Bottom line: corgi v1 needs zero new contracts and zero write path — a
page + viem getLogs + Pay.deposit(to). Design corrections: feed via
FilecoinPay.deposit (not wallet transfer), dedicate one payer wallet per
corgi, and use runway vs grossCoverage as the two health bars.**
