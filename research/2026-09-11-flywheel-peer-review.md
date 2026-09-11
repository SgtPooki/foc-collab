# Peer review of the cross-cutting feature analysis, 2026-09-11

Prompt sent to Cursor, Codex, and Gemini after commit 056019b: is the five-feature analysis accurate, what is missing, what is the one flywheel move, three envelope-pushing ideas, and risks in the recommended order. Raw responses follow, unedited.

## Prompt


# Review request: the cross-cutting feature analysis for foc-collab, and the flywheel question

Read first: CLAUDE.md, docs/FEASIBILITY.md (the 2026-09-11 updates), research/2026-09-01-build-order-and-capability-matrix.md (the capability matrix), research/2026-09-11-state-peer-review.md (your peers' last round), research/2026-09-11-crowd-moves-brainstorm.md (skim), docs/IDEAS.md, games/lib/byow-engine.js, games/lib/play-byow.js (header comments), games/lib/transport-byow.js (header and the writer), scripts/spike-authorizer.mjs, contracts/authorizer/src/CooldownAuthorizer.sol, apps/corgi/fold.js (header). Open issues #1 (chatroom), #2 (CPU opponent), #5 (betting, parked), #6 (crowd moves), #7 (latency measurement) via `gh issue view N`.

## State as of commit 056019b (2026-09-11)

- Two BYOW games (tic-tac-toe, connect-four) on a shared page shell; seats owned by home data set; one data set per wallet serves every game; a computer opponent plays inside the player's own data set (no second data set).
- The corgi: a tamagotchi whose life is the runway of a Filecoin Pay payer account.
- Authorizer spike proven on calibration: CooldownAuthorizer deployed at 0x3b129f01bd364c2306445b55b005aad3295d1aa1, attached to scratch data set 35407 with FWSS.setDataSetAuthorizer; a key with no session key anywhere wrote a piece through the unmodified SDK (with local expirations faked); a second write inside the cooldown was refused by the chain. The SDK's onPiecesAdded fires on submission, not confirmation; a move shows on the other side about a minute after it is sent and nobody has measured why (issue #7).
- Glif calibration caps eth_getLogs at 2880 blocks; discovery scans in 2000-block chunks; the Foc-observer PieceAdded index is stalled so discovery is raw RPC.

## The analysis under review (written by the author, Claude, today)

Cross-cutting features, ranked by how much they unlock:

1. Sponsored write path + one arcade-owned data set: deploy a CooldownAuthorizer instance with production parameters and a GLOBAL rate cap (per-key cooldown alone is sybilable), create one arcade data set, attach it, put { sponsored: { dataSet, authorizer } } in the site config, move the spike's writer (fromSecp256k1 with far-future expirations, hand-rolled setDataSetAuthorizer ABI) into games/lib/transport-byow.js as a "sponsored" writer. Claimed to unlock: paint war, jukebox, Conway's Life seeding, guest chat, crowd-move team data sets. Bonus: the arcade data set is a Filecoin Pay payer account, so the corgi's fold shows the arcade's runway and feeding the corgi funds everyone's free writes.
2. Commit-reveal primitive in the engine (hash in the piece, reveal later, fold verifies): unlocks silent auction, battleship, prisoner's-dilemma league, any simultaneous-move game.
3. Page-speed chaining of your own pieces: reference an unsettled piece since ids are assigned in upload order within one data set; solo and same-data-set games feel instant, settlement trails.
4. Snapshot pieces by a trusted writer for long logs (paint war, chat, jukebox history).
5. Multi-game dashboard ("Words with Friends" framing) so the minute per move hides behind several games at once.

Recommended order: 1, then paint war on top of it as the flagship, then 2.

Russell (the owner) says: he likes the things that unlock paint war, jukebox, guest chat, and Words-with-Friends-style play, and he wants to push the envelope.

## What I want from you

1. Is the analysis accurate? For each of the five features: does it unlock what is claimed, does it unlock MORE than claimed, or less? Ground it in the code and the contracts (for example: does a sponsored single data set really give a total order for free; what does the CooldownAuthorizer as written actually allow and not; is page-speed chaining sound given how the SP assigns piece ids and how prev refs work in byow-engine.js; is a global rate cap enough against sybils; does snapshotting need a trusted writer or can the fold verify a snapshot).
2. What is missing? Features or primitives that would unlock more than any of these five. Think about: read-side scaling (N data sets per poll), an indexer we own, push/WebSocket subscription, libp2p gossip for latency hiding (research/2026-09-10-byow-and-latency.md ranked it), WebAuthn/passkey signers through the authorizer (the design anticipates P-256 payloads), payer-as-contract endowments, agent players, anything else.
3. The flywheel question: what is the ONE move that makes iterating faster in every direction at once? Candidates: a generic "room" engine so any many-writer app is a fold plus a renderer; a local dev harness that fakes the chain/SP so a game can be developed without calibration; a test SP or mock; a shared sponsored data set that every new prototype can write to on day one; something else. Argue for one.
4. Push the envelope: three ideas that go beyond the list, each with what primitive it needs and whether that primitive exists today.
5. Risks in the recommended order (sponsored path, then paint war, then commit-reveal). What would you do differently and why.

Be direct and specific. Ranked lists with file paths beat prose. Do not pad.

## Review: Cursor

# Cross-cutting feature analysis review (commit `056019b`)

Grounded in: `docs/FEASIBILITY.md`, `games/lib/byow-engine.js`, `games/lib/transport-byow.js`, `contracts/authorizer/src/CooldownAuthorizer.sol`, `scripts/spike-authorizer.mjs`, `games/lib/play-byow.js`, `apps/corgi/fold.js`, issues #1/#2/#5/#6/#7, and the research docs you named.

**Context the analysis understates:** since the Sept 11 peer review, three things already landed — authorizer spike (`e91dbbf`), shared page shell (`52eaa76`), solo CPU in one data set (`913374e`). Issue #2 is still open (LLM angle), but one-wallet play exists today via `create.cpu` + `spec.cpu` in `play-byow.js`.

---

## 1. Feature-by-feature accuracy

### 1. Sponsored write path + one arcade-owned data set

| Claim | Verdict | Grounding |
|---|---|---|
| One arcade DS → total order for free writes | **Accurate** for single-log apps | `FEASIBILITY.md:42-47`: piece ids are monotonic per data set; paint war / jukebox / guest chat are append-only folds over one log |
| `CooldownAuthorizer` enables zero-wallet writes | **Accurate, proven** | `spike-authorizer.mjs` + `FEASIBILITY.md:131-153`; stranger secp256k1, no session key, second write refused |
| Move spike writer into `transport-byow.js` | **Accurate, necessary** | `openWriter()` today is session-key-only (`transport-byow.js:126-161`); spike pattern is `fromSecp256k1` + faked expirations + hand-rolled `setDataSetAuthorizer` |
| Unlocks paint war, jukebox, guest chat, Life seeding | **Accurate** | `IDEAS.md:15-27,43-48`, `acl-games-strategy.md:17-36` — all need data-set-scoped sponsored writes, not account-wide keys |
| Unlocks crowd-move **team** data sets | **Accurate, narrower than “crowd moves”** | `crowd-moves-brainstorm.md:233-238`: shared sponsored DS per team fixes proposal ordering *within* a team; captains + cross-team BYOW still need wallets |
| Corgi flywheel (arcade payer = feed everyone’s writes) | **Directionally right, not wired** | `corgi/fold.js:3-7`: life = payer runway; arcade DS payer *could* be the corgi. No code links site `sponsored` config → corgi today |
| GLOBAL rate cap stops sybils | **Claimed but not implemented** | `CooldownAuthorizer.sol:41-42,73-75`: state is `lastWrite[dataSetId][signer]` only. Fresh key = fresh slot. Analysis is right that per-key cooldown is sybilable; wrong to imply the contract already has a global cap |

**What it unlocks MORE than claimed**

- v1-style shared-log apps without embedded publisher session key (`FEASIBILITY.md:88-108` blast-radius fix)
- Slow bulletin board / wiki (`IDEAS.md:45-50`)
- Proposal channel for crowd Rule C (`crowd-moves-brainstorm.md`) without N funded wallets per team

**What it unlocks LESS than claimed**

- **Does not** fix BYOW 1v1 (still two wallets, ratification, cross-DS reads)
- **Does not** fix ~60s settlement or discovery (`transport-byow.js:307`, `pollMs: 8000`; `confirmedList()` === `list()` at 349-351)
- **Does not** deliver production paint war: build order wants blocklist + hard budget + size cap + snapshots (`build-order-and-capability-matrix.md:32`, `acl-games-strategy.md:27-28`)
- **Does not** let P-256 `identity.js` keys authorize writes directly — authorizer recovers **secp256k1 only** (`CooldownAuthorizer.sol:80-93`). Browser identity stays integrity-only; chain auth is a separate ephemeral secp256k1 key unless you add P-256 recovery or dual-sign

**Sponsored single DS and total order:** yes, *inside that data set*. That is exactly what paint war / jukebox / chat need. It is the opposite of BYOW’s model (`byow-engine.js:12-15`: no single log across players).

---

### 2. Commit-reveal primitive in the engine

| Claim | Verdict | Grounding |
|---|---|---|
| Hash now, reveal later, fold verifies | **Accurate as new primitive; does not exist** | No commit/reveal in `byow-engine.js`; `prev`/`lastRef` are content refs (`identity.js:49-52`), not hidden commitments |
| Unlocks silent auction, battleship, PD league, simultaneous moves | **Mostly accurate** | `IDEAS.md:14-22`; `canvas-cluster-report.md:230-234` — mechanics are ordinary pieces + fold rules |
| Works on sponsored arcade DS | **Yes** | Single DS → piece-id total order is enough for commit/reveal ordering |

**More than claimed:** plot auctions inside paint war (`acl-games-strategy.md:54-57`); sealed baton legs (`baton-cluster-report.md`)

**Less than claimed:**

- **BYOW simultaneous moves** still need a fold rule for “both committed before either reveal” with **no cross-DS clock** (`byow-engine.js` has no wall clock). Commit-reveal per seat in separate DS is not automatic simultaneous play — you need explicit phase logic (both `commit` pieces for seq N before any `reveal`)
- **Money** at reveal is a separate primitive (#5, escrow GAP in capability matrix)
- Phase deadlines trustlessly want authorizer timestamp/metadata gating (`canvas-cluster-report.md:237-242`), not engine alone

---

### 3. Page-speed chaining of your own pieces

| Claim | Verdict | Grounding |
|---|---|---|
| Chain off unsettled piece; ids follow upload order | **Partially sound, overstated** | `prev` is `sha256` of signed body (`identity.js:49`), not `pieceId`. Writer can compute `ref` locally before settlement (`play-byow.js:290`) |
| Solo / same-DS feels instant | **UI-only for human; pipeline possible for writer** | Solo: `byow-engine.js:152-160,202-209` — same DS, token distinguishes seats, lowest `pieceId` wins. `pendingMove` gives optimistic board (`play-byow.js:117,322-326`) |
| Settlement trails | **Accurate** | `transport-byow.js:148-157`: append resolves at `onPiecesAdded` (submission); opponents learn via `getActivePiecesByCursor` poll |

**Soundness caveats (important):**

1. **Opponents never fold unlisted pieces** — chained move 2 with `prev = ref(move1)` is ignored until move1 appears in `all` (`byow-engine.js:207-209`). Chaining helps *your* upload pipeline, not *their* UX.
2. **Piece id order ≠ submission order until chain assigns ids** — if two uploads are in flight, lowest-id-wins can drop the “later” intent (`byow-engine.js:207-209`). Safe pattern: one in-flight append (`play-byow.js:425`).
3. **Orphan risk** — if move1 never lands, move2 is permanently invalid (good for safety, bad for pipelining).
4. **Cross-DS BYOW:** irrelevant; each seat’s chain is in its home DS only.

**Unlocks less than claimed:** does not substitute for gossip/push (#7, `byow-and-latency.md:34-38`). CPU already plays in solo without cross-move chaining (`play-byow.js:413-421`).

---

### 4. Snapshot pieces

| Claim | Verdict | Grounding |
|---|---|---|
| Trusted writer for long logs | **Accurate for production paint war / chat** | `IDEAS.md:75-77`; `canvas-cluster-report.md:156` |
| Fold can verify snapshot | **Only partially** | Fold can verify **structural** continuity (snapshot carries `lastRef` / high-water `pieceId`, subsequent pieces chain). Fold **cannot** verify snapshot *correctness* without replaying full history (gas-budget argument in `acl-strategy-peer-review` / `canvas-cluster-report.md:156`) |
| Authorizer can enforce snapshot authorship | **Exists as pattern, not in repo** | Admin-only metadata tag for `type=snapshot` — on-chain authorship, off-chain correctness trust |

**Less than claimed:** snapshots are a read-scale checkpoint, not a trust elimination. Late joiners still need pieces after the snapshot or they trust the arcade.

---

### 5. Multi-game dashboard (“Words with Friends”)

| Claim | Verdict |
|---|---|
| Hides minute-per-move behind parallel games | **Accurate as product framing** |
| Needs new substrate | **No** — lobby already folds all games (`byow-engine.js:217-223`, `play-byow.js` lobby). This is shell/UX |

**More than claimed:** retention layer for BYOW without sponsored path.

**Less than claimed:** does not reduce RPC load (each game still multi-DS poll), does not help first-time onboarding (~3 min wallet path still there).

---

## 2. What is missing (ranked by leverage)

| # | Missing primitive | Blocks | Exists today? |
|---|---|---|---|
| 1 | **Latency breakdown (#7)** | Honest UX, poll tuning, chaining decisions | Not measured; folklore “~60s” |
| 2 | **Production authorizer** (global epoch budget, blocklist, byte-size cap, piece-count cap) | Paint war at crowd scale | Spike only: per-key cooldown (`CooldownAuthorizer.sol`) |
| 3 | **Incremental read sync** (high-water `pieceId`, CID cache) | Paint war, crowd `dataSetsOf`, chat | Cursor API yes (`FEASIBILITY.md:37-38`); client work no (`transport-byow.js` refetches all DS) |
| 4 | **Owned / reliable PieceAdded indexer** | Lobby, opponent find | Foc-observer stalled; raw `eth_getLogs` + 2000 chunks (`discover.js`, `transport-byow.js:220-221`) |
| 5 | **Push / WSS / libp2p optimistic layer** | “Try my demo” | Seam exists (`confirmedList`); unimplemented (`byow-and-latency.md`) |
| 6 | **Generic room fold** (append-only / grid, not seat-owner) | Chat (#1), jukebox, canvas — faster than forcing everything through `byow-engine.js` | Pattern in corgi fold; no shared module |
| 7 | **P-256 / WebAuthn authorizer path** | Wallet-free identity aligned with `identity.js` | Anticipated in filecoin-services; **not** in `CooldownAuthorizer.sol` |
| 8 | **SDK ergonomics** for `setDataSetAuthorizer` | DX for every authorizer app | GAP (`build-order-and-capability-matrix.md:100`) |
| 9 | **Local transport mock / test SP** | Fast iteration without calibration | Local transport for v1; no BYOW/authorizer mock |
| 10 | **Payer-as-contract endowment** | “Provably funded N years”, betting pot (#5) | PATTERN (`build-order-and-capability-matrix.md:65-71`) |
| 11 | **Agent players** (separate-wallet bot) | Issue #2 as stated, Baton | Solo CPU in one DS only (`913374e`) |

---

## 3. Flywheel: the ONE move

**Pick: integrate sponsored arcade write path into `transport-byow.js` + one production authorizer + `{ sponsored: { dataSet, authorizer } }` in site config.**

Why this beats the other candidates:

| Candidate | Helps iteration how | Fails how |
|---|---|---|
| Generic room engine | Fast after it exists | Big design cut; paint war still blocked on writes |
| Local dev harness | Fastest *engineering* loops | Zero external demo value; doesn’t unlock jukebox/chat/crowd |
| Test SP / mock | Unit tests | Hides calibration reality (#7, Glif caps) |
| Shared sponsored DS | **Every envelope prototype writes on day one** | — |

The authorizer spike is **proven but stranded in `scripts/spike-authorizer.mjs`**. Russell’s stated loves (paint war, jukebox, guest chat, WwF-style *retention*) all converge on “many writers, one bounded DS.” That is the only item that simultaneously:

- Turns ACL from demo into product surface
- Gives paint war a home without per-visitor wallet onboarding
- Feeds the corgi monetization story (arcade payer runway)
- Becomes the shared substrate for chat/jukebox/Life prototypes

**Caveat:** pair with **incremental read sync** before paint war goes public — otherwise N writers × full refold kills the browser.

---

## 4. Three envelope-pushing ideas (beyond the five)

### A. Live timelapse-as-publishable artifact
- **Idea:** During paint war, the fold replays to any frame; “Publish final canvas + timelapse” pins the event to FOC via existing publish skill.
- **Primitive:** sponsored arcade DS + snapshot checkpoints + static renderer.
- **Exists today?** Fold/replay yes; sponsored DS + snapshots no.

### B. Corgi-fed arcade (deposit → shorter cooldown / bigger brush)
- **Idea:** Feeding the corgi deposits into the arcade payer; authorizer reads Filecoin Pay balance or an on-chain pass registry to tier cooldowns.
- **Primitive:** production authorizer with pass registry + corgi wallet = arcade payer.
- **Exists today?** Corgi fold yes (`apps/corgi/fold.js`); authorizer pass gating no (`acl-games-strategy.md:85-95`).

### C. Calibration betting league on piece-log outcomes (#5 × #6)
- **Idea:** Spectators stake on crowd-game captains; fold computes winners; pot is a payer-contract endowment.
- **Primitive:** commit-reveal or public moves + betting fold + payer-as-contract custody.
- **Exists today?** Issue #5 parked; no escrow primitive in filecoin-pay (`canvas-cluster-report.md:249-254`).

---

## 5. Risks in recommended order (1 → paint war → commit-reveal)

### Order: mostly right, wrong on sequencing details

| Step | Risk | Severity |
|---|---|---|
| **1. Sponsored path** | Ship spike CooldownAuthorizer as-is → sybil spam drains arcade payer | **High** — need global epoch budget + size cap before public URL |
| **1.** | Dual-key UX confusion (P-256 piece sig vs secp256k1 AddPieces) | **Medium** |
| **1.** | `setDataSetAuthorizer` + faked expirations forever in every app | **Medium** — SDK gap persists |
| **2. Paint war** | Read cost: every client polls + refolds entire arcade log | **High** without incremental sync + snapshots |
| **2.** | Birthday scope creep (auction, blocklist, timelapse) | **Medium** — `build-order-and-capability-matrix.md:32-34` already scoped this |
| **2.** | Discovery/lobby irrelevant for one DS — good — but **removals** unexercised | **Low-Medium** for dispute story |
| **3. Commit-reveal** | Distraction before crowd flagship works | **Low** if truly deferred |
| **3.** | BYOW simultaneous games need phase rules, not just hash/reveal | **Medium** |

### What I would do differently

1. **Sponsored transport integration first** (analysis #1) — agree; it is the unblocker.
2. **Extend authorizer before public paint war** — global per-epoch piece budget + `maxPiecesPerOp` + decode size from `operationData` (`FEASIBILITY.md:149-150`). Per-key cooldown alone is not enough (`acl-strategy-peer-review`).
3. **Run #7 in parallel, not after chatroom** — you cannot tune chaining, polling, or copy without timestamps (`issue #7`).
4. **Incremental sync + snapshot format before paint war MVP**, not after — otherwise first viral tweet DoS’s readers.
5. **Paint war MVP:** 64×64, cooldown, blocklist, one snapshot type — defer plot auction (needs commit-reveal + escrow).
6. **Commit-reveal when building auction or battleship**, not before paint war — agree with analysis rank.
7. **Ship solo CPU on site** (already in code) and **multi-game dashboard** as cheap product wins that do not need authorizer — analysis omits these while WwF framing is free leverage.
8. **Do not** pursue crowd moves v3 on BYOW multi-wallet until sponsored team proposal DS exists — otherwise onboarding × N kills the demo.

---

## Bottom line

The analysis is **directionally correct**: sponsored single arcade DS is the highest-leverage substrate unlock for Russell’s loved ideas; commit-reveal is the right second primitive for hidden information; snapshots and WwF dashboard are real but secondary.

It **overstates** what today’s `CooldownAuthorizer` provides (no global cap, no size/metadata rules), what page-speed chaining buys (writer-side only; `prev` is `ref` not `pieceId`), and how much the corgi flywheel is wired. It **understates** what already shipped (solo CPU, shared shell, authorizer proof) and the read-side prerequisites (incremental sync, indexer, #7) without which paint war fails operatively even if writes work.

**Recommended sequence:** sponsored transport + hardened authorizer → incremental read + snapshots → paint war MVP → commit-reveal when you pick up auction/battleship. Run #7 and site CPU in parallel, not instead.

## Review: Codex

**Verdict**
The analysis is directionally right, but it overstates feature 1 and feature 3. The biggest missing lever is read-side infrastructure, not another fold primitive.

**1. Sponsored Write Path + One Arcade Data Set**
Mostly accurate, but underspecified.

A single sponsored data set does give a real total order, but only for pieces in that data set. That is exactly what BYOW avoided: current seats are owned by home data sets, and moves are ordered by `pieceId` inside one home data set ([byow-engine.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/byow-engine.js:12), [byow-engine.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/byow-engine.js:202)). For paint war, guest chat, jukebox, and Life seeding, that is a good fit. For crowd-move team data sets, it helps only if the team has a sequencer data set or the fold treats one shared data set as the team clock.

The current `CooldownAuthorizer` does not implement the claimed production policy. It allows payer-anything, non-payer AddPieces only, max pieces per operation, and per-signer cooldown ([CooldownAuthorizer.sol](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/contracts/authorizer/src/CooldownAuthorizer.sol:16), [CooldownAuthorizer.sol](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/contracts/authorizer/src/CooldownAuthorizer.sol:67)). It has no global cap, no byte-size cap, no metadata allowlist, no app/game allowlist, no daily budget, and only secp256k1 recovery. A global rate cap protects spend but is not enough against sybils: one attacker can consume the whole arcade write budget. You need per-key cooldown plus global budget plus admission friction: SIWE/passkey binding, allowlist, proof token, paid deposit, or social moderation.

The corgi tie-in is real but only if the arcade data set’s payer is the corgi account. `apps/corgi/fold.js` derives life from payer runway and deposits ([fold.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/apps/corgi/fold.js:1)). That is a strong product loop: feed corgi = fund free writes.

**2. Commit-Reveal Primitive**
Accurate, and it unlocks more than listed.

It unlocks silent auction, battleship, simultaneous moves, prisoner’s dilemma rounds, sealed votes, anti-copy move selection, and “predict then reveal” mechanics. It fits the current fold discipline because commits and reveals are ordinary signed pieces; the fold verifies hash preimage synchronously.

Caveat: reveal liveness needs a rule. With no clock in folds, “reveal by deadline” cannot depend on wall time unless you use block/epoch as an explicit display or settlement fact. Better first version: fixed participant set and resolution once all commits/reveals land, with forfeits only via later contract/epoch primitive.

**3. Page-Speed Chaining Of Own Pieces**
Partly sound, partly aspirational.

Sound scope: same data set only. Solo games already put both seats in one data set and distinguish writers by token ([byow-engine.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/byow-engine.js:45)). A human move can reference the bot move’s `ref` before the bot move is listed, because `prev` is the signed body ref, not the piece id ([play-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/play-byow.js:290)).

Missing code: `transport-byow.js` does not get a piece id back from append; it resolves on SDK `onPiecesAdded` submission and later discovers truth by polling active pieces ([transport-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/transport-byow.js:146)). Page-speed chaining therefore needs an optimistic local pending queue with provisional same-data-set order, then reconciliation when real `pieceId`s appear.

Risk: this depends on the SP/FWSS preserving upload/AddPieces order inside one data set. That is likely the model, but issue #7 exists because nobody has measured the actual timing path. Do not generalize this to two BYOW players in two data sets.

**4. Snapshot Pieces**
Accurate, but “trusted writer” is not always required.

A fold can verify a snapshot against the full prefix, but then the snapshot does not reduce late-reader work. If the goal is truncation or fast late join, the snapshot must be trusted, checkpointed by a known writer, or anchored by a contract/authorizer rule. For paint war/chat/jukebox, trusted arcade snapshots are fine. For adversarial settlement, keep raw-log replay as the audit path.

**5. Multi-Game Dashboard**
Accurate, but it unlocks UX, not substrate capability.

It hides 60-second turns by changing framing. It does not solve onboarding, discovery, read cost, or settlement latency. It is strongest for correspondence games and weakest for paint war/chat/jukebox, where users expect a shared live surface.

**Missing Bigger Unlocks**
1. **Owned read indexer.** Biggest omission. Current read path scans `PieceAdded` logs and then lists every known data set; `list()` fans out across all known data sets each poll ([transport-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/transport-byow.js:327)). An indexer that maps `{app, game, room} -> dataSetIds + piece refs` unlocks chat, crowd games, paint war, dashboards, and old-room discovery.

2. **Incremental per-data-set sync.** `openReader.entries()` paginates from cursor zero every time ([transport-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/transport-byow.js:105)). Body caching helps bandwidth, not contract reads. High-water sync is mandatory before N-writer rooms.

3. **Push subscription / gossip.** `confirmedList()` is currently identical to `list()` ([transport-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/transport-byow.js:349)). WebSocket logs or libp2p gossip would make “FOC settles truth, peers share pending truth” practical.

4. **Passkey/WebAuthn authorizer.** The design anticipates P-256, but the current contract only does ECDSA secp256k1 ([CooldownAuthorizer.sol](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/contracts/authorizer/src/CooldownAuthorizer.sol:80)). This is the real guest UX unlock: browser-native identity that can write without wallet onboarding.

5. **Payer-as-contract endowments.** The capability matrix is right: this unlocks durable rooms, corgi endowments, memorial walls, and “funded for N years” artifacts.

**Flywheel: One Move**
Build a local deterministic FOC/SP harness.

Not a generic room engine, not paint war first, not a shared sponsored data set first. The thing slowing every direction is calibration dependence: wallet setup, provider timing, log scans, AddPieces settlement, data-set creation, and authorizer iteration. A local harness that implements the small surface this repo uses would make every new app a fold plus renderer plus tests:

- `createContext`
- `upload`
- `onStored`
- `onPiecesAdded`
- `getActivePiecesByCursor`
- `PieceAdded` logs
- authorizer accept/reject hook
- deterministic block advancement

That accelerates sponsored writes, chat, paint war, commit-reveal, snapshots, latency experiments, and crowd moves. The repo already has pure folds; the missing flywheel is fast substrate simulation.

**Push-The-Envelope Ideas**
1. **Corgi-funded public arcade.** The arcade write budget is the corgi runway. Needs sponsored authorizer with global budget and payer-as-corgi account. Mostly exists, but production authorizer policy is missing.

2. **Passkey guest civilization.** Users join a paint war/wiki/chat with a passkey, no wallet, every action signed by WebAuthn and paid by the room. Needs P-256/WebAuthn authorizer. Does not exist today.

3. **Agent league on FOC.** Bots publish strategies, play games, and earn reputation from replayable logs. Needs agent identity registry, commit-reveal for simultaneous games, and indexed reads. Pieces/folds exist; registry/indexer do not.

**Recommended Order Risk**
The proposed order, “sponsored path -> paint war -> commit-reveal,” is close but skips measurement and local iteration.

I would do:

1. Local FOC/SP harness plus latency instrumentation from issue #7.
2. Production sponsored authorizer: per-key cooldown, global cap, payload/metadata limits, emergency pause, budget accounting.
3. Chat or guestbook on the sponsored data set.
4. Paint war.
5. Commit-reveal.

Reason: paint war will stress every weak part at once: sponsored spend, global spam, snapshots, read scaling, moderation, and latency. A chat/guestbook is the smaller proof of the same sponsored path and will expose the operational failures before the flagship depends on them.

## Review: Gemini

Here is the direct review based on the codebase analysis.

### 1. Is the analysis accurate?
**1. Sponsored write path + one arcade dataset**: Accurate, but incomplete. It unlocks zero-friction onboarding for all cited apps (paint war, chat). The analysis correctly identifies that [CooldownAuthorizer.sol](file:///Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/contracts/authorizer/src/CooldownAuthorizer.sol#L43-L44) only rate-limits *per-signer*, so adding a global cap is required to prevent Sybils from exhausting arcade funds. It also gives total ordering for free because FOC assigns monotonic piece IDs inside a single dataset.
**2. Commit-reveal primitive**: Accurate. The fold handles it purely (commit pieces carry a hash, reveal pieces carry the pre-image, and the fold validates the hash). Unlocks hidden-information games like Battleship and Silent Auction.
**3. Page-speed chaining**: Accurate and sound. You can chain by CID before settlement. Even if FOC mines pieces out of upload order (e.g., piece B gets a lower ID than piece A), [byow-engine.js](file:///Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/byow-engine.js#L204-L211) uses a `for(;;)` loop that re-scans the entire `all` array using `Array.find()` for `p.prev === state.lastRef`. The lowest piece ID that structurally matches the chain wins, making out-of-order mining safe.
**4. Snapshot pieces by a trusted writer**: Accurate but lacks read-side API support. The pure fold can easily verify a snapshot by checking `p.token === ARCADE_PUBKEY`, but clients currently still have to download the entire history via chunked `eth_getLogs` to find the snapshot. It only speeds up page load if paired with a reverse-fetch or incremental sync.
**5. Multi-game dashboard**: Accurate. Good product-level mitigation for settlement latency.

### 2. What is missing?
1. **Latency Masking via Libp2p Gossip**: Ranked #1 in previous research but completely omitted here. Using libp2p browser nodes to exchange optimistic moves makes the 60s settlement FOC's problem, not the player's problem.
2. **Read-side Scaling (WebSockets / Indexer)**: With `Foc-observer` stalled, [discover.js](file:///Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/discover.js) falls back to chunked `eth_getLogs` capped at 2880 blocks. Polling N datasets for 10 players will collapse the page. 
3. **WebAuthn / Passkeys**: The `CooldownAuthorizer` payload sizing anticipates P-256 signatures. This enables wallet-free players while preserving individual cryptographic identity and preventing Sybil spoofing on the arcade dataset.

### 3. The flywheel question
**A shared sponsored data set that every new prototype can write to on day one.**
*Rationale*: The biggest blocker for building and testing new FOC apps is the "BYOW onboarding cliff" (~4-7 minutes, funding wallets, ratification dances). A shared sponsored dataset eliminates *all* developer and player onboarding friction. A developer can write a simple `fold.js`, point it at `DATASET_ID=1337`, and instantly have a multiplayer app that anyone on the internet can use immediately without a wallet. It is the ultimate FOC sandbox and unblocks parallel iteration on all game ideas.

### 4. Push the envelope
1. **Real-world Oracles (Weather / Price Feeds)**: External bots write real-world events into a trusted FOC dataset. Games subscribe and fold this data alongside player moves (e.g., weather affects crop yields). *Primitive needed*: Cross-dataset reads (exists via `transport-byow.js`).
2. **State Channels / Batched Rollups**: Players exchange signed moves instantly via WebRTC state channels. Only the final game state (or a batch of moves) is uploaded to FOC by the winner. *Primitive needed*: Browser P2P networking and Batched AddPieces (does not exist yet).
3. **FOC-Native Autonomous Agents**: AI agents (like a CPU opponent or a referee) that read FOC logs and write their own moves natively using a session key, fully integrated into the FOC ecosystem. *Primitive needed*: Agent wallet funding/session keys (exists).

### 5. Risks in the recommended order
**Risk**: Building Paint War on the sponsored path *before* read-side scaling (indexer/snapshots).
A 64x64 Paint War canvas generates up to 4,096 pieces. The shared sponsored dataset will rapidly accumulate thousands of pieces. Because [transport-byow.js](file:///Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/transport-byow.js#L41) relies on chunked `eth_getLogs` with RPC fallbacks and caps, reading the shared dataset will become excruciatingly slow, effectively DDOSing Paint War and *any other prototype* sharing that dataset.

**What to do differently**: 
1. Build the shared sponsored dataset path first.
2. Test it with a low-volume app (FOC Chatroom / Guestbook).
3. Build read-side scaling (a dedicated indexer or high-water-mark snapshot fetching).
4. *Then* launch Paint War.
