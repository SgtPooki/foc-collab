# Crowd-sourced moves: N vs M teams on the BYOW piece log

Brainstorm, 2026-09-11. Question: can a team of N players control seat X
and a team of M control seat O, with the team's move resolved by the pure
fold, so that the roughly 60 second settlement per piece stops feeling
like dead time? "Twitch Plays Pokemon" for tic-tac-toe and connect-four.

Grounding, read before writing this:

- `games/lib/byow-engine.js`: the schema v2 fold. A seat is owned by a home
  data set (`homes.X` is the root, `homes.O` is the ratified joiner's data
  set). Move k is the lowest piece id inside the seat owner's data set
  with `seq === state.seq`, `prev === state.lastRef`, and `rules.legal`
  true (lines 171-179). X's seq 0 move ratifies one join and names its
  data set in `o` so a root-only reader can find it (lines 150-168).
- `games/tic-tac-toe/fold-byow.js` and `games/connect-four/fold-byow.js`:
  the `rules` adapters (`initial`, `legal`, `place`); the move field is
  `cell` for tic-tac-toe and `col` for connect-four.
- `games/lib/play-byow.js`: the shared page shell, lines 83-96: a page is
  BYOW when the transport has `addDataSet`; "who am I" is
  `seatOfHome(state, transport.me.ds)`.
- `games/lib/transport-byow.js`: appends go to my own data set with
  discovery tags (line 322-325); reads can cover any number of data sets
  (`addDataSet`, line 313).
- `docs/IDEAS.md`: "Making slow moves feel good" and the scaling homework.
- `research/2026-09-11-state-peer-review.md`: all three reviewers say the
  60 second turn plus BYOW onboarding is the product problem; Cursor ranks
  a latency-hiding layer fourth, Gemini wants the ratification epoch gone.

## The constraint that shapes everything

