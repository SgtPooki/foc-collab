# foc-collab

Serverless multiplayer games where Filecoin Onchain Cloud is the only
backend. Every action is a signed JSON piece appended to a shared data set;
all state is a deterministic fold over the piece log in piece-id order.

## Commands

- `npm test` — unit + convergence tests (node:test, no network)
- `npm run test:e2e` — two-browser Playwright game against live calibration
  (needs a built page: `node scripts/build-page.mjs <dir> <config.json>`,
  served on :4173)
- `node scripts/setup-game-log.mjs [days]` — owner-side: authorize an
  AddPieces-only session key (default 2 days) + create the games data set;
  prints the page config JSON
- `node scripts/build-page.mjs <out-dir> [config.json]` — bundle deps and
  build the publishable page (config omitted = local-transport dev build)
- BYOW (each player their own wallet and data set), all after
  `set -a; . ./config.env; . ./.env; set +a`:
  - `node scripts/byow-fund-wallet.mjs` — mint + fund a second calibration
    wallet from the first (writes PLAYER_B_* to `.env`), then
    `PRIVATE_KEY=$PLAYER_B_PRIVATE_KEY npx filecoin-pin payments setup --auto --deposit 10`
  - `node scripts/byow-setup-player.mjs [days]` — per wallet: own data set +
    AddPieces-only session key; prints the player descriptor JSON (keep it
    in gitignored `.byow/`)
  - `npm run proof:byow` — settlement proof: two wallets, two data sets, a
    full game, opponent found via PieceAdded events, a stranger
    reconstructs from FOC alone (~10 min)
  - `npm run test:e2e:byow` — the same in two browser contexts against a
    built page: `node scripts/build-page.mjs dist/byow .byow/page-config.json`
    where the config is `{ "mode": "byow" }` (no key of anyone's)
  - `docs/BYOW-PLAYERS.md` — what a teammate does to play with their wallet
- Publish via the `publish` skill (`.claude/skills/publish/SKILL.md`);
  always source `config.env` + `.env` before any filecoin-pin command

## Layout

- `games/tic-tac-toe/fold.js` — THE exemplar module: pure fold, no I/O.
  All game rules live in folds; new games copy this shape.
- `games/tic-tac-toe/fold-byow.js` — schema v2 fold for per-player data
  sets: seat-owner sequencing, lowest piece id inside the author's own data
  set, signed home binding. See `research/2026-09-10-byow-proof-plan.md`
- `games/tic-tac-toe/identity.js` — P-256 signing identity (non-extractable
  CryptoKey in IndexedDB); verification runs between fetch and fold and
  annotates each piece with its `ref`
- `games/tic-tac-toe/discover.js` — pure chain-event discovery: metadata
  tags on uploads, chunked PieceAdded scanning, checkpoints. Hints only;
  the fold verifies what they point at
- `games/tic-tac-toe/transport*.js` — dumb append/list transports; they
  never interpret pieces. `transport-byow.js` writes to the player's own
  data set (tagged), reads any number of data sets keylessly annotating
  `src` and `pieceId`, and discovers peers from events; node and browser
- `scripts/` — owner setup, build, and chain spike scripts
- `docs/FEASIBILITY.md` — architecture rationale, security model, blockers

## Rules a linter cannot enforce

- Folds stay pure and synchronous; anything async (crypto, network) runs
  before the fold, never inside it
- Never nested ternaries — use early-return helpers
- Every slow UI state shows progress; every failure shows an error
- Signed piece bodies must carry `v`, `app`, and `log` (domain separation);
  bumping the piece schema means bumping `v` and handling old pieces.
  v1 = one shared log; v2 = BYOW, `log` names the author's home data set
- Never sort by hash, name, or signature to break a tie; the only order
  the BYOW fold trusts is `pieceId` inside one data set
- The session key embedded in a published page must be AddPieces-only and
  short-lived; secrets beyond that never enter the repo or the page
