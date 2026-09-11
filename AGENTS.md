# foc-collab

Serverless multiplayer games where Filecoin Onchain Cloud (FOC) is the
only backend. Every action is a signed JSON piece appended to a data set;
all state is a deterministic fold over the piece log. Two schemas: v1 is
one shared log (the local demo and the publisher-key build); v2 is bring
your own wallet (BYOW), where each player writes to their own data set and
the only order the fold trusts is piece id inside one data set.

## Commands

- `npm test`: unit + convergence tests (node:test, no network)
- `npm run test:e2e`: two-browser Playwright game on the v1 shared-log
  build against live calibration (needs a built page with a publisher-key
  config: `node scripts/build-page.mjs <dir> <config.json>`, served on
  :4173). The site is BYOW; its e2e is `test:e2e:byow` below
- `node scripts/setup-game-log.mjs [days]`: owner-side: authorize an
  AddPieces-only session key (default 2 days) + create the games data set;
  prints the page config JSON
- `node scripts/build-page.mjs <out-dir> [config.json] [--game <name>]` ,
  bundle deps and build one game's publishable page; `games/lib` modules
  are flattened next to the game's own (config omitted = local-transport
  dev build; `--game` defaults to tic-tac-toe)
- BYOW (each player their own wallet and data set), all after
  `set -a; . ./config.env; . ./.env; set +a`:
  - `node scripts/byow-fund-wallet.mjs`: mint + fund a second calibration
    wallet from the first (writes PLAYER_B_* to `.env`), then
    `PRIVATE_KEY=$PLAYER_B_PRIVATE_KEY npx filecoin-pin payments setup --auto --deposit 10`
  - `node scripts/byow-setup-player.mjs [days]`: per wallet: own data set +
    AddPieces-only session key; prints the player descriptor JSON (keep it
    in gitignored `.byow/`)
  - `npm run proof:byow`: settlement proof: two wallets, two data sets, a
    full game, opponent found via PieceAdded events, a stranger
    reconstructs from FOC alone (~10 min)
  - `npm run test:e2e:byow`: the same in two browser contexts against a
    built page: `node scripts/build-page.mjs dist/byow .byow/page-config.json`
    where the config file is `{ "mode": "byow" }` (no key of anyone's;
    `.byow/` is gitignored, create the file)
  - `E2E_WALLET_KEY=$PLAYER_C_PRIVATE_KEY npm run test:e2e:wallet`: a
    fresh funded wallet becomes a player from the page through a fake
    EIP-1193 provider (deposit, session key, data set), then creates a game
  - `docs/BYOW-PLAYERS.md`: what a teammate does to play with their wallet
- `node scripts/build-site.mjs [dir]`: landing page + every game as a
  self-contained BYOW page + the corgi (`site/`); `.github/workflows/pages.yml`
  deploys it to GitHub Pages on push to main
- `npm run test:e2e:corgi`: the corgi's acceptance test against calibration
- Authorizer (per data set write ACL, `contracts/authorizer`): `forge build`
  there, then `node scripts/spike-authorizer.mjs` deploys `CooldownAuthorizer`,
  attaches it to a scratch data set with `setDataSetAuthorizer`, and writes
  through it with a key that holds no session key (~10 min; proven
  2026-09-11, see `docs/FEASIBILITY.md`)
- Publish via the `publish` skill (`.claude/skills/publish/SKILL.md`);
  always source `config.env` + `.env` before any filecoin-pin command

## Layout

- `games/tic-tac-toe/fold.js`: THE exemplar module: pure fold, no I/O.
  All game rules live in folds; new games copy this shape. v1 (shared log)
  seats are owned by signing tokens.
- `games/lib/byow-engine.js`: the schema v2 fold engine, generic over a
  game's board rules: seat-owner sequencing, ratification of the first
  joiner by X's first move, lowest piece id inside the author's own data
  set wins, signed home binding (`log` = `byow:<src>`). A seat is owned by
  its home data set; the token only proves integrity. A `create` piece
  with `cpu` is a solo game: both seats in the root data set, told apart
  by token. `games/<game>/fold-byow.js` is the thin per-game rules module.
  Design: `research/2026-09-10-byow-proof-plan.md`
- `games/lib/play-byow.js`: the shared page shell (`mountGame(spec)`):
  transport and identity, wallet onboarding, lobby, discovery, pending
  move and pending create, the computer opponent, notifications, status.
  A game's `index.html` is markup plus a `mountGame` call.
- `games/<game>/cpu.js`: `pickMove(state)`, the computer's move picker
  (minimax for tic-tac-toe, depth-4 negamax for connect-four). The seam a
  learned picker replaces (issue #2).
- `games/lib/identity.js`: P-256 signing identity (non-extractable
  CryptoKey in IndexedDB); verification runs between fetch and fold and
  annotates each piece with its `ref`
- `games/lib/wallet-byow.js`: in-page wallet connect: deposit and
  approval if missing, an AddPieces-only session key (reused while the
  chain shows it live), the wallet's data set found by metadata tag or
  created, descriptor saved once the key is authorized and again once
  the data set is known. One data set per wallet serves every game.
- `games/lib/discover.js`: pure chain-event discovery: metadata tags on
  uploads, chunked PieceAdded scanning (2000-block chunks; Glif caps
  eth_getLogs at 2880), checkpoints. Hints only; the fold verifies what
  they point at
- `games/lib/transport*.js`: dumb append/list transports; they never
  interpret pieces. `transport-byow.js` writes to the player's own data
  set (tagged), reads any number of data sets keylessly annotating `src`
  and `pieceId`, and discovers peers from events; node and browser
- `apps/corgi/`: the FOC corgi: life is the runway of a Filecoin Pay
  payer account (`fold.js` pure, `chain.js` reads, `park3d.js` three.js).
  Its own bundler, `build.mjs`
- `contracts/authorizer/`: `CooldownAuthorizer.sol`, a data set ACL
  (foundry project; `out/` is ignored)
- `scripts/`: owner setup, build, chain spike scripts
- `docs/FEASIBILITY.md`: architecture rationale, security model, blockers,
  dated updates as things are proven
- `research/`: dated investigations and peer-review rounds

## Rules a linter cannot enforce

- Folds stay pure and synchronous; anything async (crypto, network) runs
  before the fold, never inside it
- Never nested ternaries: use helpers that return early
- Every slow UI state shows progress; every failure shows an error
- Signed piece bodies must carry `v`, `app`, and `log` (domain separation);
  bumping the piece schema means bumping `v` and handling old pieces.
  v1 = one shared log; v2 = BYOW, `log` names the author's home data set
- Never sort by hash, name, or signature to break a tie; the only order
  the BYOW fold trusts is `pieceId` inside one data set. Block numbers
  from discovery are display hints, never fold input
- In BYOW a seat belongs to a home data set, never to a browser token;
  the same wallet in another browser is the same player. Solo games are
  the one place the token distinguishes writers, and only inside one
  data set
- Both game pages must build from `games/lib/play-byow.js`; a fix to the
  shell is made once
- The session key embedded in a published page must be AddPieces-only and
  short-lived; secrets beyond that never enter the repo or the page. The
  BYOW site pages carry no key at all
