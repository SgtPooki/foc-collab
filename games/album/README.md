# Shared album (in progress)

A photo album for an event: every contributor brings their own wallet and
pays for their own storage, and only members can see the photos. Built
ahead of FilOz's encryption and access-control work, in its shape, so
each piece swaps in when it lands. Background and sources:
`research/2026-09-28-shared-photo-album.md`.

## Built so far

| Module | What | Replaced by, when it lands |
|---|---|---|
| `games/lib/seal.js` | FEE envelopes: `seal(bytes, kek)` / `open(blob, kek)`, a fresh CEK per object, A256KW recipient. Backed by `vendor/foc-encryption` (Kuba's reference implementation) | `@filoz/filecoin-encryption-envelope` (synapse-sdk #967 and its AEAD follow-ups). Swap inside `seal.js` only |
| `games/lib/album-key.js` | Album key (AK) unlocked by the owner's wallet (typed-data signature → KEK → A256KW, Keysmith-style); wallet-derived X25519 member keys; grants (AK wrapped to a member, bound to the album id); HMAC discovery tag; access-key text for link shares | Keysmith: AK becomes a folder key, grants become `wrapFor` / `openGrant`, and FEE's `-31` recipient replaces our ECDH wrap |
| `games/lib/transport-byow.js` | `appendBlob` (raw bytes to your own data set, returns the PieceCID), `fetchBlob`, configurable `maxPieceBytes` for sealed log pieces | Programmable ACLs (filecoin-services #563): a P-256 / passkey Authorizer instead of the 2-day session key |

Next: `games/album/fold.js` (album, photo, remove, join, grant) with
tests, the page on `mountRoom`, and an e2e run where a stranger fails to
read.

## Decisions

- **The log is encrypted too.** FEE `app_metadata` is public, and so is
  every JSON piece. An album piece is
  `{ v: 2, app: 'foc-album', box: <base64url FEE blob> }`, with the real
  signed piece inside. Order: fetch → open → verify → fold.
- **Readers can be added at any time.** Photos carry a CEK wrapped under
  AK, not a list of viewers, so a new member needs only AK. Photos
  uploaded before they joined open too.
- **Secrets never go in URLs** (per the PRD). Link shares send the access
  key on a second channel.
- **Known limit: a link share hands out the album key itself.** The
  access key is AK as base64url, so anyone holding it can read every photo
  and post to the album, and the only way to cut them off is a new AK for
  future photos. Keysmith recommends a generated secret shown as words,
  and a narrower capability than the album root. Fine for phase 0 demo
  albums; revisit before real events.
- **Scheme 1 only** (whole-object AES-GCM). The browser buffers a photo
  anyway; range reads come with the production library.
- **Calibration demo data only** until the production FEE library ships.
  Blobs sealed with the vendored library won't open with it.

## Open questions for the FEE / Keysmith / ACL authors

1. **Writers across many data sets.** Keysmith roots keys in one data
   set, but album photos live in each contributor's own data set, sealed
   to a key in the owner's tree. Keysmith's recovery walk ("enumerate
   the data set's pieces") never sees them, so discovery has to be the
   app's job (here: PieceAdded tags). Cross-data-set sealed writes should
   be a named case.
2. **Revocation assumes the owner holds the pieces.** "Move the folder
   and re-encrypt" doesn't work when other people's data sets hold the
   photos: the owner can neither re-encrypt nor delete them. Removing a
   member protects future photos only, unless the owner re-uploads copies
   at their own cost.
3. **Grants as pieces.** A `grant` piece (AK wrapped to a member's
   X25519 key) is the practical delivery channel without a server. It is
   wrapped key material on FOC: the question in Keysmith §13.1 and PRD
   AC12.
4. **No secrets in URLs versus event UX.** A single QR code is the whole
   onboarding at an event. The two-channel rule costs that.
5. **Public `app_metadata`.** An app's own log or index has to be
   encrypted, not just its blobs. Keysmith's sealed paths cover file
   names only.

### The other mode: contributors write into the owner's data set

With a data set Authorizer (the arcade does this on calibration today;
#563 productizes it), the owner can admit specific keys to add pieces to
their data set, and only to that one. That answers 1 and 2: every photo
sits in one data set, Keysmith recovery sees all of it, the owner can
re-encrypt and delete, and piece id is a total order. The cost is the
premise: the data set's payer pays for all the storage. Contributors
could chip in through a Filecoin Pay deposit (the jukebox pattern), but
they would no longer each pay for their own. Worth offering as a
"hosted album" mode next to BYOW.
