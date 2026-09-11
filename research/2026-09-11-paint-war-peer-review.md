# Peer review of the paint war design, 2026-09-11

Codex reviewed the proposed design (Gemini's run did not return). Raw response, unedited, after the prompt.

## Prompt


# Design review: paint war on foc-collab

Read: CLAUDE.md (rules), games/chat/fold.js and games/lib/room-byow.js (the room pattern shipped an hour ago), games/lib/transport-byow.js (appendSponsored, guestStatus, incremental sync), contracts/authorizer/src/ArcadeAuthorizer.sol, site/arcade.json, docs/IDEAS.md (paint war is the idea Russell marked as loved), research/2026-09-01-acl-games-strategy.md (paint war section), research/2026-09-11-flywheel-peer-review.md (your peers said: chat before paint war, read scaling and snapshots before paint war goes public).

State: the arcade has a sponsored data set (35446) with ArcadeAuthorizer attached (per-guest cooldown 4 epochs, 1 piece/op, global budget 200 pieces per 2880 epochs, owner-tunable, pausable, blocklist). A wallet-less browser posted to chat through it today; the post settled in 75s. Incremental per-data-set sync is in. No snapshot piece type exists yet. Foc-observer's PieceAdded index is stalled so discovery is raw eth_getLogs in 2000-block chunks.

## Proposed design (critique it)

1. Sponsored-data-set only. Everyone paints through a dedicated second arcade data set ("paint", its own policy: larger budget, e.g. 5000 pieces per day, cooldown 2 epochs), wallet players included, each with a guest key minted in the browser. Reason: the fold trusts only piece id inside one data set (CLAUDE.md), and last-writer-wins on a pixel needs a total order, which one data set gives for free and BYOW-across-data-sets cannot. Cooldown and spend are contract law. Wallet players get nothing extra in v1.
2. Piece: { v: 2, app: 'foc-paint', log: 'byow:<ds>', type: 'pixel', board: 'main', x, y, c, token } with x,y in 0..63 and c a palette index 0..15. Fold: cells[y*64+x] = c of the highest piece id; per-author counts for a leaderboard; ignored counts. Boards are rooms (the game tag), so `board=main` is discoverable like a chat room.
3. Snapshots: a `snapshot` piece { type: 'snapshot', upto: <pieceId>, cells: <rle> } written by the arcade wallet (the payer). Readers that trust it fold from the latest snapshot plus pieces after `upto`. How a reader knows the payer wrote it: the authorizer decodes operationData's metadata and refuses non-payer pieces tagged type=snapshot, so a snapshot-tagged PieceAdded event is chain-enforced authorship. Not in v1; v1 folds everything (budget caps the log at a few thousand pieces).
4. UI: a 64x64 canvas scaled up, 16-colour palette, click to paint, the pending pixel shown at once, cooldown countdown from guestStatus(), a "who painted this" tooltip from the fold, a leaderboard by pixels standing (not pixels placed). Discovery from the paint data set's creation block.
5. Fun: none of the research's team/territory ideas in v1. Just a shared canvas that is slow enough that every pixel is a decision.

## Questions

1. Is sponsored-only right, or is there a sound way to let wallet players paint from their own data sets without violating the no-cross-author-order rule? (For example: pixels from BYOW data sets are advisory until the arcade "adopts" them, or conflicts resolve by a rule that does not need order, such as "a pixel can only be painted once".)
2. Is chain-enforced snapshot authorship via metadata-gating in the authorizer sound? What does the reader need from PieceAdded events to use it, and is that available with the current discover.js?
3. Budget and cooldown numbers for a 64x64 board that should feel alive but not be wiped by one person: what would you set, given ~$0.011 per piece from the research and that this is calibration test money?
4. Fold and test shape: what adversarial cases must the tests cover (out of range, replay from another data set, duplicate piece ids, snapshot forgery, a removed piece)?
5. What single mechanic makes this fun rather than a slow r/place? One idea, with the piece and fold changes it needs.
6. Anything in the proposal that is wrong given the code as it is today.

Ranked, terse, grounded in file paths.

## Review: Codex

**Ranked Review**

1. **Snapshot authorship is not sound in today’s code.**
   The proposed metadata gate does not exist in [ArcadeAuthorizer.sol](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/contracts/authorizer/src/ArcadeAuthorizer.sol:104). It decodes `operationData` only far enough to count pieces, then enforces cooldown/budget; it never reads metadata or distinguishes `type=snapshot` from `type=pixel` ([lines 124-139](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/contracts/authorizer/src/ArcadeAuthorizer.sol:124)). Also, current listing in [transport-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/transport-byow.js:345) returns bodies annotated with `src`/`pieceId`, not the PieceAdded metadata. To trust snapshots from events, the reader needs the event’s `{ds, pieceId, cid, tags}` and must verify the body it fetched corresponds to that exact `pieceId/cid` and `tags.type === 'snapshot'`.

2. **Sponsored-only is the right v1. BYOW pixel writes are not sound for last-writer-wins.**
   Paint needs one total order. AGENTS says BYOW only trusts `pieceId` inside one data set, and chat intentionally avoids cross-data-set fold ordering: [games/chat/fold.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/chat/fold.js:11). Advisory BYOW pieces can work only if the arcade later “adopts” them into the paint data set; the adopted piece id becomes canonical. “Paint once” is sound cross-data-set, but it is a worse game and still needs deterministic conflict resolution for simultaneous first claims. I would keep all canonical paint in one sponsored paint data set.

3. **Do not reuse `mountRoom`’s writer policy unchanged.**
   [room-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/room-byow.js:35) sends wallet users to their own data set first, and only non-wallet guests to sponsored writes ([lines 154-159](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/room-byow.js:154)). Paint’s proposal says wallet players also write as sponsored guests, so paint needs a shell option or its own mount that always uses `transport.appendSponsored()` and `transport.sponsored.log`.

4. **Discovery by `board=main` is slightly wrong as stated.**
   Current discover tags are exactly `{ app, game, type }`, max three keys: [discover.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/discover.js:22). “Boards are rooms (the game tag)” means `game=main`, not `board=main` unless you replace an existing tag. Put `board` in the signed body; use metadata `game=main`, `type=pixel|snapshot`.

5. **Budget: 5000/day is too high for calibration unless this is event-scoped.**
   At ~$0.011/piece, 5000/day is ~$55/day. For a public-ish calibration demo, I’d start with `cooldownEpochs: 4`, `budgetPerWindow: 500-1000`, `windowEpochs: 2880`, `maxPiecesPerOp: 1`. For a scheduled 1-2 hour event, use `cooldownEpochs: 2`, budget `1000-2000`, then pause/retune. The existing arcade policy is 200/day ([site/arcade.json](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/site/arcade.json:6)); paint should use a separate data set and policy.

6. **Fold/test shape must treat removals as disputes, not normal winners.**
   [transport-byow.js](/Users/sgtpooki/code/work/filoz/sgtpooki/foc-collab/games/lib/transport-byow.js:366) annotates removed pieces with `removed: true`. Paint tests should prove removed pieces do not silently keep winning, or that the UI exposes a dispute state. Also test: wrong `v/app/log`, wrong `src`, out-of-range `x/y/c`, non-integer coords, unknown board, duplicate same `pieceId`, lower id arriving after higher id, replay from another data set, invalid/missing `token/ref`, snapshot body without event tag, snapshot tag by non-payer once metadata gating exists, snapshot `upto` beyond available pieces, and RLE malformed/oversized.

7. **Single mechanic: teams with protected “anchor” pixels.**
   Add `{ type: 'pixel', team, x, y, c, token }` and `{ type: 'anchor', team, x, y, token }`. Fold: normal pixels are LWW, but an anchor claims one cell for `N` paint pieces or `M` epochs; only same-team pixels can overwrite while protected. Each token can have one active anchor. This creates tactics without auctions, hidden state, or cross-log ordering: spend a rare action to defend a small emblem, not just repaint endlessly.

**Direct Answers**

1. Sponsored-only is right for canonical paint. BYOW can submit proposals, but only arcade adoption makes them canonical.
2. Snapshot metadata gating is conceptually sound, but not implemented. Reader needs PieceAdded `ds`, `pieceId`, `cid`, metadata tags, and knowledge that this data set uses the gating authorizer. Current `discover.js` exposes tags, but `transport.list()` does not carry them into fold inputs.
3. Start 500-1000 pieces/day, cooldown 4 epochs. Use 2 epochs and 1000-2000 pieces only for short announced events.
4. Tests listed above; especially wrong-log replay, duplicate ids, removals, and forged snapshots.
5. Team anchors.
6. Biggest wrong assumptions today: current authorizer cannot gate snapshots by metadata, current room shell writes wallet users outside sponsored DS, and current discovery metadata has only `app/game/type`, not a separate board tag.
