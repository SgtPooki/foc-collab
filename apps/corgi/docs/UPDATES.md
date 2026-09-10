# Shipping updates without breaking players

Status: planning. Nothing here is built yet except where marked.

## The problem

The page is content-addressed. Every publish is a new root CID and a new
`inbrowser.link/ipfs/<cid>` URL. Old URLs keep working forever (or for as
long as the corgi's own data set pays for them), and every old copy keeps
reading the same chain. So an update never breaks the chain state, but it
can break three things:

- Links. A bookmark or a shared screenshot points at last week's page. The
  visitor sees an older park, older rules, and never learns there is a newer
  one.
- Rules. The fold is deterministic, but two versions of the fold can
  disagree: the life thresholds already moved once (sick at 30 days of
  runway became 37) and adoption thresholds differ per network. A player
  on the old page sees "fine" while the new page says "sick".
- Identity. A park corgi is derived from its owner's address by
  `traits.js`. If that mapping changes, every adopted corgi changes coat
  overnight. Owners would rightly call that a rug.

The local cache is the fourth, smaller thing: inbrowser.link serves every
CID from one origin, so localStorage is shared across versions. The cache
key carries a schema tag (`corgi:log:v2:`) and must be bumped whenever the
cached shape changes.

## Principles

1. Chain state is the only source of truth; a page is a lens. Any version
   must be able to fold from the genesis block, so `fromBlock` never moves
   forward past the first deposit and event shapes never change.
2. Traits are a contract with the owner. `traitsOf(address)` for an
   address that has already adopted must return the same corgi in every
   later version. New traits may only be added in ways that leave existing
   outputs unchanged (new bytes, new rare pulls that were previously
   impossible), or they must be versioned by adoption epoch so early
   adopters keep their look. Add a fixture test that pins the traits of
   the real early adopters.
3. Rule changes are announced in the page, not silent. The fold config
   gets a `rulesVersion`; the page shows it in the footer and in the share
   line.
4. Old pages point forward. A visitor on an old CID should learn, from the
   page itself, that a newer one exists.

## The FOC-native "latest" pointer

The corgi's own data set is its release channel. Every publish adds a piece
to data sets 32988 and 32987 under the corgi's key, so the newest piece in
the data set is the newest page. The page can read its own data set
(`FilecoinWarmStorageService.dataSetInfo` and the PDPVerifier piece list,
both public views) and compare the newest piece with the one it was served
from. If they differ it shows a signpost: "a newer park opened, follow the
corgi". Piece CIDs are CommP, not the UnixFS root CID, so the mapping needs
either the CAR root recorded in piece metadata (filecoin-pin stores the
root in the data set's metadata, verify in filecoin-pin source before
relying on it) or a tiny manifest piece that lists `{ rootCid,
rulesVersion, publishedEpoch }` and is the last thing added per release.

This keeps the pointer in the same place the funding is: no DNS, no IPNS
key to lose, and it disappears with the corgi, which is honest.

A DNSLink name (for example `corgi.<domain>`) is the human-friendly layer on
top, and it is the URL to print on stickers. It is optional; the data set
pointer is the durable one.

## Gamifying updates

- A release is a season. The park gets a visible season sign, a new prop,
  or a new accessory in the trait pool. Old pages still work; they are
  just last season's park.
- Moving day. When a new version lands, the old page's mascot walks to the
  gate and sits by a signpost that links to the new CID. The move is
  diegetic: the corgi found a bigger park.
- Founders. Corgis adopted before a given epoch get a small badge (a
  bandana with the season number) that later seasons cannot mint. This is
  the incentive to adopt early and the reason the trait contract matters.
- Memorial permanence. Generations that died under old rules keep their
  recorded cause and dates; a rules change never rewrites the wall.

## Work items

- [x] `rulesVersion` in `DEFAULT_CONFIG`, shown in the footer and share line.
- [x] Fixture test pinning `traitsOf` for the addresses that have adopted so far (`traits.test.js`).
- [ ] Publish a manifest piece per release and read it back from the data set; show the "newer park" signpost when the served root is stale.
- [ ] Bump the localStorage schema tag on any cache shape change (checklist item in the publish skill).
- [ ] Decide on a DNSLink name.
- [ ] Season one: pick the first season prop and founders' badge rule before the next publish, since that publish creates the first "old" page.
