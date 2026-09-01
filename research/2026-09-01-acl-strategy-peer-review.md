# Peer review of the ACL game strategy: four-agent synthesis

2026-09-01. Reviewers: Codex, Cursor, Gemini (Antigravity), local Qwen
(omp). Target: `2026-09-01-acl-games-strategy.md`. All four upheld the
ranking (paint war flagship, Life second, jukebox second wave) and all
four converged on the same corrections.

## Consensus corrections (act on these)

1. **Moderation is a launch requirement, not polish (4/4).** The canvas
   and its timelapse are immutable and public; malicious pixel art is
   forever. The only mechanism that fully works is pre-commit: the
   authorizer checks a blocklist BEFORE the piece lands (one SLOAD,
   negligible gas). Complement: a frontend CID blocklist the fold skips,
   and/or an admin "erase" piece type that bypasses cooldowns. Design the
   moderation policy before pixels, not after.

2. **Sybil resistance decides whether cooldowns mean anything (3/4).**
   Free browser keys = infinite identities = cooldowns are decoration; a
   10k-key botnet drains the sponsor budget. Pick a policy up front:
   stake/balance gate (e.g. wallet holds >0 FIL), one-time entry fee into
   the pass registry, wallet-only writes, or accept-and-hard-budget.
   This is a product decision, not an implementation detail.

3. **"Latency disappears" is oversold (3/4).** It disappears for
   spectators, not for contested pixels: both painters see success, one
   is overwritten a minute later. The tic-tac-toe optimistic-pending +
   "lost the race" pattern must scale to pixels, with clear
   intended-vs-final semantics.

4. **Snapshots are core infrastructure with an authority problem (3/4).**
   Late join at tweet scale fails without them, and the authorizer cannot
   verify a snapshot is a correct fold (far beyond any gas budget) — so
   snapshots come from a trusted admin key. A deliberate, documented
   centralization point.

5. **Hard event budget in the authorizer (3/4).** Beyond cooldowns: max
   pieces/bytes per epoch, per-signer and per-region caps, write-side
   piece-size cap (stop junk at the contract, not the 8KB client guard),
   emergency pause, graceful "event full".

6. **Birthday timeline: cut scope (4/4).** Oct 15 is ~6 weeks out. The
   shippable birthday deliverable: cooldown authorizer + minimal bounded
   canvas (64x64, hard budget) + blocklist + snapshots + timelapse.
   DEFER: plot auction (also has "pay-to-vandalize" optics), BYOW
   monetization, P-256. Life seeding reframed as the public rehearsal of
   the same stack, only if it costs nothing extra.

7. **Don't block on P-256 (4/4).** Qwen's estimate: no FEVM precompile,
   ~150-500k gas per Solidity recovery — workable per-call but tight at
   crowd scale. Fallback that still wins: players keep browser P-256 keys
   for game-level signatures (as today), chain writes go through a
   secp256k1 session key — account-wide by nature, but the attached
   authorizer scopes what it can do to the one data set, which was the
   original complaint.

8. **BYOW cash-flow fix (Qwen):** the payer funds storage BEFORE any fee
   flows back. Make the authorizer an escrow: deposit up front,
   `isAuthorized` checks balance and decrements per write; tiers set the
   per-piece rate (free tier sponsored, paid tiers offset the payer).

9. **Jukebox needs catalog constraints (Codex):** payloads restricted to
   IDs/URLs from allowed providers, never stored media — copyright,
   phishing, and ToS live in the payload design.

10. **Revised spike order (Cursor):** (1) SDK/browser write path through
    a custom authorizer end-to-end on calibration; (2) snapshot format +
    incremental sync; (3) cooldown authorizer with budget + size caps;
    (4) Sybil policy; (5) P-256 gas benchmark; (6) pass/tier registry;
    (7) auction — post-splash.

## New ideas contributed (merged catalog)

**Crowd-shapes-the-world (strongest cluster — Codex + Gemini converged):**
- **Crowd-Controlled Dungeon Master / Decentralized Dungeon** — players
  or viewers spend scarce signed actions (spawn traps, bless, move,
  attack) against a shared dungeon; the authorizer IS the dungeon master:
  action-point quotas, weapon cooldowns, tier-gated strong actions, paid
  classes as permanent authorizer state.
- **Global Tamagotchi** (Gemini) — the community keeps one creature
  alive; global per-epoch feeding quotas, per-key cooldowns, a death
  flag only "resurrection" pass-holders can lift. Extremely tweetable.

**Mechanism showcases (Cursor):**
- **The Baton** — single-writer relay: the authorizer tracks the current
  holder; only they may append; handoffs are atomic. Sequential
  exclusivity as gameplay.
- **Quorum Alarm** — one-shot-per-key threshold trigger; state flips at N
  distinct contributors. The minimal demo of stateful quotas.
- **Cooldown Swap Meet** — transferable write entitlements; a market in
  write rights without payments inside isAuthorized.
- **Action-Budget Senate** — separate quotas per action type on one data
  set (1 nominate / 3 second / 1 veto per week); governance-shaped.
- **Palette Duty** — authorizer-assigned faction roles (R/G/B teams) as
  first-class on-chain rules.

**Events & products:**
- **Proof-of-Attendance Mosaic Race** (Codex) — conference canvas,
  region eligibility by registry; strong booth/launch-event fit.
- **Public Patch-Notes War Room** (Codex) — roadmap as fold; scarce
  tiered governance actions.
- **Distributed Escape Room** (Codex) — shared puzzle state; capabilities
  earned by solving side puzzles; quota-metered hints.
- **Million Dollar Homepage sandbox** (Gemini) — plots hold small
  HTML/WASM widgets; authorizer enforces plot ownership + byte caps.
- Qwen name-dropped five (Claim & Hold, Fog of War, Pixel Auction, Echo
  Chamber, Foc-opoly) without details — seeds only.

## Open decisions for Russell

1. Sybil policy for the birthday canvas: balance gate, entry fee,
   wallet-only, or hard-budget-and-accept?
2. Moderation stance: pre-commit blocklist + admin erase pieces — who
   holds the admin key, and what is the takedown SLA story for the
   permanent timelapse?
3. Confirm the birthday scope cut (canvas without auction) or push the
   event later.
4. Which new idea earns the second polish slot — Global Tamagotchi and
   the Dungeon cluster were the reviewers' implicit favorites.