The fold has no wall clock and no cross-data-set order. The only order it
trusts is piece id inside one data set (CLAUDE.md, "Rules a linter cannot
enforce"). Two consequences for crowd moves:

1. "First proposal wins" across members is undefined. Ten members writing
   to ten data sets produce ten independent sequences; nothing says which
   came first, and the fold must not invent an order from hashes, names,
   or signatures.
2. A resolved move must be monotone: once the fold has decided move k,
   no piece that lands later may change it, because the other team's move
   k+1 chains to `prev = ref(move k)`. The v2 engine gets monotonicity
   from "lowest id inside one data set, ids only grow". Any crowd rule
   needs the same property, and the only ways to get it without a clock
   are (a) a single sequencer data set whose piece order is the team's
   clock, (b) a closing condition that becomes impossible to satisfy a
   second time once met, or (c) a fixed, fully enumerated voter set so
   the tally is final when the last voter is in.

Every rule below is judged on those two points first.

## 1. Resolution rules

Common vocabulary: a `propose` piece is written by a member to the
member's own data set with `seat`, `seq`, `prev = state.lastRef`, and the
board field (`cell` or `col`). One vote per member per turn: the fold
takes the lowest piece id inside that member's data set that matches
`seq` and `prev`, and ignores later ones (same idea as move selection at
`byow-engine.js:174`). A member cannot change a vote, only cast a first
one; that is what makes tallies stable.

### Rule A: advisory crowd, captain plays

The seat owner (today's `homes.X` or `homes.O`) is the captain. Members
propose; the captain reads the tally in the UI and writes an ordinary v2
move. The fold does not look at proposals at all.

- Piece ids: unchanged, the engine's move rule at `byow-engine.js:174`.
- Closing: whenever the captain writes the move.
- Ties: the captain's choice; there is no fold-level tally.
- Attacks: none from the other team. Inside the team the captain can
  ignore everyone; the crowd is decoration.

Zero engine change. Worth listing because it is the baseline the other
rules are measured against: is the extra fold logic buying anything a UI
tally does not?

### Rule B: captain-tallied quorum (recommended, see section 3)

The captain still writes the move in the seat's home data set, but the
move piece carries `picks`, a list of `{ ref, ds }` naming the proposals
the captain is counting. The fold verifies the move against those
proposals:

- every picked ref must resolve to a `propose` piece in `all` (so the
  reader has fetched that member's data set), from a data set on the
  team's roster (section 2), with `seat`, `seq === state.seq`, and
  `prev === state.lastRef`;
- at most one pick per member data set, and it must be that member's
  lowest-id proposal for this turn (a captain cannot pick a member's
  second thoughts);
- the number of valid picks is at least the quorum `q` fixed in the
  `create` piece;
- the move's board field equals a plurality value among the picks; when
  several values tie for plurality the captain's move may be any of them.

If any check fails the move is not `legal` and the fold keeps looking, so
a captain who cheats simply has not moved yet.

- Piece ids: the move is still the lowest qualifying id in the seat's
  home data set (monotone, ids only grow). Proposal identity is "lowest id
  inside the member's data set for this `(seq, prev)`". No cross-data-set
  order is consulted anywhere.
- Closing: the captain's move closes the turn. The fold never needs to
  know whether more proposals were coming.
- Ties: the captain breaks ties among plurality values by choosing one;
  the choice is signed and inside the sequencer data set, so it is a
  signed decision, not a sort.
- Attacks. Opposing team: nothing; they cannot write to our home or our
  rosters. Own team: the captain can omit proposals it dislikes (it must
  still reach `q`, so it cannot play solo), and can stall by not moving.
  Members can spam, but only their first proposal per turn counts and
  extra pieces cost them write fees. Sybil data sets only matter if they
  are on the roster, which section 2 covers.

Readers see the omission: the UI can count proposals with the right
`(seq, prev)` that were not in `picks` and show "captain skipped 3".
Reputation, not enforcement.

### Rule C: full-roster plurality, no captain

The roster is fixed and enumerated (a `roster` piece in the seat's home,
section 2). The turn closes when every roster member has a proposal for
`(seq, prev)`; the move is the plurality value.

- Piece ids: each member's vote is the lowest id inside their own data
  set for this turn; the tally is a multiset with exactly one entry per
  member, so it is final the moment the last member is in. Monotone by
  construction (case (c) above).
- Closing: the last member's proposal. No clock needed.
- Ties: needs a deterministic order over the tied values that is not a
  hash. Two candidates that respect the CLAUDE.md rule: the board's own
  index order (lowest `cell` or `col` wins, a game rule, but it biases
  play toward low cells), or the roster order fixed in the `roster` piece
  (the tied value proposed by the earliest-listed member wins). Roster
  order is a signed list inside one data set, so it is allowed. Prefer
  roster order.
- Attacks. Opposing team: nothing. Own team: one absent member stalls the
  game forever, because the fold cannot tell "not yet" from "never".
  Mitigation is a captain `drop` piece, which brings the captain back.
  Members cannot spam past their first vote.

Fully decentralized inside the team but brittle on liveness. Fine for a
roster of three friends, not for a drop-in crowd.

### Rule D: rotating closer

Same as Rule B but the sequencer rotates: the closer for turn `seq` is
`roster[seq mod roster.length]` (or `roster[k]` for the team's k-th
move). The closer writes a `move` with `picks` in the closer's own data
set; the fold looks for the move in that data set instead of a fixed
home.

- Piece ids: lowest qualifying id inside the closer's data set for this
  turn; monotone because the closer is determined by state before the
  turn starts.
- Closing: the closer's move, quorum as in Rule B.
- Ties: the closer's signed choice, as in Rule B.
- Attacks: the same as Rule B, but a stalled closer stalls one turn,
  not the game, only if there is a fallback, and there is no fallback
  without a clock. So the stall is the same; what rotates is who can
  cause it. Engine impact is larger: `homes[seat]` at
  `byow-engine.js:174` becomes a function of state, and `seatOfHome`
  (used by `play-byow.js:95` to decide who I am) must answer "member of
  X" rather than "owner of X".

### Rule E: relay, no vote

The Twitch-chat version: roster members play in roster order, one member
per team move, no tally. Turn `k` of team X is written by
`roster.X[k mod n]` in that member's own data set.

- Piece ids: lowest qualifying id inside that member's data set.
- Closing: the member's move.
- Ties: none, one author per turn.
- Attacks: a griefer on your own team plays a bad move every n turns;
  the other team cannot interfere. An absent member stalls the game
  (same liveness gap as C and D).

Cheap and chaotic. The fun is watching, not deciding. It is the same
engine change as Rule D without `picks`.

### The anti-rule: first-to-post across data sets

Listed only to reject it. "Whichever member's proposal lands first is the
move" needs a cross-data-set order; the fold has none, and using block
numbers or timestamps would violate the ordering rule. Any UI that shows
proposals "in arrival order" is showing this reader's arrival order, not
a fact about the game.

## 2. Team membership in BYOW terms

Today: one `create` in the root (X), any number of `join` pieces with
`prev = ref(create)` from other data sets, and X's seq 0 move ratifies
exactly one join, naming its data set in `o` (`byow-engine.js:145-168`).
Ratification exists so a reader that knows only the root can find O's
data set (`dataSetsOf`, lines 198-204).

Options for "who is on team X":

1. Open join with a `team` field. `join` gains `team: 'X' | 'O'`. Any data
   set that has such a join is a member. Problem: the opposing team can
   join both teams, and a reader still cannot find member data sets from
   the root alone (joins live in the members' data sets). Works only if
   something in the seat's home names the members, which is what `picks`
   does in Rule B: every `{ ref, ds }` is a discovery hint, exactly like
   `o` today. So open join plus Rule B is "anyone may propose, the captain
   decides whose proposals count by picking them", and the captain
   omitting an infiltrator's proposal is the whole sybil defense.
2. Captain roster. The seat home writes `roster` pieces that append
   member data sets (append-only, lowest id first, like everything else
   in the home). Needed by Rules C, D, E, where the fold must enumerate
   the team. Discovery is free: the roster is in the home.
3. First N joiners. Undefined across data sets: joins are in the joiners'
   data sets and have no mutual order. Only a captain roster can say who
   was "first". Reject as a fold rule; fine as a UI hint the captain
   follows.

Does ratification generalize? Yes, one level. X's seq 0 move ratifies the
O captain exactly as today, so the two-captain skeleton is the current
engine unchanged. Each captain then admits members by `roster` pieces
(option 2) or implicitly by `picks` (option 1). The join-with-`team`
field is still useful as the member's own signed claim "I am playing for
X in this game", so a member's proposals cannot be replayed as votes for
the other team, but membership itself is a captain decision, not a join
decision. That mirrors how the engine already treats O: the join is a
candidate, the seat owner's piece makes it real.

Cost note, no numbers invented: each member needs a funded wallet, a
data set, and an AddPieces session key (`docs/BYOW-PLAYERS.md` and
`scripts/byow-setup-player.mjs`). The peer review calls this onboarding
the main product friction for two players; a team of ten multiplies it.
Once the per-data-set authorizer that `docs/IDEAS.md` (lines 36-40)
points at is usable from tooling, a team could instead share one
sponsored data set for proposals, and the fold would need a different
proposal identity (piece id inside the shared team data set, which is a
real order). That would make Rule C and the anti-rule viable within one
team. Not available today.

## 3. Simplest rule that is still fun

Rule B, captain-tallied quorum, for these reasons:

- It is the v2 engine plus one extra legality check. Seats, homes,
  ratification, `seatOfHome`, `dataSetsOf`, and the move loop stay as
  they are; the crowd is an argument to `legal`. Rules D and E change
  what a home is; Rule C changes how a turn ends.
- It is monotone for free, by reusing the "lowest id inside the home"
  rule for the move.
- Liveness has exactly one failure point (the captain), the same one the
  current 1v1 game already has (the seat owner not moving).
- It is fun because the crowd is binding. The captain cannot move with
  fewer than `q` proposals and cannot pick a losing value, so members'
  votes decide the game, and the captain's job is timing: close now at
  quorum, or wait for more. Rule A has no stakes; Rule E has no
  deliberation.
- The quorum is the latency dial. With `q = 3` on a team of 10, a turn
  closes when the first three settle plus the captain's close; the wait
  is for people, not for the chain.

## 4. Piece shapes and the fold loop

Schema bump: v3. `propose` is a new type, `move` gains `picks`, `join`
gains `team`, `create` gains `crowd`. A v2 reader ignores `propose`,
`team`, `picks`, and `crowd` (its `find` calls match on `type` and the
fields it knows), so it would fold a crowd game as a plain 1v1 between
the captains and get a different state from the same pieces. Two readers
disagreeing over one log is the one thing the thesis forbids, so bump `v`
per the CLAUDE.md rule rather than overloading v2.

```json
{ "v": 3, "app": "foc-ttt", "log": "byow:<root>", "type": "create",
  "game": "<id>", "token": "<x-captain>", "name": "friday crowd",
  "crowd": { "quorum": 3 } }

{ "v": 3, "app": "foc-ttt", "log": "byow:<member ds>", "type": "join",
  "game": "<id>", "token": "<member>", "prev": "<ref(create)>", "team": "X" }

{ "v": 3, "app": "foc-ttt", "log": "byow:<member ds>", "type": "propose",
  "game": "<id>", "token": "<member>", "seat": "X", "seq": 4,
  "prev": "<ref(move 3)>", "cell": 4 }

{ "v": 3, "app": "foc-ttt", "log": "byow:<root>", "type": "move",
  "game": "<id>", "token": "<x-captain>", "seq": 4, "prev": "<ref(move 3)>",
  "cell": 4,
  "picks": [ { "ref": "<ref(propose a)>", "ds": "<ds a>" },
             { "ref": "<ref(propose b)>", "ds": "<ds b>" },
             { "ref": "<ref(propose c)>", "ds": "<ds c>" } ] }
```

The O captain's join is today's `join` with `team: 'O'`; X's seq 0 move
ratifies it exactly as now and carries `picks` like any other move. A
`close` piece is not needed: the move is the close. The captain's own
proposal may be one of the picks; a captain who wants to vote writes a
`propose` in the home like any member.

Rules adapter addition, one function, so the engine stays generic over
tic-tac-toe (`cell`) and connect-four (`col`):

```js
// games/tic-tac-toe/fold-byow.js
moveKey: (piece) => String(piece.cell)
// games/connect-four/fold-byow.js
moveKey: (piece) => String(piece.col)
```

Engine changes in `games/lib/byow-engine.js`, kept to the move loop:

- `usable`: accept `V = 3`; everything else unchanged.
- `initialByowState`: add `quorum` (from `create.crowd.quorum`, an
  integer at least 1, otherwise the game is not a crowd game and `picks`
  is not required) and `members: { X: [], O: [] }` (data sets that have a
  `join` with `prev = ref(create)` and a `team`; the root is implicitly
  on X, the ratified O home on O).
- A new pure helper, called from inside the existing loop at line 174:

```js
function crowdLegal(state, seat, move, all, rules) {
  if (state.quorum == null) return true
  if (!Array.isArray(move.picks)) return false
  const seen = new Set()
  const keys = []
  for (const pick of move.picks) {
    const p = all.find((x) => x.ref === pick.ref)
    if (p == null || p.type !== 'propose' || p.seat !== seat) return false
    if (p.seq !== state.seq || p.prev !== state.lastRef) return false
    if (!state.members[seat].includes(p.src) || seen.has(p.src)) return false
    if (firstProposal(all, p.src, seat, state.seq, state.lastRef) !== p) return false
    if (!rules.legal(state, p)) return false
    seen.add(p.src)
    keys.push(rules.moveKey(p))
  }
  if (seen.size < state.quorum) return false
  return pluralityKeys(keys).includes(rules.moveKey(move))
}
```

`firstProposal` is the lowest-id `propose` inside `src` that matches
`(seat, seq, prev)`; `all` is already sorted by `bySrcThenId`
(line 132), so it is the first match. `pluralityKeys` counts keys and
returns every key with the maximum count. The move loop becomes:

```js
const move = all.find((p) => p.type === 'move' && p.src === state.homes[seat]
  && p.seq === state.seq && p.prev === state.lastRef
  && rules.legal(state, p) && crowdLegal(state, seat, p, all, rules))
```

The ratification loop at line 155 gets the same `crowdLegal` call.
`dataSetsOf` adds `members.X`, `members.O`, and every `picks[].ds` from
moves in the homes, so a root-only reader reaches members in the same
two-poll pattern that finds O today. State gains `tally` per seat for the
UI: proposals for the current `(seq, lastRef)` grouped by `moveKey`, and
`picked` on each applied move, so the page can show what the captain
counted.

New engine or extend? Extend. The delta is one helper, one adapter
function, two state fields, and a `V` bump; a second engine would copy
the 180 lines that are not changing. The 1v1 game is the `quorum == null`
case of the same fold, so the existing tests keep running against it.

## 5. UI sketch for a team turn

The page shell in `games/lib/play-byow.js` already has the pieces: a
pending optimistic move, staged progress for the in-flight append
(`busyStage`), notifications when it is your turn, and a status line.
The crowd turn adds one panel above the board.

Member, during their team's turn:

- Board cells show a small count of proposals for that cell from the
  current tally (members' data sets, verified, matching `(seq, prev)`).
  Clicking a cell writes a `propose`; it shows as "your vote, settling"
  with the same staged progress a move has today, then flips to a count.
- A header line: "X to move: 4 of 10 members voted, quorum 3 reached,
  captain can close". Before quorum: "2 of 10 voted, need 3".
- The member cannot vote twice; the cell they voted for is marked.

Captain, during the team's turn: the same view plus a "close with cell 4
(plurality, 3 votes)" button that is disabled until quorum and only
offers plurality cells (ties show one button per tied cell). Closing
writes the `move` with `picks`; the board shows the mark optimistically
as it does now.

Everyone, during the other team's turn: the other team's tally is
public, so the panel shows it live ("O: 6 of 8 voted, leading cell 8").
That is the part that makes the wait watchable: the opponent's
deliberation is a spectator event instead of a blank board.

What the 60 seconds feels like with 10 people: proposals do not arrive
at once; each member's `propose` settles on its own roughly 60 second
schedule, so the tally grows over a minute or two, then the captain's
close takes its own settlement. A team turn is therefore at least two
settlements end to end (a proposal, then the close), about the time two
1v1 moves take today, but the screen changes every poll instead of once.
The judgment call for the captain is whether to close at quorum or wait
for stragglers, which is a real decision with visible consequences, and
that is where the latency goes.

Spectators (no wallet) get the same page minus buttons: the whole thing
is readable keylessly from the member data sets, as any BYOW game is.

## 6. Open questions and the weekend prototype

Open questions:

1. Quorum choice: fixed in `create`, or a fraction of the roster? A
   fraction needs a roster count, which needs the captain roster piece
   (section 2, option 2), not just `picks`.
2. Captain liveness: the game dies if the captain leaves. Rule D
   (rotating closer) is the fold-level fix but does not remove the stall,
   it moves it. Is "the captain is a small bot that closes at quorum"
   the honest answer? A bot captain is the CPU-opponent work from
   issue #2 wearing a different hat.
3. Read cost: `dataSetsOf` grows to N + M data sets per game, each polled
   on the page's adaptive schedule. The "scaling homework" in
   `docs/IDEAS.md` (incremental sync, piece cache) stops being optional
   at ten members.
4. Onboarding: ten funded calibration wallets is the same friction the
   peer review flagged, times ten. Is the first crowd game a 3v1 among
   people who already have descriptors in `.byow/`?
5. Proposal `prev`: a member must see move k settle before proposing for
   k+1, so the tally cannot start until the previous close lands. Could
   `prev` be relaxed to "the captain's last move I saw" with the fold
   checking `seq` only? That reopens replay of old proposals across
   turns; `prev` is the replay guard. Keep it unless a test shows the
   wait is unbearable.
6. Whether `team` on `join` should be required for members or whether a
   `propose` with a valid pick is enough membership. Required is safer
   (a signed statement of side) and costs one piece per member.
7. v3 and old pieces: nothing on calibration is v3 yet, so "handling old
   pieces" is `usable` rejecting v2 in a v3 game and the reverse. Confirm
   the lobby (`lobbyByow`) keeps listing v2 games untouched.

Smallest prototype that proves the idea, in one weekend:

- Saturday, no network: `crowdLegal`, `moveKey`, `members`, `quorum`, and
  `dataSetsOf` in `games/lib/byow-engine.js`, with `node:test` cases in
  the style of the existing engine tests: quorum not met, captain picks a
  losing cell, captain picks a member's second proposal, a pick from a
  data set that never joined, a tie the captain resolves, a v2 reader
  and a v3 reader over the same pieces. The 1v1 tests must pass
  unchanged with `quorum == null`.
- Sunday, calibration: one `propose` button and the tally line in the
  tic-tac-toe page via `play-byow.js`, then a 2v1 game with the wallets
  that already exist in `.byow/` (the A, B, C descriptors from the BYOW
  proof and the wallet e2e): A is the X captain with quorum 2, C joins X
  and votes, B plays O alone. Success is one full game where at least one
  X move was blocked by the fold until C's vote landed and the stranger
  reconstruction (`npm run proof:byow` style, root only) shows the same
  board.

If Sunday works, the next step is not 10v10; it is the bot captain from
open question 2, because that is what turns "waiting on a person to
close" into "waiting on quorum", and quorum is the thing the players
control.
