# Shared photo album on FOC: built ahead of FEE, Keysmith and ACLs (2026-09-28)

The idea: a photo album for an event or conference. Every contributor
brings their own wallet and pays for their own storage. Only members can
see the photos. The page runs with no server.

The goal of this doc is to build it now on what works, in the same shape
as three pieces of FilOz work that are in flight. As each one lands, the
album swaps it in without redesigning anything:

| Work | Where | State (2026-09-28) | What it gives the album |
|---|---|---|---|
| FEE (encryption envelope) | FIPs discussion #1253; synapse-sdk PR #967 (`@filoz/filecoin-encryption-envelope`, issues #968/#981/#982) | #967 is open, and covers only the wire format: no AEAD, range reads or key wrap yet. Profile "not yet frozen". Only the A256KW recipient is planned for v1; ECDH-ES+A256KW (`-31`) is deferred | The encrypted blob format |
| Retrieval ACL and encryption v1 (PRD) | Notion, "moved to implementation" 2026-09-16 | Rules for storing and sharing encrypted data. No read gating in v1: key possession is the access control | The product rules we follow |
| Keysmith | Notion, child of the PRD, still being edited | Design only. Wallet-rooted key tree per data set: folders, sealed writes, wallet-derived X25519, shares | The key layer we imitate now and adopt later |
| Programmable ACLs (data set Authorizers) | filecoin-services #563 (productizing #536) | Productization for FWSS. Gas and whitelist decisions are open. We already use Authorizers on calibration (the arcade, `contracts/authorizer`) | Write authorization |

## The split everyone agrees on

The PRD, Keysmith and the FEE spec all divide the job the same way:

- **Reads are keys.** Ciphertext is public and fetchable by CID from any
  provider, and a provider-side check cannot bind the provider itself.
  Retrieval gating is a deferred "courtesy layer". Holding the key is
  permission to read.
- **Writes are the data set Authorizer** (or today's session key), never
  key possession. In Keysmith's words: "Adding the piece is authorised
  by the data-set authorizer, never by holding a key."
- **Authorship and membership live outside FEE.** The FEE spec says
  successful decryption "proves possession of the CEK, and nothing
  more", and a recipient list "is not an authenticated access-control
  policy". This repo already has that layer: signed pieces (P-256
  identity plus `walletSig`) folded by a pure fold.

So the album is FEE for confidentiality, Keysmith-shaped keys, the
existing fold for who's a member and who wrote what, and Authorizers
(or session keys) for who may add pieces.

## What works today, with nothing unmerged

- **Pay your own way:** `wallet-byow.js` handles the deposit, one data
  set per wallet, and an AddPieces-only session key.
- **Find contributors:** `discover.js` (PieceAdded metadata tags).
- **Many writers, one view:** `room-byow.js` plus a pure fold (chat is
  the model).
- **Wallet-bound authorship:** `wallet-sig.js`.
- **Encryption:** Kuba's `foc-encryption` works in the browser
  (AES-256-GCM, chunked STREAM, A256KW recipients, `cborg` only). But
  it predates the FIP amendments #967 adopts (`typ`, protected
  `chunk_size` and IV, one final-chunk form, `plaintext_length`). Blobs
  written with it will not open with the production library. That is
  acceptable for calibration demo albums; we don't store real data
  under it.
- **Missing:** the transport writes only JSON and caps reads at 8 KiB.
  It needs a raw-blob append and a fetch by CID.

## Design (phase 0: buildable now)

**Everything readable is encrypted, including the log.** FEE
`app_metadata` is public, and so is every piece in this repo's logs
today. A plaintext `photo` piece would leak captions and names. The
album's fold pieces are therefore small FEE objects (scheme 1,
AES-GCM) under the album key. Signing happens inside the plaintext.
The pipeline becomes fetch → decrypt → verify → fold. Decrypt is async
and runs before the fold, the same way verification does now, so folds
stay pure.

**Album key (AK):** random 32 bytes, stored the way Keysmith stores a
root:

```
sig   = signTypedData(AlbumKey{ purpose: "foc-collab/album/v1", chainId, nonce })
KEK   = HKDF(r ‖ low-s, "foc-collab/album-kek/v1")
album piece (owner's data set) carries: nonce ‖ A256KW(KEK, AK)
```

The owner recovers AK from their wallet alone (PRD AC4). A bad or
randomizing signer fails loudly at unwrap. Keysmith §3 is the same,
except the wrapped root sits in data set metadata. Ours sits in a piece,
because the owner's data set already exists and metadata is
write-once.

**Photos:** each photo is a FEE chunked blob in the uploader's own data
set, with a fresh CEK and an A256KW recipient under AK. The encrypted
`photo` log piece carries the blob CID, an inline thumbnail (a second
FEE object, or bytes inside the log piece; the log cap rises to about
64 KiB for this app), and the caption. The photo is re-encoded through
a canvas first, which strips EXIF and GPS.

**Getting AK to people:**
- *Link share:* the link names the album (root data set + album id).
  The access key travels on a second channel, as generated words, per
  the PRD rule that secrets never go in URLs. At an event: the link as a
  QR code on screen, the words in the event chat.
