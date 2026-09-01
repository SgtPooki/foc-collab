# ACL-era game strategy: what to polish for a splash

Captured 2026-09-01 from the planning discussion after dataset-level ACLs
(filecoin-services#536) merged and shipped to Calibnet v1.4.0, mainnet in
progress. Companion to `../docs/IDEAS.md` (raw idea list) and
`../docs/FEASIBILITY.md` (substrate assessment).

## The lens

The ACL's superpower is safe crowd-scale writing: sponsored writes with
contract-enforced rate limits mean the audience of a tweet becomes the
players, zero onboarding, blast radius bounded to one data set. So the
flagship should be a game where THE CROWD is the game — not 2-player.

## Ranking

1. **Paint war — flagship.** "r/place, but the backend is Filecoin."
   - The ACL is not plumbing here, it IS the game mechanic: r/place's
     defining rule (one pixel per user per cooldown) is exactly a
     state-mutating authorizer enforcing per-key cooldowns.
   - The 30-60s latency disappears entirely: no turns, canvas evolves
     continuously, the cooldown means you were waiting anyway.
   - Event sourcing gives the marketing asset for free: the log IS a
     timelapse ("watch 500 people fight over a canvas, replayed from the
     chain").
   - Polish scope: zoom/pan canvas, cooldown-as-ritual (press-and-hold to
     place), timelapse scrubber, authorizer contract (permissive +
     cooldown + piece-size cap), snapshot pieces so late joiners don't
     fold the whole history, P-256 feasibility check for direct browser
     identity signing.

2. **Conway's Life seeding — the cheap teaser (week-one event).** Burst
   crowd: a 48h seeding window (one cell-claim per key, ACL-enforced),
   then deterministic fireworks everyone watches. Shares ~90% of infra
   with paint war (grid canvas, claim pieces, cooldown authorizer,
   timelapse renderer). Ship first on the same rails.

3. **Internet jukebox — second wave, different audience.** "Anyone on the
   internet can queue a song" was unshippable with an account-wide key,
   trivially safe with a sponsored authorizer + one-enqueue-per-epoch.
   Proves the non-game viewer-saves thesis to the builder crowd.

Cooled for now: silent auction standalone (nothing real at stake as pure
demo), prisoner's dilemma league (deep but niche, needs cohorts — slow
burn), battleship standalone (2-player, no crowd — but see below).

## The Filecoin-birthday event (Russell, 2026-09-01)

Filecoin's birthday is coming up. A TIMEBOUND paint war with an in-game
plot auction could be huge for the revitalization story: you can STORE
easily now, RETRIEVE easily, and do programmatic stateful things without
a server and without tying into one provider.

- Auction layer: "auction plots on the paint canvas" as a layer-2 event
  inside paint war — bids are pieces (commit-reveal if blind), winning a
  plot grants the winner('s team) exclusive or boosted paint rights on
  that region, enforced by the authorizer.
- Timebound framing gives urgency + a natural highlight-reel ending
  (final canvas + full timelapse published permanently to FOC — the
  artifact stores itself).

## Custom authorizers: confirmed mechanics (from merged source)

- `FilecoinWarmStorageService.setDataSetAuthorizer(dataSetId, authorizer)`
  — payer-only, any deployed contract, rotatable and clearable (address 0)
  (FilecoinWarmStorageService.sol:1540).
- When attached, the authorizer REPLACES the payer-signature/session-key
  check for that data set: FWSS calls
  `isAuthorized(dataSetId, payer, operationTypehash, digest, signature,
  operationData)` and a false/revert blocks the op.
- Subcall gets a 150M gas ceiling and a reentrancy latch
  (SignatureVerificationLib.sol:301,314) — plenty for cooldown state,
  allowlists, even in-contract P-256 recovery.
- `isAuthorized` is state-mutating by design: nonces, cooldowns, quotas,
  per-region rights are all first-class.
- So yes: fully custom authorizers are the supported path, not a hack.

## BYOW + monetization (investigate for every game)

Open thread from Russell: let people bring their own wallet, still limit
gameplay, and maybe charge a small % somewhere for handling the
complexity. Free-to-play stays free; paying unlocks features.

What the mechanics allow:
- `isAuthorized` is nonpayable and called BY FWSS, so the authorizer
  cannot take a cut in-line. Monetization lives in the authorizer's OWN
  state: players call e.g. `authorizer.buyPass{value}()` /
  `upgradeTier()` from their wallet, and `isAuthorized` gates on that
  registry (tier, cooldown discount, plot rights, cosmetics flag).
- Free tier: sponsored writes, standard cooldown. Paid tier ideas:
  shorter cooldown, bigger brush, plot reservations, auction entry,
  name/flair in the fold.
- Storage economics: the payer funds every piece regardless. Pass fees
  can flow to the payer's wallet to offset the sponsored storage budget —
  the game funds its own storage.
- BYOW identity: the authorizer recovers signers itself "on whatever
  curve it supports" — a BYOW player signs ops with their own wallet key,
  no session key needed; browser-key players could use P-256 if recovery
  proves practical on FEVM (needs a spike: precompile availability vs
  Solidity-implementation gas).

## Massively-multiplayer hidden-state / territory ideas (raw)

- Battleship-over-the-paint-canvas: hidden structures placed under canvas
  regions; painting a cell can "hit" them. Merges commit-reveal with the
  crowd canvas instead of a lonely 2-player grid. Needs design work —
  parked.
- Risk as an effectively-infinite-player territory game: factions, claim
  pieces, per-epoch resolution. Super cool, huge design surface — the
  fold stays deterministic but conflict resolution and faction membership
  need real thought. Parked behind paint war.

## Next spikes (in order)

1. Minimal cooldown authorizer deployed to calibration, attached to a
   fresh data set with `setDataSetAuthorizer`; drop the embedded session
   key from a test build.
2. P-256 recovery feasibility on FEVM (cost, precompile availability).
3. Snapshot-piece format so folds truncate history.
4. Pass/tier registry sketch for the BYOW monetization model.
