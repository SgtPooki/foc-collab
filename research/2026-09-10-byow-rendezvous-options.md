# BYOW rendezvous without a publisher key

2026-09-10. Follow-up to `2026-09-10-byow-proof-plan.md`. The settlement
and ordering proofs stand. The weak link is rendezvous: after O joins from
their own data set, X's client has to learn O's data set id, and a lobby
needs to list open games. The proof used a publisher-owned rendezvous
data set with the publisher's AddPieces-only session key embedded in the
page. That means the game provider brings a wallet and exposes a key,
which is the mode 1 blast radius again, just for discovery.

Scope of the problem is smaller than it looks. The fold already handles
post-ratification discovery: X's first move names O's data set, so a
late reader with only the invite reconstructs everything. Rendezvous is
only (a) the window between O's join and X's first move and (b) the
open-games list.

This note ranks every alternative found by me, Codex, Cursor, and Gemini,
records what was verified live today, and picks a path.

## Verified today

- **PieceAdded is a keyless index.** FWSS emits
  `PieceAdded(dataSetId indexed, pieceId indexed, pieceCid, keys, values)`
  with the piece's metadata. On the public glif calibration RPC an
  `eth_getLogs` for all PieceAdded over 2,000 blocks returned 1,207 logs
  in 0.8 s and over 10,000 blocks 3,968 logs in 4.2 s. On mainnet glif:
  2,000 blocks in 1.8 s, 10,000 blocks (7,714 logs) in 13.5 s, 20,000
  blocks rejected. Keys and values are not indexed topics, so filtering
  by game id is client-side.
- **Metadata limits** (FWSS source): 3 keys per piece, 32-byte keys,
  96-byte values, 10 keys per data set. `app=foc-ttt`, `game=<id>`,
  `root=<ds>` fit.
- **Metadata is event-only.** Piece metadata is no longer kept in
  contract state, only emitted. That is fine for this use: discovery
  reads the event, never a stored value. It does mean discovery depends
  on log scanning and the RPC's log retention window, not on a contract
  read.
- **Live round trip.** Wallet B's AddPieces session key uploaded a piece
  to data set 35170 with `pieceMetadata: { app: 'foc-ttt', game }`. It
  was submitted in 3.5 s, confirmed in 61 s, and a bounded scan of
  PieceAdded from the pre-upload block found it by value: data set
  35170, piece 17, block 4057919. No lobby, no publisher key, no third
  data set.
