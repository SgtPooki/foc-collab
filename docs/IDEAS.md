# What to build next on the piece-log primitive

Collected 2026-08-31 from a four-way brainstorm (local Qwen via omp, plus
game-design notes from the gemini/codex/cursor review round) after the
tic-tac-toe proof shipped. The primitive: signed JSON pieces appended to a
shared FOC data set, state = deterministic fold, ~30-60s per move, no
server anywhere.

## Games that fit 30-60s moves

1. **Connect-4 / checkers** — the planned next rung: flashy enough to
   screen-record, fold logic still trivial.
2. **Silent auction** — blind bids as moves; the latency IS the tension. -- Russell love's
3. **Paint war** — teams claim pixels on a shared 64x64 canvas, one pixel
   per move; cooldown forces pick-your-battles diplomacy. -- Russell love's
4. **Battleship ("Telegraph")** — hidden fleets, one shot per epoch;
   slowness makes every shot matter. Needs a commit-reveal fold (hash the
   fleet in the create piece, reveal at game end) — a genuinely new
   primitive worth proving.
5. **Repeated prisoner's dilemma league** — 8 players round-robin,
   COOPERATE/DEFECT pieces, on-chain league table; slow rounds = strategy. -- Russell investigate
6. **Collaborative jazz ("Fugue")** — four voice lines, each player
   appends one note per epoch; no turns, perpetual jam, state is the score.
7. **Conway's Life seeding** — 100 players claim cells, then the grid
   evolves deterministically; players bet on what survives. -- Russell love's
8. **Word ladder ("Babel")** — each move is a word one edit from the last;
   first to break the chain loses.
9. **Chess/correspondence classics** — the obvious fit; chess clocks
   become epoch clocks.
10. **Chinese checkers** — the flex from the original idea doc: 3-6
    session keys coordinating through nothing but a data set.

## Non-game uses of the same log
Russell: I think some of the below would be WAY better and easier to do if we could actually restrict session keys to specific data-sets.

(That restriction is shipping: dataset-level programmable ACLs merged in
filecoin-services#536, already in Calibnet v1.4.0, mainnet release in
progress — a per-data-set authorizer contract replaces the account-wide
session key and can rate-limit/allowlist/size-cap writers. See the update
in FEASIBILITY.md. Everything below gets easier once tooling catches up.)

- **Guestbook / viewer notes** — the original viewer-saves idea; the game
  proved every primitive it needs.
- **Slow bulletin board** — one post per epoch per key; spam-resistant by
  physics.
- **Collaborative playlist** — enqueue pieces, deterministic queue, anyone
  can publish a player.-- Russell love's this could be an internet jukebox.. 
- **Append-only wiki ("The Archive")** — entries fold into pages; no
  deletes; the log is the database.
- **Shared whiteboard** — one stroke per epoch; the cooldown is the
  anti-vandalism feature.

## Making slow moves feel good (validated + proposed)

Shipped already: optimistic marks, staged progress, countdown ETA,
your-turn tab title + notifications, adaptive polling, rematch.

Worth trying next:
- **Multi-game dashboard** — "Words with Friends" framing: run 5 games at
  once, bounce between them while moves land; latency disappears.
- **Simultaneous-turn designs** — both players commit each round
  (RPS-style); halves the round trips per interaction.
- **Pre-committed conditional moves** — "if they play X, I play Y" pieces;
  the fold resolves them; play continues while you sleep.
- **The ritual** — press-and-hold to "summon" a move with sound/animation;
  hide the first seconds of latency inside ceremony.
- **Replay theater ("The Echo")** — when a move lands, replay the game so
  far fast-forward; the wait becomes an intermission.
- **Latency betting** — side-bet on how many seconds a move takes to land;
  the wait itself becomes a game.

## Scaling homework before a bigger game (from the review round)

- Data-set partitioning: one data set per game (or per day for the lobby),
  so clients stop folding the whole world; snapshot pieces to truncate
  history.
- Incremental sync: high-water piece id, fetch/verify only new pieces.
- Piece-body cache to IndexedDB (localStorage quota ~5MB).
- The account-wide AddPieces grant remains the substrate's real gap:
  data-set-scoped, size-capped grants is the contract feature request this
  work substantiates.
