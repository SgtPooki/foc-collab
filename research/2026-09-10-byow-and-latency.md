# BYOW and latency hiding for FOC games

Superseded on the ordering question, 2026-09-10 (same day): peer review of
the linked lowest-ref model below found it allows retroactive seat stealing
and move take-backs by hash grinding. The model that shipped is seat-owner
sequencing (schema v2), in `research/2026-09-10-byow-proof-plan.md`. The
fast-channel ranking (js-libp2p gossipsub first) still stands.

Decision, 2026-09-10: use hash-linked game actions for cross-data-set order, and use automatic room-based signed-piece gossip for immediacy while Filecoin Onchain Cloud remains the durable record.

## Context

The current tic-tac-toe game folds one shared data set in piece-id order, so the chain supplies a single total order before the fold runs. That works for mode 1 because `StorageContext.getPieces` walks active pieces by cursor and yields `{ pieceCid, pieceId }`, which the FOC transport sorts before downloading bodies (`node_modules/@filoz/synapse-sdk/src/storage/context.ts:1109`, `games/tic-tac-toe/transport-foc.js:92`). It stops being enough when X and O write to different data sets.

Mode 2, BYOW, keeps the write cost and blast radius with the player. The existing session-key model can authorize only `AddPieces`, but the permission is keyed by owner, session key, and permission type, not by data set (`node_modules/@filoz/synapse-core/src/session-key/permissions.ts:21`, `node_modules/@filoz/synapse-core/src/session-key/authorization-expiry.ts:136`). `Synapse.create` can validate a narrower permission set, but on-chain enforcement still owns the operation result (`node_modules/@filoz/synapse-sdk/src/types.ts:117`). This makes the two-party `filecoin-pin session generate` plus `session authorize` flow the right current BYOW handshake, with each player authorizing a throwaway session key against their own payer wallet.

Signed pieces are already the game integrity boundary. `verifyAll` runs between transport fetch and fold, and the fold receives only pieces whose P-256 signature verifies against their own token (`games/tic-tac-toe/identity.js:91`, `games/tic-tac-toe/identity.js:102`). That means a move can arrive by WebRTC, Waku, Nostr, or FOC and still be the same move if the signed body is identical.

## Ordering Decision

Use hash-linked moves, with deterministic same-predecessor tie-breaking by derived piece reference.

Each game action carries `prev`, the derived reference of the accepted predecessor. A `create` action has `prev: null`; the accepted `join` references the accepted `create`; move 0 references the accepted `join`; each later move references the accepted prior move. Verification annotates each signed piece with `ref = sha256(canonical signed piece)`, outside the signed body, before the synchronous fold runs (`games/tic-tac-toe/identity.js:34`). The fold follows the accepted predecessor chain and sorts same-predecessor candidates by `ref` (`games/tic-tac-toe/fold.js:117`). This keeps ordering self-describing even when pieces settle in different data sets.

Rejected alternatives:

- Explicit `seq` plus block timestamp is a weak fit. `seq` is still useful as a rule guard, but block timestamps are not available from the current `getPieces` path, and the SDK read shape only yields piece id and CID (`node_modules/@filoz/synapse-sdk/src/storage/context.ts:1109`). A timestamp path would need event or receipt indexing, then it would still need a deterministic same-block tie-breaker.
- A shared ordering data set restores the old invariant but loses the main BYOW property. Someone pays for and controls that data set, and every move still needs to touch shared write authority. It is useful as a tournament or arbiter mode, not as the default BYOW game mode.

Hard-problem answer 1, cross-data-set deterministic ordering: **PATTERN, prototyped.** Hash links make the accepted chain independent of data-set piece ids. The current spike adds `lastRef`, linked ordering, and fork tie-breaking to the pure tic-tac-toe fold (`games/tic-tac-toe/fold.js:29`, `games/tic-tac-toe/fold.js:128`). The same change ports to connect-four because its fold has the same create, join, move, seq shape (`games/connect-four/fold.js:1`).

## Fast Channel Decision

Use js-libp2p pubsub first. The fast channel carries only signed pieces, needs no user action beyond opening or sharing a game link, and treats FOC as settlement, rendezvous, and catch-up.

Ranking:

- **js-libp2p gossipsub in browser: PATTERN.** Best fit for the repo goal: multiplayer and tenant coordination without a game server. Current npm packages are active as of 2026-09-10: `libp2p@3.3.11`, `@chainsafe/libp2p-gossipsub@14.1.2`, `@libp2p/webrtc@6.0.32`, and `@libp2p/circuit-relay-v2@4.2.13`. The page should join deterministic topics such as `/foc-collab/ttt/lobby/1` and `/foc-collab/ttt/game/<game>/1`; FOC pieces are the durable state and can also publish bootstrap or rendezvous hints.
- **Waku: PATTERN.** Similar room-based relay shape and strong no-operated-server story, but it is less aligned with the libp2p direction of this repo. Keep it as a fallback if browser libp2p relay discovery is too fragile.
- **Nostr relay: PATTERN.** Practical for automatic room discovery and signed-piece broadcast through public relays. It relies on relay infrastructure we do not operate, and Nostr event signing is extra identity machinery beside the existing P-256 game identity.
- **WebRTC data channel: PATTERN/GAP.** Useful as a libp2p transport, not as a manual UX. Manual offer/answer exchange is rejected for this product. Browser clients need relays, bootstrap peers, or FOC-published peer hints so opening the page is enough.
- **BroadcastChannel: rejected for this goal.** Same-machine delivery is already solved by local dev and does not address cross-machine BYOW.

