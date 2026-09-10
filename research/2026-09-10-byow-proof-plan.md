# BYOW multiplayer on FOC: proof plan

Written 2026-09-10 before implementation. Status of every claim is one of
SHIPPED (exists in a dependency we use), PATTERN (documented and buildable,
not built here), GAP (nothing usable exists), or PROVED IN THIS REPO (code
and a run in this repo demonstrate it). The last section is updated as the
proof runs land.

## The claim to prove

Two people, two wallets, two machines, two Filecoin Onchain Cloud data
sets. Each player pays for and writes only to their own data set. Both
clients list both data sets and fold to the same board. FOC is the durable
record; nothing else is trusted for ordering. Gossip is a later,
immediacy-only layer.

## What the previous spike got wrong

The uncommitted spike on this branch (linked `prev`/`ref` in the v1 fold,
localStorage "data sets", a WebSocket relay seam) is disposable. Concrete
defects, each fixed by this plan:

- Fork tie-break by lowest `ref`. A later piece with a lower hash replaces
  an earlier one. That is retroactive seat stealing (third-party `join`
  with a lower hash than O's) and retroactive move replacement (X re-signs
  seq 0 with a different cell after O replied, orphaning O's reply). The
  author can grind cells and, for `create`, the name, to find a low hash.
- Linked semantics were added to v1 pieces without a `v` bump.
- No real per-player data set and no real second wallet.
- Hash ordering ignores the one total order FOC does give for free: piece
  ids inside one data set.

## Ordering model: seat-owner sequencing (v2)

Key observation: in a two-seat alternating game every action has exactly
one legitimate author, and every author's own data set is a chain-assigned
total order (piece ids are monotonic within a data set). So the only
disagreement FOC cannot settle by itself is which of an author's own
duplicates counts, and the author's own data set settles that.

Rules, all pure and synchronous, all inputs either signed fields or the
`pieceId`/`src` annotations the transport attaches when it lists a data
set:

1. A game is identified by `(game, rootDataSet)`. The `create` piece is
   accepted only from the root data set, signed by the token that becomes
   X. The root descriptor travels in the invite link and in lobby
   announces. A third party cannot take X: their `create` lives in a
   different data set and is a different game.
2. Any token other than X may append `join` to its own data set with
   `prev = ref(create)`. Every such join is a candidate, shown as
   "joined, waiting for X to move".
3. X's first move (`seq 0`) ratifies O. It carries `prev = ref(join)` and
   embeds the chosen join's descriptor `o: { token, ds }`, so a
   reader who only knows the root data set can find O's data set. Among
   X's `seq 0` pieces in X's data set, the lowest `pieceId` wins. That is
   final once it lands: no later piece can get a lower id.
4. Move `seq k` is accepted only from the seat whose turn it is, only from
   that seat's home data set, only with `prev = ref(accepted move k-1)`,
   only if the board move is legal, and among the author's qualifying
   `seq k` pieces the lowest `pieceId` wins.
5. Home data set binding is in the signature: `log = "byow:<dataSetId>"`.
   The transport annotates each listed piece with `src` (the data set it
   was read from) and verification drops any piece whose signed `log`
   does not name `src`. Replaying O's signed piece into X's data set does
   nothing.
6. Refs are `sha256(canon(signed body minus sig))`. They are only
   commitments (what did the counterparty build on), never a sort key.

Adversarial checks:

- Late third party steals X or O: X is fixed by the root descriptor. O is
  fixed by X's lowest-id `seq 0` piece. A later `join` is a candidate that
  is never ratified.
- Replace a move after the opponent replied: the replacement gets a higher
  `pieceId` in the author's own data set and loses to the original. The
  opponent's reply references the original by ref and stays valid.
- Grinding: nothing is sorted by hash, name, or signature. The only sort
  key is `pieceId`, assigned by the contract.
- Locale, clocks, receipts, listing order: `pieceId` is compared as a
  BigInt. Wall clock never enters the fold. Listing order does not matter
  because the fold sorts per data set by id before walking.
- Gossiped move never lands: it is only ever in the optimistic view and is
  dropped after a pending TTL. Confirmed view never saw it.
- Landed but never gossiped: the poll picks it up. Gossip is not a
  requirement for correctness.
- One data set unavailable: the fold sees a shorter chain. The UI shows
  "cannot reach O's data set" and keeps the last good view. It is not a
  correctness problem, only liveness.
- Session expired: writes fail with a shown error; reads never need a key.
- Late joiner from FOC only: read root data set, find create and X's
  ratifying move, learn O's descriptor from it, read O's data set, fold.
- Known hole: piece removal. A payer can schedule removal of their own
  piece (`SchedulePieceRemovals`). If X removes their earliest `seq 0`,
  the next-lowest id becomes accepted. A client that already cached the
  removed piece can detect the change and flag the game as disputed. A
  data-set authorizer that blocks removals is the on-chain fix
  (SHIPPED on calibnet v1.4.0 as a capability, GAP in SDK tooling). The
  repo does not close this hole in this pass; it documents and detects it
  where a cache exists.

Rejected models:

- Hash-linked with lowest-ref tie-break: retroactive, grindable (above).
- Explicit `seq` plus receipt or block metadata: `getPieces` yields only
  `pieceId` and CID, and cross-data-set ids are not comparable. Would need
  an event indexer for block numbers and still needs a same-block rule.
- Designated ordering data set: someone pays for and controls every
  write, which is mode 1, not BYOW. Kept as a tournament mode idea only.
- Hybrid chosen: FOC descriptor pieces for rendezvous, per-player data
  sets for moves, per-turn acceptance by signed predecessor plus the
  author's own settled order. That is the model above.

## Discovery without a server

- Invite link: `?game=<id>&x=<ds>`; the reader resolves X's token from
  the create piece and the data set's payer and provider from the chain,
  so a descriptor is nothing but a data set id. Optional `&o=<ds>` lets O
  send a link back if no rendezvous is configured.
- Lobby rendezvous (optional config): the publisher's mode 1 data set with
  an AddPieces-only key carries signed `announce` pieces `{ game, root,
  ds, role }` from both players. It is discovery only; it never orders
  anything and the fold never sees it. This is the "see and join open
  games" surface.
- After X ratifies, O's descriptor is inside X's data set, so late
  readers need nothing but the invite link.
- Gossip (later ladder step) replaces the lobby for immediacy but not for
  durability.

## Proof ladder and what this pass builds

1. Settlement proof. Node script `scripts/byow-proof.mjs`: two wallets,
   two data sets, two independent clients, a full game written only to own
   data sets, then a third read-only client reconstructs from FOC alone.
   Browser version: two Playwright contexts with different player configs.
2. Ordering proof. Unit tests over the v2 fold cover every adversarial
   case above, including duplicates with reversed listing order.
3. UX proof. Invite link with descriptors; join; ratification; lobby
   announce when a rendezvous data set is configured.
4. Latency proof. Not in this pass. js-libp2p gossipsub is the chosen
   pattern; the transport keeps `list()` (optimistic) and
   `confirmedList()` (settled) so gossip can slot in without touching the
   fold.
5. Reconciliation proof. Not in this pass beyond the interface split.

## Status table

| Item | Status | Where |
| --- | --- | --- |
| Per-data-set total order by pieceId | SHIPPED | PDPVerifier `getActivePiecesByCursor` via synapse-sdk |
| AddPieces-only session key per player | SHIPPED | synapse-core session-key, `loginSync` |
| Reading a foreign payer's data set keylessly | SHIPPED | read-only `Synapse.create({ account: payer })` + `createContext({ dataSetId })` |
| Data-set-scoped write authority | SHIPPED on calibnet, GAP in SDK | filecoin-services #536 |
| Signed P-256 pieces, verify before fold | PROVED IN THIS REPO | `identity.js` |
| Mode 1 shared-log game on calibration | PROVED IN THIS REPO | `transport-foc.js`, e2e |
| v2 seat-owner sequencing fold | PROVED IN THIS REPO | `fold-byow.js`, 14 adversarial unit tests, 7 two-client convergence tests |
| Two-data-set FOC transport, keyless reads of foreign data sets | PROVED IN THIS REPO | `transport-byow.js`, runs in node and browser |
| Two-wallet calibration proof run | PROVED IN THIS REPO | `scripts/byow-proof.mjs`, see results below |
| Two-browser proof with invite link | PROVED IN THIS REPO | `e2e/byow.e2e.mjs`, see results below |
| Lobby rendezvous announces | PROVED IN THIS REPO | discovery only; publisher-paid mode 1 data set |
| Root-only reconstruction (late joiner, spectator) | PROVED IN THIS REPO | ratification piece names O's data set (`hints`) |
| Removal detection on cached clients | built, not exercised live | `transport-byow.js` `disputes()`; unit test in `byow-convergence.test.js` |
| Browser wallet or session UX | GAP | players paste a descriptor once |
| js-libp2p gossip | PATTERN | not built |
| Removal-proof settlement | PATTERN (authorizer) | not built |

## Peer review of the ordering model (2026-09-10)

Codex and Cursor reviewed the plan before code was written. Both accepted
the model and asked for the same fixes, all applied:

- Compare `pieceId` as BigInt, never as strings. Tests shuffle listing
  order and vary the id's string form.
- Duplicate `create` in the root: lowest piece id wins.
- X's ratifying move must name the join it references: `o.token` and
  `o.ds` must match the join's signed token and listed `src`, else the
  move does not qualify.
- Enforce `log == "byow:<src>"` before the fold. Done inside the pure
  `usable()` check so the fold itself cannot be fooled by a transport.
- Drop the linked lowest-ref v1 spike entirely rather than keep it beside
  v2. Done; `fold.js` is back to the committed v1 exemplar.
- Removal: a client that cached a piece keeps it and flags a dispute.
  A fresh reader cannot see the removal. Both reviewers agree the on-chain
  fix is a data-set authorizer that blocks removals. Not built.
- Liveness grief: X can collect joins and never move. Product issue, not
  a fork-safety issue. Not built; the UI says who is waiting on whom.

## Results

All against Filecoin Onchain Cloud calibration on 2026-09-10 with two
real wallets, `0x44f0…3759` (data set 35171) and `0x6d0D…F48F` (data set
35170, minted and funded by `scripts/byow-fund-wallet.mjs`), each with its
own AddPieces-only session key. The rendezvous lobby is data set 32352.

Node settlement proof (`npm run proof:byow`), one full game to an X win:

| Step | Time to settle, seconds |
| --- | --- |
| create in X's data set | 70 |
| join in O's data set, discovered by X via lobby announce | 6 after announce |
| X's ratifying move | 50 |
| each later move (4 of them) | 55 to 86 |
| root-only spectator reconstructs the finished game | 8 |

Every piece took about 2 seconds to reach "submitted on-chain" and 50 to
90 seconds to appear in the chain listing. Both players folded to
identical state at every step. The spectator knew only the game id and
the root data set, had no wallet, key, or lobby, and discovered O's data
set from X's ratification piece. `ignored` was 0: nothing was dropped.

Browser proof (`npm run test:e2e:byow`), two isolated Chromium contexts
against the built page with the lobby configured:

| Step | Wall clock |
| --- | --- |
| Alice creates, gets the invite link | 0:00 |
| Bob opens the link, joins from his own data set | 1:49 |
| Alice's page discovers Bob through the lobby | 1:54 |
| Alice's first move ratifies Bob as O | 2:49 |
| Bob's page shows X at 4, "X writes to #35171, O writes to #35170" | 2:49 |
| Bob moves, Alice's page shows O at 0 | 3:50 |

No runtime CDN requests; the page is self-contained.

## Results, second pass: no publisher key (same day)

The rendezvous data set and its embedded session key are gone (see
`2026-09-10-byow-rendezvous-options.md`). Discovery now reads PieceAdded
events: create and join uploads carry `{ app, game, type }` metadata, the
invite carries the create block, and each client scans from there.

Node proof (`npm run proof:byow`): full game, 434 seconds, Alice found
Bob's join through the event scan 1 second after it settled, root-only
spectator agreed, 0 ignored.

Browser proof (`npm run test:e2e:byow`) against a page whose only config
is `{ "mode": "byow" }`:

| Step | Wall clock |
| --- | --- |
| Alice creates; invite carries root data set and start block | 0:00 |
| Bob opens the link, joins from his own data set; his URL now carries `&o=` as the fallback | 1:43 |
| Alice's page discovers Bob's data set from chain events | 1:51 |
| Alice's first move ratifies Bob | 2:44 |
| Bob moves, Alice's board shows it | 3:44 |

One RPC finding that matters for anyone doing browser log scans: the
default glif calibration endpoint fails browser CORS on `eth_getLogs`
responses above about 100 KB (curl succeeds with the same headers), ankr
caps the range below 2,000 blocks, and filfox and drpc serve 2,000-block
scans to a browser in 2 to 3 seconds. Scans use filfox then drpc; the SDK
keeps glif for everything else.

## What is proved, simulated, and missing

Proved on calibration with two wallets: settlement (ladder step 1),
deterministic cross-data-set ordering with the adversarial cases covered
by tests (step 2), and the create, share-link, join, ratify flow with
lobby discovery (step 3).

Simulated only: piece removal (memory FOC in the unit test); the
transport's dispute path was not exercised against a real
`SchedulePieceRemovals`.

Not built: gossip (step 4) and gossip reconciliation (step 5). The
transport already separates `list()` from `confirmedList()` so a gossip
layer can add optimistic pieces without touching the fold.

Still manual: each player runs `scripts/byow-setup-player.mjs` with their
wallet and pastes the printed descriptor once. A wallet-connect flow that
creates the data set and authorizes the session key from the page is the
missing UX piece. There is no publisher-paid anything left; the page is
static config plus code.

Cost of the proof: about 0.1 tFIL of gas across both wallets and the
10 USDFC deposit for wallet B, of which storage for a few kilobytes is a
rounding error.

## Credentials for the run

One funded calibration wallet exists locally. The proof mints a second
wallet, funds it from the first (tFIL for gas, USDFC for the deposit), runs
payment setup for it, then creates one data set and one AddPieces session
key per wallet. Private keys stay in gitignored `.env`; the scripts print
only addresses, data set ids, and the browser descriptor JSON.
