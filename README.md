# foc-collab

Proving that a published static artifact can be genuinely multi-user with
Filecoin Onchain Cloud as the only backend: viewers (or players) append small
JSON pieces to a shared data set from the browser using scoped session keys,
and every client derives identical state by folding the ordered piece log.
No server, no database, no coordination service.

Idea and mini-plan: [Notion — viewer saves for published artifacts](https://app.notion.com/p/filecoindev/Idea-viewer-saves-for-published-artifacts-session-key-writes-to-FOC-3cddc41950c1819fb40eeb2cbe14263a).

## What's here

- `games/tic-tac-toe/` — the proof-of-concept game. `fold.js` is the pure
  event-sourcing core (board = fold over the move log; illegal, out-of-turn,
  and conflicting pieces are ignored deterministically), with tests in
  `fold.test.js` (`npm test`). `index.html` is a static page with pluggable
  transports: `local` (two tabs, same browser — works today with zero setup)
  and `foc` (shared data set, session-key writes).
- `.claude/skills/publish/` — the publish skill: how an agent publishes an
  asset from this repo and returns an `inbrowser.link/ipfs` URL.
- `docs/FEASIBILITY.md` — can the idea be built and tested today? What
  exists, what's blocked, what the spikes showed.
- `scripts/` — spike scripts for the storage-side pieces (save a JSON piece
  with a session key, enumerate and fetch pieces).

## Running the game locally

```bash
npx serve games/tic-tac-toe   # any static server works
```

Open the URL in two tabs. In one, create a game from the lobby and copy the
invite link; open it in the other tab and join as O. The `local` transport
syncs through BroadcastChannel with per-tab player identity; the fold logic
exercised is byte-identical to what the `foc` transport uses.

The published (shared-storage) build is the same page with an embedded
`foc-config` JSON block naming the shared data set — no query-param
configuration; the only URL parameter is `?game=<id>` in invite links.

## Setup for the storage-backed pieces

Copy `.env.example` to `.env` and set `PRIVATE_KEY` (gitignored). Runtime
configuration lives in the committed `config.env`; scripts and the publish
skill source both.
