# Peer review of the repo state, 2026-09-11

Prompt sent to Cursor, Codex, and Gemini (Antigravity, Gemini 3.1 Pro) after the BYOW fixes of 2026-09-11 (commits b0bff09..85c5c46). Raw responses follow, unedited. The prompt asked for: state assessment, the lobby and games as a product, comparison against the 2026-09-01 build order, a ranked list of what to build next, and the one thing to fix first.

## Prompt


# Review request: state of foc-collab, and what to build next

foc-collab is an experiment in serverless multiplayer apps where Filecoin Onchain Cloud (FOC) is the only backend: every action is a signed JSON piece appended to a data set, and all state is a deterministic fold over the piece log. Read CLAUDE.md first for the layout and rules.

## What exists today (verify by reading, do not trust this summary)

- games/tic-tac-toe and games/connect-four: two "bring your own wallet" (BYOW, schema v2) games. Each player writes to their own FOC data set with an AddPieces-only session key; opponents are found through PieceAdded chain events; the shared fold engine is games/lib/byow-engine.js (seat-owner sequencing, ratification of the first joiner by X's first move, lowest-piece-id-wins). Pages: games/*/index.html. Lobby = every `create` piece discovered by chain events.
- apps/corgi: a tamagotchi whose life is the runway of a Filecoin Pay payer account (deposits = feeding, adoption at >= 1 USDFC), with a three.js park. Fold in apps/corgi/fold.js, chain reads in apps/corgi/chain.js.
- site/ + scripts/build-site.mjs: a GitHub Pages landing page that hosts every game as a self-contained BYOW page (https://sgtpooki.github.io/foc-collab/).
- docs/FEASIBILITY.md (architecture, security model, blockers), docs/BYOW-PLAYERS.md, docs/IDEAS.md (game and non-game ideas, with Russell's own annotations on what he loves).
- research/: the 2026-09-01 strategy round (acl-games-strategy, baton-agent-infrastructure, build-order-and-capability-matrix, expansion-synthesis, idea-deep-dives, moat-and-gtm-grounding) with peer reviews from gemini/codex/cursor, cluster reports in research/clusters, and the 2026-09-10 BYOW notes (byow-and-latency, byow-proof-plan, byow-rendezvous-options). These were written by earlier review rounds with your peers; read at least build-order-and-capability-matrix.md, expansion-synthesis.md, and IDEAS.md.
- Open issues: #1 "create a FOC chatroom", #2 "CPU opponent: a tiny in-browser LLM plays the other seat".

## What happened today (2026-09-11), the five most recent commits on main

1. BYOW seats are now owned by the home data set, not a browser-local P-256 token (the same wallet in another browser was a spectator of its own game).
2. provisionPlayer reuses an unexpired session key and the existing data set instead of minting a new key + login tx + genesis upload on every "connect wallet" click.
3. The creator stays seated ("you are X once it settles") across the navigation to a freshly created game.
4. The corgi deposit scan now uses 2000-block chunks: Glif calibration caps eth_getLogs at 2880 and some of its backends answer oversized ranges with a silent empty result instead of an error, which made the page fold the corgi as dead and cache the empty log.
5. The corgi fold no longer treats "no deposits seen" as death.

Known rough edges: a move takes ~60s to settle; a game needs a second wallet before the board unlocks (X's first move ratifies a joiner); Brave's ephemeral storage can wipe the descriptor/identity IndexedDB; the corgi's first scan takes minutes on Glif; the Foc-observer indexer for PieceAdded is stalled (block 4028981 as of today), so discovery relies on direct eth_getLogs.

## What I want from you

1. A frank assessment of the current state: what is solid, what is fragile, what is over-built or under-built relative to the stated goal (prove that FOC alone can be the backend for multiplayer/collaborative apps, and make something people actually want to play or use).
2. Judge the game lobby and the two games as a product someone lands on from the GitHub Pages link with a calibration wallet. Where does it fail them?
3. Compare against the research: the 2026-09-01 build order recommended corgi v1 (done), an authorizer/ACL spike, then a "baton" agent-handoff relay. BYOW happened instead. Was that the right detour? What in the research is now stale?
4. Recommend what to build next: rank 3 to 5 candidates with a one-paragraph rationale each, a rough effort estimate, and what each one proves that nothing so far proves. Consider both the game ideas in docs/IDEAS.md (Russell annotated the ones he loves) and non-game uses, and the two open issues. Be specific about which repo modules each candidate reuses.
5. Name the one thing you would fix or remove before building anything new.

Be direct. Ground every claim in a file path or command output. Do not pad; a ranked list with reasons beats prose.

## Review: Cursor

# foc-collab review (2026-09-11)

Grounded in: `npm test` (99/99 pass), `git log -5`, and reads of `games/lib/byow-engine.js`, `games/lib/transport-byow.js`, `games/lib/wallet-byow.js`, both game pages, `site/index.html`, `docs/IDEAS.md`, `research/2026-09-01-build-order-and-capability-matrix.md`, `research/2026-09-01-expansion-synthesis.md`, `research/2026-09-10-byow-proof-plan.md`, and issues #1/#2.

---

## 1. Current state

### Solid

| Area | Evidence |
|---|---|
| **Core proof** | `games/lib/byow-engine.js` + seat-owner sequencing; `npm test` → 99 pass including `fold-byow.test.js`, `byow-convergence.test.js`, `discover.test.js` |
| **BYOW settlement** | `scripts/byow-proof.mjs`, `npm run proof:byow`, `e2e/byow.e2e.mjs`; timings documented in `research/2026-09-10-byow-proof-plan.md` (~50–90s/piece on calibration) |
| **No publisher key** | `site/tic-tac-toe.config.json` is `{ "mode": "byow" }` only; discovery via `PieceAdded` in `games/lib/discover.js` + `transport-byow.js` |
| **Wallet onboarding** | `games/lib/wallet-byow.js` — session key reuse (`getExpirations`), incremental descriptor save; today's commits `a58ae90`, `b0bff09` fix real calibration pain |
| **Corgi** | Pure fold (`apps/corgi/fold.js`), deposit-based feeding aligned with research; today's `0e5336f`/`c2c665a` fix Glif silent-empty-log death |
| **Site** | `scripts/build-site.mjs` → GitHub Pages landing + self-contained BYOW bundles |

### Fragile

| Area | Evidence |
|---|---|
| **Move latency** | Pages say ~60s (`games/tic-tac-toe/index.html:137`); `pollMs: 8000` in `transport-byow.js:307`; no gossip — `confirmedList()` === `list()` (`transport-byow.js:349-351`) |
| **RPC / log scans** | Chunked `eth_getLogs` with RPC fallbacks (`DEFAULT_LOG_RPCS` in `transport-byow.js:41`); Glif 2880 cap + silent empty results (corgi `chain.js:33-36`, games `discover.js:12-15`) |
| **Lobby horizon** | Default scan only last `LOBBY_BLOCKS = 4000` (~33h) when no checkpoint (`transport-byow.js:221-236`) — older games vanish from lobby |
| **Two-wallet gate** | X's first move ratifies O (`byow-engine.js` header, `index.html:284-286`); issue #2 states the product consequence explicitly |
| **Browser storage** | Descriptor in IndexedDB (`wallet-byow.js:36-38`); Brave ephemeral storage called out in your notes and `docs/BYOW-PLAYERS.md` |
| **Indexer dependency** | Discovery is direct `getLogs`, not foc-observer; research assumes indexer (`expansion-synthesis.md:64-68`) — your stall report makes that path dead for now |

### Over-built (relative to stated goal)

- **Dual-mode game pages**: Both `games/tic-tac-toe/index.html` (558 lines) and `games/connect-four/index.html` (592 lines) still carry full v1 shared-log + v2 BYOW branches (`byow ? … : …` throughout), while the published site is BYOW-only (`site/*.config.json`).
- **v1 infrastructure still maintained**: `games/lib/transport-foc.js`, `scripts/setup-game-log.mjs`, v1 folds/tests — not on the landing page product path.
- **P-256 identity as seat authority** (docs lag): `docs/FEASIBILITY.md:54-70` still frames token as seat identity; runtime authority moved to home data set (`byow-engine.js:32-37`, commit `b0bff09`). Token is now integrity-only; docs/over-explanation remain.

### Under-built (relative to stated goal)

- **Nothing people can do alone** in under 5 minutes with one wallet (games need opponent + ratification; corgi first scan can take minutes per `chain.js` timeout/chunk design).
- **No latency layer** despite explicit plan in `research/2026-09-10-byow-and-latency.md` (libp2p ranked #1, not built).
- **No authorizer spike** — build order item #2 (`build-order-and-capability-matrix.md:15-18`); zero `setDataSetAuthorizer` scripts in `scripts/`.
- **No shared game shell** — connect-four is a near-copy of tic-tac-toe UI, not a reusable module.
- **No crowd-scale demo** — research flagship was paint war / ACL-enforced cooldowns (`acl-games-strategy.md:17-30`), not 2-player turn games.

---

## 2. Product: someone landing from GitHub Pages

**What works**

- Honest landing copy (`site/index.html`) — BYOW, ~1 min/move, no server.
- Spectator mode without wallet (`index.html:199-209`, `transport-byow.js:304`).
- Progress UX for writes (busy stages, pending move/create, tab notifications) — the slow-move mitigation from `docs/IDEAS.md:55-56` is partially shipped.

**Where it fails them**

1. **Onboarding cliff** — Site says "about three minutes and three or four signatures" (`site/index.html:32-33`); `e2e/byow-wallet.e2e.mjs` proof cited at 3m12s in `byow-proof-plan.md:276`. Most visitors bounce before first create.

2. **Cannot play solo** — Create → wait ~60s for create piece → share link → opponent connects (another ~3 min) → join → **creator must move again to ratify** (`index.html:377-378`) → another ~60s before O is real. Minimum ~4–7 minutes with two funded wallets (`byow-proof-plan.md:239-245` e2e timeline). One wallet = spectator forever.

3. **Ratification is unexplained in the lobby** — "Open to join" games show joinable state, but O still cannot play until X moves; status line only appears on the game page (`statusLine` at `index.html:377-378`), not in lobby rows.

4. **Lobby is a recent-events feed, not a durable lobby** — 4000-block window (`transport-byow.js:221`) + fold over every discovered data set each poll (`lobbyByow` in `byow-engine.js:183-189`) = incomplete listing and growing read cost.

5. **Connect-four adds no product lift** — Same UX and latency as tic-tac-toe; only board rules differ (`games/connect-four/fold-byow.js`). Not "flashy enough to screen-record" as `IDEAS.md:11-12` intended.

6. **Corgi is the only solo-friendly app** — But first load scans deposit history in 2000-block chunks with 60s RPC timeout (`apps/corgi/chain.js:37-39`); fine for devotees, not for casual landing traffic.

---

## 3. Research vs what shipped

**Recommended order (2026-09-01):** corgi v1 → authorizer spike → baton HITL → paint war (birthday) → signal-gated rest (`build-order-and-capability-matrix.md:7-47`).

**What happened:** BYOW multiplayer (Sept 10–11) instead of authorizer spike or baton.

**Was BYOW the right detour?** **Yes for the substrate story; no for GTM timing.**

- **Yes:** Proves the hard thing research assumed but hadn't built: cross-data-set deterministic state without a shared log or publisher key. Seat-owner sequencing (`byow-engine.js`) fixes the fatal flaw in the abandoned hash/ref model (`byow-and-latency.md:3-7`, `byow-proof-plan.md:17-31`). That is a stronger "FOC-only backend" proof than mode-1 embedded keys (`FEASIBILITY.md:88-93`).
- **No:** It did not advance build-order #2 (authorizer), #3 (baton), or #4 (paint war). It also **reinforces** the per-action cost model (`expansion-synthesis.md:12-14`: ~$0.011/action per player-signed write) without batching — worse for crowd apps than the ACL path.

**Now stale or superseded in research**

| Doc / claim | Status |
|---|---|
| Hash-linked / lowest-`ref` ordering | Superseded — `byow-and-latency.md:3-7`, shipped v2 in `byow-engine.js` |
| Seats owned by P-256 token | Superseded — home data set owns seat (`b0bff09`) |
| Rendezvous data set + publisher session key | Gone — `byow-proof-plan.md:227-230` |
| foc-observer as read layer | Blocked in practice (your stall note); code uses raw `getLogs` |
| Build order #2 authorizer spike | Still correct and still undone |
| Paint war as Oct 15 birthday flagship | Missed unless authorizer ships immediately |
| Corgi v1 "ship this week" | Done; deposit-scan fragility was real and now patched |
| `ExampleSponsoredDataSet` authorizer | Still GAP per matrix (`build-order-and-capability-matrix.md:101`) |

**Still valid**

- SDK authorizer path as #1 feature ask (`expansion-synthesis.md:60-63`)
- Indexed read layer / metadata-filtered listing (`expansion-synthesis.md:64-68`)
- Multi-signer batched AddPieces for crowd scale (`expansion-synthesis.md:70-75`)
- Russell's loved ideas (paint war, jukebox, Life seeding, silent auction) all still blocked on authorizer or latency UX, not on BYOW ordering

---

## 4. What to build next (ranked)

### 1. Solo CPU opponent — issue #2, minimax first, LLM optional later

**Effort:** ~1–2 weeks (MVP: legal moves only; LLM adds 1+ week)

**Rationale:** Biggest product failure today. Every landing visitor with one calibration wallet hits a dead end after create. A bot is an ordinary BYOW player (issue #2): own wallet/data set/session key, signed pieces, same fold.

**Proves:** FOC multiplayer demo is **playable without coordinating a human** — nothing current proves that.

**Reuses:** `games/lib/byow-engine.js`, `games/lib/transport-byow.js`, `games/lib/identity.js`, `games/lib/wallet-byow.js`, `games/*/fold-byow.js` + `RULES.legal()`; fund bot via publisher throwaway wallet in page config or `scripts/byow-setup-player.mjs` pattern.

---

### 2. Authorizer spike on calibration

**Effort:** ~2–3 weeks (hand-rolled `extraData`, test authorizer contract, one browser write)

**Rationale:** Build-order critical path unchanged since Sept 1. Unlocks paint war cooldowns, sponsored guestbook/chatroom, jukebox — everything Russell annotated as "WAY better with data-set-scoped keys" in `IDEAS.md:34-40`.

**Proves:** Contract-enforced write policy on one data set — the ACL story games are supposed to sell (`acl-games-strategy.md:10-13`).

**Reuses:** `scripts/spike-save-piece.mjs`, `games/lib/foc-deps.js`, transport write path; new `scripts/spike-authorizer.mjs` + small Solidity authorizer (cooldown + size cap pattern from research).

---

### 3. FOC chatroom — issue #1

**Effort:** ~1–2 weeks (append-only fold, no turn logic)

**Rationale:** Simpler than a game; directly addresses open issue. BYOW variant (each speaker own data set) reuses engine patterns without board `rules`; sponsored variant waits on #2 above.

**Proves:** **Non-game collaborative append-only app** on FOC alone — games prove turn sync; chat proves durable async conversation.

**Reuses:** `discover.js` tags, `transport-byow.js`, `identity.js`, `wallet-byow.js`; new thin fold (message list, optional thread id) modeled on `byow-engine.js` or simpler v1-style single-room log with authorizer.

---

### 4. libp2p gossip optimistic layer

**Effort:** ~2–3 weeks (browser libp2p + reconciliation UI)

**Rationale:** 60s/move is acceptable for correspondence chess, not for "try my demo." Research already chose js-libp2p (`byow-and-latency.md:34-38`); transport seam exists (`list()` vs `confirmedList()` at `transport-byow.js:349-351`).

**Proves:** **Latency hiding without a game server** — settlement stays FOC; UX becomes tolerable for all current and future games.

**Reuses:** `transport-byow.js`, `identity.js` (`verifyAll` before fold), pending-move UI in both `index.html` files; extend to opponent pending pieces.

---

### 5. Internet jukebox (collaborative playlist) — Russell's pick in `IDEAS.md:46-47`

**Effort:** ~2–3 weeks after authorizer spike; ~4 weeks if BYOW-only (one enqueue per wallet per epoch in fold)

**Rationale:** Non-game, emotionally sticky, matches "slow bulletin board" physics in `IDEAS.md:44-45`. Needs sponsored authorizer for zero-onboarding queueing (`acl-games-strategy.md:38-40`).

**Proves:** **Consumer non-game FOC app** people might return to daily — stronger retention story than tic-tac-toe.

**Reuses:** Authorizer from #2, `discover.js`, fold pattern from corgi (`apps/corgi/fold.js` event folding) or new queue fold; page shell from shared game module if extracted.

---

**Honorable mention — paint war:** Still the best *demonstration* per `acl-games-strategy.md:17-30` and Russell's annotation in `IDEAS.md:14-15`, but it **depends on #2** and is ~3–4 weeks. Rank it immediately after authorizer spike, not instead of solo opponent.

---

## 5. Fix one thing before building anything new

**Extract the duplicated BYOW game shell (~560 lines × 2) into one shared module** — e.g. `games/lib/play-byow.js` imported by thin per-game HTML.

**Why this, not a feature:** Connect-four added zero shared infrastructure; today's fixes (pending create `680f4e5`, wallet reuse `a58ae90`, seat-by-ds `b0bff09`) touched engine/wallet layers but UI duplication means the next opponent/chatroom/paint-war UX pass must be done twice. Building CPU opponent (#2) or chatroom (#1) on top of two copy-pasted pages guarantees drift.

**Alternative if you mean product, not engineering:** Fix the **solo-play dead end** (issue #2) before a third game — but that *is* build #1 above; the dedupe is the prerequisite that makes #1 cheap.

---

## Bottom line

You have a **credible substrate proof** (BYOW settlement, deterministic fold, 99 tests, calibration proofs) wrapped in a **weak product** (two wallets, ~4–7 min to first real exchange, no solo path, 60s moves with no fast channel). BYOW was the right detour for architecture, the wrong detour for the Sept research calendar. Next leverage: **make one wallet enough to experience a full game** (CPU seat), then **authorizer spike** to unlock everything Russell actually wants to build (paint war, jukebox, chatroom) — and dedupe the game UI so you stop paying duplicate tax on every fix.

## Review: Codex

**Verdict**
foc-collab is now a credible substrate proof, not just a toy. The strongest part is the pure BYOW model: `games/lib/byow-engine.js` makes seat ownership a function of home data set plus per-data-set `pieceId`, not browser identity or hash ordering, and it keeps async work outside the fold ([byow-engine.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/byow-engine.js:1), [byow-engine.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/byow-engine.js:128)). `npm test` is green: 99 passing tests, including BYOW adversarial cases, identity verification, corgi chain/fold behavior, and both games.

**Solid**
- BYOW ordering is well-designed. The fold accepts create/join/ratify/move using only signed fields plus `src` and `pieceId`; home binding rejects replay into another data set ([byow-engine.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/byow-engine.js:95), [byow-engine.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/byow-engine.js:145)).
- The shared engine is paying off. Tic-tac-toe and Connect Four only supply rule legality and placement ([games/tic-tac-toe/fold-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/tic-tac-toe/fold-byow.js:1), [games/connect-four/fold-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/connect-four/fold-byow.js:1)).
- Browser onboarding is real now. `wallet-byow.js` connects wallet, deposits/approves, authorizes an AddPieces session key, creates/reuses a data set, and persists the descriptor ([wallet-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/wallet-byow.js:109)). The proof doc says the full wallet path completed in 3m12s and then created a game with zero wallet prompts ([byow-proof-plan.md](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/research/2026-09-10-byow-proof-plan.md:269)).
- Corgi is the best “FOC is the backend” product artifact. Its fold models account runway and deposits cleanly ([fold.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/apps/corgi/fold.js:200)), and chain reads are chunked/cached with the Glif cap documented in code ([chain.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/apps/corgi/chain.js:33)).

**Fragile**
- Discovery is the main reliability risk. BYOW lobby/game discovery depends on `eth_getLogs` scans through public RPCs ([transport-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/transport-byow.js:205)); the proof doc already records Glif browser CORS failures and provider-specific limits ([byow-proof-plan.md](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/research/2026-09-10-byow-proof-plan.md:247)).
- The scan checkpoint behavior is conservative but can get sticky: `scan()` only advances `scanned` while no chunk has failed ([discover.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/discover.js:1)), and `transport-byow.js` persists that checkpoint ([transport-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/transport-byow.js:229)).
- Removal remains a real correctness hole for fresh readers. Cached clients can flag disputes, but uncached readers see the shortened active list; the proof plan explicitly leaves live `SchedulePieceRemovals` unexercised ([byow-proof-plan.md](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/research/2026-09-10-byow-proof-plan.md:93), [byow-proof-plan.md](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/research/2026-09-10-byow-proof-plan.md:261)).
- The games are over-built as protocol proofs and under-built as products. They have optimistic UI, ETA, notifications, rematch, and lobby sections ([tic-tac-toe/index.html](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/tic-tac-toe/index.html:153)), but they still require a second funded wallet before play becomes meaningful.

**Product Assessment**
The GitHub Pages landing page is honest: first visit takes about three minutes and three or four signatures, moves settle in about a minute ([site/index.html](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/site/index.html:29)). That honesty is also the conversion problem. A user with a calibration wallet lands in a sparse lobby, pays setup cost, creates a game, then waits for a second wallet and for X’s first move to ratify O ([tic-tac-toe/index.html](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/tic-tac-toe/index.html:373)). The lobby exposes protocol state, not social value. Connect Four is a better game than tic-tac-toe, but both fail the same way: no instant opponent, no async “inbox” framing, and discovery failures surface as implementation detail in `byow-meta` ([tic-tac-toe/index.html](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/tic-tac-toe/index.html:347)).

**Research Delta**
BYOW was the right detour. The 2026-09-01 build order said corgi, authorizer spike, then Baton ([build-order-and-capability-matrix.md](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/research/2026-09-01-build-order-and-capability-matrix.md:9)). BYOW proved a more basic claim first: no publisher key, two wallets, two data sets, keyless cross-data-set reads, event discovery, and root-only reconstruction ([byow-proof-plan.md](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/research/2026-09-10-byow-proof-plan.md:232)). That matters more than the authorizer spike for the “FOC alone as backend” thesis.

Stale items: `Browser wallet or session UX | GAP` is obsolete; it is now built and e2e-covered ([byow-proof-plan.md](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/research/2026-09-10-byow-proof-plan.md:163), [e2e/byow-wallet.e2e.mjs](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/e2e/byow-wallet.e2e.mjs:1)). The older “cheap many-small-datasets” concern in the build matrix is superseded by expansion-synthesis, which says write fees, not data-set creation, are the cost driver ([expansion-synthesis.md](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/research/2026-09-01-expansion-synthesis.md:12)). The authorizer spike is still important, but now it is specifically about removal-proofing, cooldowns, and sponsored writes, not proving multiplayer viability.

**What To Build Next**
1. **FOC chatroom / slow guestbook, issue #1.** Effort: 2-4 days. Reuse `games/lib/identity.js`, `games/lib/transport-byow.js`, `games/lib/discover.js`, and `wallet-byow.js`; replace two-seat fold rules with a many-writer message/thread fold. It proves collaborative, many-participant state instead of two-seat turn-taking. It also turns the “viewer saves” origin story in `docs/FEASIBILITY.md` into an actual product surface. `gh issue list` confirms #1 is open: “create a FOC chatroom”.

2. **Baton v0 HITL relay.** Effort: 4-7 days for schemas, pure fold, CLI-ish runner, and static timeline. Reuse canonical signing/verification and the append/list transport shape; likely start with one data set before BYOW-per-agent. This proves FOC as coordination infrastructure for work, not games. The research still makes a strong case that agent legs tolerate 60s settlement and benefit from signed handoff receipts ([baton-agent-infrastructure.md](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/research/2026-09-01-baton-agent-infrastructure.md:1)).

3. **CPU opponent, issue #2, but not as “tiny LLM” first.** Effort: 1-2 days for deterministic/minimax tic-tac-toe, 2-4 days for decent Connect Four. Reuse the existing game pages and BYOW engine; the CPU writes as a second local/browser actor only if the model can append through a real wallet/session, otherwise label it as practice mode. It proves the product can be used immediately by a lone visitor. `gh issue list` confirms #2 is open: “CPU opponent: a tiny in-browser LLM plays the other seat”.

4. **Paint war with minimal authorizer path.** Effort: 1-2 weeks if you include a real cooldown authorizer, less if advisory-only. Reuse `wallet-byow.js`, `discover.js`, identity signing, and the fold pattern; add snapshot pieces once the board grows. It proves many concurrent writers, spatial metadata, cooldowns, and Russell explicitly marked it as loved in `docs/IDEAS.md` ([IDEAS.md](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/docs/IDEAS.md:14)).

5. **Silent auction / commit-reveal.** Effort: 4-6 days for a clean non-money calibration version. Reuse BYOW transport and identity, but add a new fold primitive: commitments, reveal window, invalid reveal handling. It proves hidden information and delayed reveal, which neither current game nor corgi proves; Russell also marked it as loved ([IDEAS.md](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/docs/IDEAS.md:13)).

**Fix First**
Before building another game, fix the duplicated/stale game shell. Tic-tac-toe and Connect Four copy the same lobby/onboarding/discovery code and still ship shared-log/browser-seat copy in the default HTML ([tic-tac-toe/index.html](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/tic-tac-toe/index.html:41), [tic-tac-toe/index.html](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/tic-tac-toe/index.html:57)). Extract a reusable BYOW page shell or at least clean the copy once. Otherwise every new app inherits the same product confusion and duplicated failure handling.

## Review: Gemini

Here is a frank assessment of `foc-collab` based on the current state of the codebase.

### 1. Assessment of the current state
*   **Solid**: The deterministic fold architecture (`games/lib/byow-engine.js`, `games/tic-tac-toe/fold.js`) is robust and elegantly isolates game logic from I/O. The `corgi` on-chain state reconstruction (`apps/corgi/chain.js`) is highly resilient because it derives state directly from source-of-truth events (`DepositRecorded`) instead of trusting a brittle indexer. 
*   **Fragile**: Chain-event opponent discovery. Relying on chunked `eth_getLogs` for the lobby makes loading painfully slow when the `Foc-observer` indexer stalls (e.g. the multi-minute `LOG_CHUNK = 2000` scan in `apps/corgi/chain.js`). Furthermore, browser identity persistence via `IndexedDB` (`games/tic-tac-toe/identity.js`) is vulnerable to Brave's ephemeral storage wipes, which permanently bricks a player's access to their dataset.
*   **Over-built**: The Bring-Your-Own-Wallet (BYOW) architecture for a simple turn-based game. The complex dataset ratification dance (`games/lib/byow-engine.js`) solves cross-dataset discovery effectively but introduces massive onboarding friction.
*   **Under-built**: Network sync and latency masking. There are no WebSocket (`wss`) push event subscriptions for instant notifications, and no state truncations/snapshots, forcing clients to blindly poll and fold from genesis every time.

### 2. Product experience from the landing page
A new user arriving with a Calibration wallet faces fatal friction and latency. They click "connect", wait ~60s to provision (`games/tic-tac-toe/wallet-byow.js`), wait ~60s for their `create` piece to settle, and share a link. The second player connects and joins (another ~60s wait). Finally, the creator *must* wait and submit a ratification move (another ~60s) before the board fully unlocks (`games/lib/byow-engine.js`). 

This is a 3-to-4 minute setup just to start tic-tac-toe. Furthermore, if the indexer is stalled, the lobby is completely empty and they are forced to use the manual "link-back" fallback to discover their opponent.

### 3. Comparison against the research (The BYOW detour)
*   **Was BYOW the right detour?** No. The Sept 1 build order (`research/2026-09-01-build-order-and-capability-matrix.md`) rightly prioritized an *authorizer spike* (to enable sponsored writes and zero-onboarding) and *Baton v0* (enterprise provenance). BYOW proved that dataset-scoped authority and per-player payments work, but it completely sacrificed the consumer UX by forcing wallet funding and cross-dataset discovery onto players.
*   **What is stale?** The assumption in `research/2026-09-01-expansion-synthesis.md` that "Cheap many-small-datasets pricing" is a blocker. BYOW proved that players are willing and able to fund their own datasets, bypassing the need for the protocol to subsidize them.

### 4. What to build next (Ranked)
1. **CPU opponent (Issue #2)**
   *   **Rationale**: A browser-local LLM completely bypasses BYOW's multi-wallet friction. A single player can play instantly against the LLM, avoiding the 60s ratification and opponent discovery steps entirely.
   *   **Proves**: Autonomous agents interacting natively with the piece log (a prerequisite for Baton agent handoffs).
   *   **Reuses**: `games/lib/byow-engine.js`, `games/tic-tac-toe/fold.js`, `games/tic-tac-toe/identity.js`.
   *   **Effort**: Low. 
2. **Paint war (from IDEAS.md)**
   *   **Rationale**: A single-dataset, massively multiplayer game where the ~60s settlement latency acts as a natural gameplay cooldown rather than a frustrating delay.
   *   **Proves**: State-mutating quotas/cooldowns via authorizer and high-concurrency state folding.
   *   **Reuses**: `lib/identity.js` and standard `lib/transport.js`.
   *   **Effort**: Medium.
3. **Baton v0 / HITL Relay (from build order)**
   *   **Rationale**: The original #3 priority from the build order. Directly targets the enterprise "provenance" wedge (agent drafts -> human signs off).
   *   **Proves**: Compliance receipts, human-in-the-loop signatures, and core non-game utility.
   *   **Reuses**: `lib/identity.js`, `lib/wallet-byow.js`, `lib/transport-byow.js`.
   *   **Effort**: High.
4. **FOC Chatroom (Issue #1)**
   *   **Rationale**: The simplest non-game primitive (a slow bulletin board or guestbook) where latency is perfectly acceptable.
   *   **Proves**: Consumer-scale append-only logs without complex fold rules.
   *   **Reuses**: `lib/transport.js`, `lib/identity.js`.
   *   **Effort**: Very Low.

### 5. One thing to fix or remove before building anything new
**Remove the 60s "ratification" move requirement** in `games/lib/byow-engine.js`. Currently, X's first move is required to explicitly name O's dataset so root-only readers can discover O. This adds a full epoch of latency before the game can even start. 

Instead, rely completely on the `{ type: 'announce' }` pieces in a shared rendezvous dataset (already defined in `byow-engine.js:50` but currently ignored by the fold) to link O to X. This allows the board to unlock immediately when O's `join` piece settles, shaving 60 seconds off the game start time.