Hard-problem answer 2, fast side channel without a dedicated server: **PATTERN/GAP, prototyped as an automatic relay seam.** The browser spike connects to configured `byow.fastRelays`, subscribes to a room, and publishes signed pieces without an extra user step (`games/tic-tac-toe/transport-byow.js:124`). The gap is replacing the simple WebSocket relay shim with js-libp2p gossipsub, WebRTC transport, and circuit relay/bootstrap configuration.

## Reconciliation And Anti-Cheat

The UI should keep two views: optimistic and confirmed. The optimistic view folds verified chain pieces plus verified fast-channel pieces. The confirmed view folds only FOC pieces returned from the players' data sets. A fast piece is shown immediately, marked pending until it appears in one owner data set, and removed after a pending TTL if it never settles.

The current tic-tac-toe UI already has a pending model for "my move". The BYOW version extends the same model to opponent moves: every pending piece is allowed to influence the optimistic board, but confirmed state is the tiebreaker of record. If a pending piece never lands, the transport drops it after the TTL and emits a change. If settlement produces a different accepted chain, the optimistic board re-folds over the confirmed chain and any still-live pending descendants.

Hard-problem answer 3, optimistic-vs-confirmed reconciliation: **PATTERN, prototyped.** `createByowMemoryHub` and the browser BYOW transport expose `list()` for optimistic reads and `confirmedList()` for settlement checks (`games/tic-tac-toe/transport-byow.js:68`). The test proves Bob sees Alice's move through the fast path before delayed settlement, then both clients converge after confirmation (`games/tic-tac-toe/byow-convergence.test.js:21`).

Hard-problem answer 4, anti-cheat/trust: **PATTERN.** A malicious client can gossip lies only under its own key. Signature verification drops forgeries before fold; game rules drop out-of-turn, duplicate-seq, and impostor pieces; settlement drops pieces that never land. A malicious player can still equivocate by signing two legal successors for the same predecessor. The deterministic lowest-ref fork rule makes every client resolve that fork identically, and the confirmed chain remains the durable audit record. For money or ranked play, add a dispute UI that shows the losing fork and require confirmed-only state before scoring.

## Session Setup And Discovery

Use an invite that carries the game id, both player tokens, and the data-set descriptors known so far. X creates a game in X's data set, gossips or shares an invite, and includes X's data-set id plus payer address. O opens the invite, creates or selects O's own data set, authorizes their own AddPieces-only session key, appends a `join` piece to O's data set referencing X's create ref, then shares an updated invite or gossips the join. From then on both clients list both data sets and write only to their own.

Invite shape:

```json
{
  "game": "game-...",
  "transport": "byow",
  "players": {
    "X": { "token": "...", "wallet": "0x...", "dataset": "123" },
    "O": { "token": "...", "wallet": "0x...", "dataset": "456" }
  }
}
```

Discovery without a game server has two workable layers. Libp2p lobby topics carry open-game announcements for players who arrive without a link. The invite link carries the exact game topic and X descriptor for players who arrive by share. O's descriptor is published to the same game topic when O joins. FOC can serve as the slow sync point: an open-game create piece or profile piece can include the data-set descriptor and optional libp2p peer/rendezvous hints, so a late client can recover even if it missed gossip.

Hard-problem answer 5, session setup and discovery across data sets: **PATTERN/GAP.** Per-player data sets are buildable with today's SDK once each player has a payer wallet, data set, and AddPieces session key. The gap is ergonomic: browser BYOW setup still needs a wallet UX or a wrapper around `filecoin-pin session generate` plus `session authorize`; SDK helpers for authorizer-mediated writes are also called out as a gap in the existing capability matrix (`research/2026-09-01-build-order-and-capability-matrix.md:96`).

## Shipped, Pattern, Gap

| Item | Status | Notes |
| --- | --- | --- |
| Single shared FOC log | SHIPPED | Current mode 1 transport, piece-id ordered. |
| Signed game pieces | SHIPPED | P-256 identity and verification already gate the fold. |
| Linked cross-data-set ordering | PATTERN | Prototyped in tic-tac-toe fold and tests. |
| BYOW per-player data sets | PATTERN | Prototyped locally; FOC write path is composition of existing session-key and context APIs. |
| js-libp2p gossipsub fast path | PATTERN/GAP | Recommended production fast channel; the spike exposes the relay seam but does not vendor libp2p yet. |
| Waku/Nostr fast path | PATTERN | Fallback public-relay options if browser libp2p discovery is not stable enough. |
| WebRTC fast path | PATTERN/GAP | Useful as a libp2p transport; manual signaling is rejected. |
| Same-machine BroadcastChannel fast path | Rejected | Useful for local dev, invalid for cross-machine BYOW. |
| Confirmed-only settlement view | PATTERN | Transport API has `confirmedList()` in the spike; UI still needs visible pending-opponent affordances. |
| Browser wallet/session setup | GAP | Needs real BYOW UX around data-set creation and the two-party session flow. |
| Provenance event indexing | GAP | Needed for timestamp designs and better settlement UX; `PieceAdded` events expose dataSetId, pieceId, pieceCid, keys, and values (`node_modules/@filoz/synapse-core/src/abis/generated.ts:2530`). |

## Prototype Notes

The spike intentionally stays temporary and local:

- `games/tic-tac-toe/fold.js` keeps the fold pure and synchronous while adding linked ordering.
- `games/tic-tac-toe/identity.js` derives piece refs during async verification.
- `games/tic-tac-toe/index.html` signs `prev` into create, join, and move bodies.
- `games/tic-tac-toe/transport-byow.js` simulates each player's own data set and exposes an automatic relay seam for cross-machine fast delivery behind the existing `append()`/`list()` interface.
- `games/tic-tac-toe/byow-convergence.test.js` covers two-client fast-path convergence and delayed settlement.

Validation: `npm test` passes with 27 tests on 2026-09-10.