- *Wallet-to-wallet:* the member derives an X25519 key from their
  wallet (Keysmith's `EncryptionKey{}` message) and posts a `join`
  piece carrying `ENCpub`. The owner posts a `grant` piece containing
  AK wrapped to it (ECDH-ES+A256KW, app-side with WebCrypto X25519 +
  HKDF + AES-KW). This is the one piece of crypto we write ourselves
  until FEE `-31` lands.

**Membership in the fold:** a photo counts if it decrypts under AK and,
in grant mode, if its signing wallet holds a grant. Anything else is
dropped.

**Discovery tag:** `HMAC(AK, "album")`, so outsiders can't list an
album's contributors by tag. They can still see that the same tag
appears across data sets.

## What gets easier as each piece lands

| When | Swap | New capability |
|---|---|---|
| FEE AEAD ships (after #967) | `games/lib/seal.js` switches from Kuba's library to `@filoz/filecoin-encryption-envelope`. The album calls only `seal` and `open`, so the swap is a one-file change | Range reads for full-size photos. Demo albums from phase 0 need re-uploading |
| FEE `-31` (ECDH-ES+A256KW) | Grant wrapping and sealed writes use the library recipient instead of our WebCrypto code | **Drop-box mode:** contributors seal each CEK to the album's public key and can't browse the album. The event gets a write-only QR code, and the owner shares out what they curate |
| Keysmith | AK becomes `ds.folder("albums").folder(id)` under a data set created with its root in metadata. The invite carries `writeTarget()`. Grants become `wrapFor(ENCpub)` / `openGrant`. Sealed paths replace the plaintext caption | Recovery from the wallet with no app records. Folder-per-album sharing. Standard, interoperable keys: another FOC app could open the album |
| Programmable ACLs (#563) | Contributor data sets use a P-256 / passkey Authorizer instead of the 2-day SKR session key. `identity.js` already holds a non-extractable P-256 key in the browser | No session-key expiry or re-onboarding. An optional **sponsored album** (the conference pays): an Authorizer on one album data set admitting granted wallets, which is the arcade pattern (`ArcadeAuthorizer`) with a members policy |

## Findings worth taking back to the FEE and Keysmith authors

The album is the first multi-writer, multi-data-set consumer of these
designs. It raises five points they don't cover yet:

1. **Keysmith is rooted in one data set, but BYOW writers are spread
   across many.** Album pieces live in each contributor's data set but
   seal to a folder in the owner's tree. Keysmith's recovery walk
   ("enumerate the data set's pieces") never sees them, so discovery
   has to be an app concern. That's allowed by the design, but
   cross-data-set sealed writes should be a named case.
2. **Revocation by "moving the folder" assumes the owner holds every
   piece.** In an album, other people's data sets hold the photos, and
   the owner cannot re-encrypt or delete them. Removing a member means
   re-uploading copies into the owner's own data set at the owner's
   cost, or asking contributors to. The docs should say so.
3. **Recording grants versus "delivered, not recorded".** Posting
   `grant` pieces (AK wrapped to a member's key) is the practical
   channel for a serverless app. It is wrapped key material on FOC,
   the same question as Keysmith §13.1 and PRD AC12.
4. **Secrets never in URLs** is right, but costly for events, where
   one QR code is the whole UX. Worth an explicit product call.
5. **Public `app_metadata`** means app logs (and not just blobs) have
   to be encrypted. Keysmith's sealed path covers names; an app's
   index or log needs the same treatment.

## Costs

The per-piece add fee dominates, at about $0.002 per the proposed
mainnet sheet. Phase 0 writes two to three pieces per photo (blob,
thumbnail, log piece), roughly $0.40 to $0.60 per 100 photos. Batching one
log piece per upload session helps. Storage is negligible. The open
question is whether, on mainnet with CDN egress, each view bills the
uploader's rail.

## Status

Steps 1 to 3 are built (transport, `games/lib/seal.js`,
`games/lib/album-key.js`, each with tests). The seam ended up as
`seal`/`open` over a kek rather than mirroring #967's function names: the
album only needs those two calls, and the swap still happens in one
file. Progress, decisions and the open questions for the FEE, Keysmith
and ACL authors are tracked in `games/album/README.md`, including the
"hosted album" mode, where contributors write into the owner's data set
through an Authorizer.

## Build order

1. `transport-byow.js`: `appendBlob(bytes, onProgress, tags)` → PieceCID, and
   `fetchBlob(ds, cid, maxBytes)` with its own cap (the fold-piece cap stays).
2. `games/lib/seal.js`: the seam described above, backed by vendored
   `foc-encryption` (`seal` / `open`).
3. `games/lib/album-key.js`: the AlbumKey typed-data signature, KEK,
   wrapping and unwrapping AK, the double-sign determinism check, and
   X25519 grants. A test for each.
4. `games/album/fold.js` + tests: `album`, `photo`, `remove`, `join`,
   `grant`.
5. `games/album/index.html` on `mountRoom`, with a file input and the
   canvas re-encode.
6. An e2e run: two wallets, one album, a stranger who can't read it.
