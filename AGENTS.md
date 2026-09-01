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
- Publish via the `publish` skill (`.claude/skills/publish/SKILL.md`);
  always source `config.env` + `.env` before any filecoin-pin command

## Layout

- `games/tic-tac-toe/fold.js` — THE exemplar module: pure fold, no I/O.
  All game rules live in folds; new games copy this shape.
- `games/tic-tac-toe/identity.js` — P-256 signing identity (non-extractable
  CryptoKey in IndexedDB); verification runs between fetch and fold
- `games/tic-tac-toe/transport*.js` — dumb append/list transports; they
  never interpret pieces
- `scripts/` — owner setup, build, and chain spike scripts
- `docs/FEASIBILITY.md` — architecture rationale, security model, blockers

## Rules a linter cannot enforce

- Folds stay pure and synchronous; anything async (crypto, network) runs
  before the fold, never inside it
- Never nested ternaries — use early-return helpers
- Every slow UI state shows progress; every failure shows an error
- Signed piece bodies must carry `v`, `app`, and `log` (domain separation);
  bumping the piece schema means bumping `v` and handling old pieces
- The session key embedded in a published page must be AddPieces-only and
  short-lived; secrets beyond that never enter the repo or the page