- **Authorizer surface** (filecoin-services, calibnet v1.4.0). A payer
  attaches `IDataSetAuthorizer` to one data set with
  `setDataSetAuthorizer`. FWSS then delegates the whole write decision:
  `isAuthorized(dataSetId, payer, operation, digest, signature,
  operationData)`. It is state-mutating, recovers the signer itself on
  any curve (payload sizing anticipates WebAuthn/P-256), and receives
  the operation payload including piece metadata. `ExampleSponsoredDataSet`
  (#540, merged then reverted for release hygiene) shows a contract as
  the payer of a data set. Neither synapse-sdk nor filecoin-pin has an
  authorizer write path yet; the SP passes `extraData` through.

## Options, ranked

Ranking weighs blast radius, buildable today, UX (create, share link,
join, see open games, no copying), and cost per game.

| # | Option | Publisher wallet or page key | Buildable today | UX | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | **A. Chain events as the index.** Join and create uploads carry `pieceMetadata {app, game, root}`; the invite carries the create block; clients scan PieceAdded from there in 2,000-block chunks and filter by value. Open games: same scan over a recent window for `type=create`. | none | yes, proved live | good: link only, no copying | **demo path** |
| 2 | **F. Gossip** (js-libp2p gossipsub, Waku, or Nostr) for announces, FOC as durable fallback. | none | pattern, not built | best when relays hold | latency layer, ladder step 4 |
| 3 | **B. Authorizer-gated lobby data set.** A publisher or, better, a contract payer owns one lobby data set whose authorizer accepts announce pieces signed by the player's P-256 game identity, rate-limited and size-capped by contract. | contract or publisher pays; no key anywhere | no: SDK custom-signer path and P-256 recovery gas unproven | best FOC-native lobby | **production path** |
| 4 | **C. Creator-hosted join slot.** X attaches an authorizer to X's own root data set that accepts exactly one `join` per game from any signer; O's data set id is in the signed join. X pays for one small piece. | none (X pays one piece) | no: same SDK gap as B | good; per-game blast radius | production variant of B for pairwise games |
| 5 | **E. Link-back.** O's page adds `&o=<ds>` to the invite and O sends it back. | none | built and tested | one manual copy per game, no lobby | fallback, keep |
| 6 | **G. FEVM announce contract.** `announce(game, ds)` from the player's wallet; anyone reads. | none | trivial contract; wallet tx UX is the gap | fine | clean but every announce costs a wallet tx and is not FOC storage |
| 7 | **H. External indexer** (Goldsky PDP subgraph, foc-observer SQL) queried by metadata. | none | partly | best lobby | cache in front of A, never a substitute for verification |
| 8 | **I. Per-game data set.** Players create a data set per game with metadata and find each other via DataSetCreated. | none | yes | worse than A, more moving parts and lockup per game | drop |
| 9 | **D. X's session key in the invite.** X sponsors O's join into X's set. | X's account-wide key in the link | yes | fine | worse than the publisher lobby: same blast radius, moved to the player |
| 10 | Current: publisher rendezvous data set with embedded session key. | publisher wallet and key | proved | good | replace with A now, B later |

Additional ideas surfaced by the reviewers, kept for the record:

- URL auto-handoff: O's page rewrites its own URL with `&o=` so the
  share sheet carries it. Costs nothing; makes E one click. Do it.
- Per-player inbox data set gated by the player's own authorizer:
  joins go to X's inbox, games stay BYOW. Same as C with a stable inbox
  instead of the root.
- SessionKeyRegistry as a signal (grant to a game-derived address):
  chain-native but no payload and grants are payer-scoped. Drop.
- IPNS or ENS name for "current lobby": a pointer to whichever layer is
  chosen, not a layer itself.
- CREATE2-style counterfactual data set ids: not possible, ids are
  chain-assigned.
- Profile data set per player listing active games: works but every
  player needs a stable public descriptor first.
- Deterministic beacon piece plus IPNI (Gemini): O uploads a piece whose
  body, and therefore CID, X can compute from the game id alone; X asks
  IPNI or a FilBeam edge for providers of that CID. Unverified whether
  PDP pieces are announced to IPNI at all, and a provider record names
  the SP, not the data set, so a second lookup is still needed. Worth
  one afternoon to check; not a plan.

## Why A is enough for tic-tac-toe

Metadata tags are hints. The fold never trusts them: every candidate
data set is listed keylessly, every piece is signature-verified, and the
v2 rules decide seats and moves. A spammer tagging junk with someone's
game id costs the reader one wasted listing. Write gating on-chain (B, C)
only matters when the announce itself must be scarce or paid, which is a
ranked-play concern, not a demo concern.

## Limits of A and how to bound them

- Public RPC caps are provider-set. Lotus defaults are 2,880 epochs per
  filter and 10,000 results; Filecoin docs guarantee only about 2,000
  recent blocks on hosted endpoints. Measured today: glif calibration
  fine at 10,000, glif mainnet fine at 10,000 and rejected at 20,000.
- Put the create block in the invite (`&from=<block>`), scan in
  2,000-block chunks from there, halve the chunk on error, checkpoint
  the last scanned block per game in localStorage, and only rescan new
  blocks on each poll.
- Use the indexed `dataSetId` topic whenever the target set is known
  (following a known player); the unbounded scan is only for the
  pre-ratification join and the open-games window.
- The open-games lobby covers the recent window only. Older games are
  reachable by link (root data set id) forever, because the game state
  is stored, not the tag.
- If the RPC prunes logs older than its window, an old invite still
  works: the create block is in the link, but the join discovery falls
  back to E. That is the honest cost of event-only metadata.

## Authorizer sketch for B and C

```solidity
contract TttAuthorizer is IDataSetAuthorizer {
  address immutable fwss;
  mapping(uint256 ds => mapping(bytes32 signer => uint64 lastBlock)) last;
  mapping(uint256 ds => mapping(bytes32 game => bool)) joinTaken; // C only

  function isAuthorized(uint256 ds, address, bytes32 op, bytes32 digest,
      bytes calldata sig, bytes calldata opData) external returns (bool) {
    require(msg.sender == fwss);
    if (op != ADD_PIECES_TYPEHASH) return false;
    (string[][] memory keys, string[][] memory vals) = decodePieceMetadata(opData);
    if (keys.length != 1 || encodedSize(opData) > 2048) return false;
    bytes32 signer = recoverP256(digest, sig);            // gas unproven on FEVM
    if (signer == 0) return false;
    if (block.number < last[ds][signer] + COOLDOWN) return false;
    bytes32 game = keccak256(bytes(valueOf(keys[0], vals[0], "game")));
    if (isJoinSlot(ds)) { if (joinTaken[ds][game]) return false; joinTaken[ds][game] = true; }
    last[ds][signer] = uint64(block.number);
    return true;
  }
}
```

Client path: the browser signs the piece with its P-256 identity, puts
the same game id in `pieceMetadata`, and places the P-256 signature in
`extraData` instead of a secp256k1 session signature. The SP submits
AddPieces and passes `extraData` through; FWSS calls the authorizer. What
does not exist yet: an SDK hook to supply a custom signature below
`ctx.upload`, and a measured gas cost for P-256 recovery on FEVM. Start
with secp256k1 in the authorizer to prove the write path, then add P-256.

## Recommendation

Demo next week, no publisher wallet, no key in the page:

1. Add `pieceMetadata { app, game, root, type }` to create and join
   uploads in `transport-byow.js` (metadata is plumbed through the
   session-key signature already; proved live above).
2. Put the create block in the invite. Add a chunked, checkpointed
   PieceAdded scanner to the transport that turns matching tags into
   `addDataSet()` calls; open-games list from the same scan over the
   recent window.
3. Keep link-back as the fallback and auto-append `&o=` to O's URL on
   join. Remove `rendezvous` from the page config.

Production, when the SDK grows an authorizer write path: a contract-paid
lobby data set (B) for announces, A as the independent recovery path,
gossip (F) for sub-second discovery. First steps: deploy the authorizer
on calibration with secp256k1, hand-roll one write through `extraData`,
measure P-256 recovery gas, then swap the signer.

## Reviewer notes

Codex and Cursor independently ranked A first for the demo and B for
production, and both flagged the same RPC facts (Lotus 2,880-epoch and
10,000-result defaults, hosted endpoints guaranteeing about 2,000 recent
blocks) and the same strategic split: a hint layer (events, gossip,
indexer) is enough while the fold is the trust boundary; a write layer
(authorizer lobby or join slot) is for when announces must be scarce.

Gemini ranked C (creator-hosted join slot) first for production because
it keeps every byte BYOW with the creator paying one piece, A second,
and recommended an external indexer (H) for the demo on the grounds that
scanning logs for an open-games lobby is too slow over public RPC. The
measurements above disagree for demo scale: a few hours of calibration
history scans in under five seconds, and the lobby only needs the recent
window. H stays a cache, not a dependency. Gemini also raised an SP-side
cost for C worth keeping: two joiners racing for one slot means one
AddPieces transaction reverts on-chain and the SP eats that gas unless
it simulates first. And it confirmed that counterfactual data set ids
are not available: ids are assigned by the contract.
