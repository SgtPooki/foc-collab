# Peer review of the jukebox design, 2026-09-11

Cursor reviewed the proposed design. Raw response, unedited, after the prompt.

## Prompt


# Design review: the FOC jukebox

Read: CLAUDE.md, apps/corgi/fold.js and apps/corgi/chain.js (a Filecoin Pay payer account folded from DepositRecorded events: deposits are "feeding"), games/paint/app.js and games/paint/fold.js (the sponsored single-data-set pattern shipped an hour ago), games/lib/transport-byow.js (appendSponsored, guestStatus), contracts/authorizer/src/ArcadeAuthorizer.sol, site/arcade.json, docs/IDEAS.md (jukebox), issues #8 (admission, the wallet link piece) via `gh issue view 8`.

## Russell's framing (the owner, verbatim)

"for the jukebox, I am thinking that we just have people 'insert a coin' and then get to choose a song (youtube music.. internet radio.. other thing that we can embed in the site.. so folks have a legit radio station site / jukebox thing with NO backend..). bars have digital jukeboxes that take credit card payments.. this could be a static site that does the same thing for ANYONE, ANYWHERE.. especially with some credit card tap -> crypto functionality of some sort (that will eventually exist)"

## Proposed design (critique it)

1. The coin is a Filecoin Pay deposit. The jukebox has a payer account (the arcade wallet, or its own). "Insert a coin" = FilecoinPay.deposit(USDFC, to: jukeboxPayer, amount >= price) from the listener's wallet, exactly the corgi's feed path (apps/corgi/chain.js feed). Credits = floor(sum of a wallet's deposits / price). The deposit also funds the jukebox's own storage, so the machine pays for itself.
2. Picking a song is a piece in the jukebox's sponsored data set: { v: 2, app: 'foc-jukebox', log, type: 'play', track: { kind: 'youtube', id } | { kind: 'url', url }, title, wallet, walletSig, token }. walletSig is an EIP-191 signature by the wallet over (jukebox, ref-free canonical body without walletSig), recovered in the browser before the fold (async, like signature verification in identity.js), and the fold pairs plays to credits per wallet in piece-id order: a play with no credit left is ignored. One data set gives total order for free (the paint pattern), so the queue is unambiguous.
3. Playback with no clock: each listener's page plays the queue in piece-id order starting from the newest track when they arrive (a radio, not a playlist), advancing when the embedded player ends. Optional later: `skip` pieces, three skips advance everyone.
4. Free play mode: with no wallet, a guest may still enqueue through the authorizer's cooldown and budget (like chat), flagged as "house pick"; paid picks jump ahead of house picks in the fold's queue order (paid first by piece id, then house picks by piece id).
5. Embeds: YouTube iframe API (works from a static page), plain <audio> for direct URLs and internet radio streams. No media stored on FOC in v1 (the authorizer now caps pieces at 32 KiB anyway).
6. Later: credit card tap to crypto is somebody else's on-ramp; the jukebox only needs the deposit to land in the payer account, from any source.

## Questions

1. Is a Filecoin Pay deposit the right coin? Alternatives: a one-time payment rail, an ERC-20 transfer to the arcade wallet, the corgi's own account. What does the corgi's fold already give us (apps/corgi/fold.js: deposits by address, epoch, amount) and what is missing for credits.
2. Is the wallet signature in the play piece sound? The guest key that writes the piece is not the wallet; the fold needs proof the wallet chose the song. Is EIP-191 over the canonical body enough, and what replay risks exist (same signed play re-appended: the fold sees two plays with one signature; must the fold dedupe by signature or by ref?).
3. Radio semantics with no shared clock: is "start from the newest track on arrival" acceptable, or is there a deterministic now-playing (for example, derived from the block number of the last play piece plus track durations from the embed API) that keeps listeners in sync well enough?
4. What makes it a jukebox and not a list: the one mechanic that makes people insert a second coin.
5. Costs and abuse: a paid pick is one deposit tx (gas plus USDFC) plus one piece the arcade pays for; house picks cost the arcade a piece each. Numbers that make sense on calibration (test money) and what changes on mainnet.
6. Anything wrong given the code as it is today.

Ranked, terse, grounded in file paths.

## Review: Cursor

# FOC jukebox — design review

Ranked findings, grounded in the repo as it exists today.

---

## Overall verdict

The substrate fits: **one sponsored data set** (paint pattern) + **Filecoin Pay deposits** (corgi pattern) + **wallet-bound intent** (new, but small). The weak spots are **listener sync** (radio semantics vs. paid-queue promise), **house-pick sybil** (#8), and **signature replay** (must be explicit in the fold). Ship as a **station with a visible queue**, not a bar jukebox that guarantees “your song next,” until you solve now-playing.

---

## Ranked issues

### 1. Radio semantics break the paid-queue promise (design flaw)

Proposed: each listener starts at the **newest** track on arrival and advances on embed `ended`.

That is honest **internet radio** copy, not jukebox copy. A payer who inserts a coin expects **position in a shared queue** (`fold` output), not “I only hear what landed after I opened the tab.”

- `games/paint/fold.js` — single total order by `pieceId`; everyone sees the same queue.
- `games/chat/fold.js:11-15` — cross-DS order is explicitly *not* fold input; jukebox must **not** use the chat multi-DS model.
- Deterministic now-playing without a shared clock needs **durations in the log** or trusted metadata + `epochClock` (`apps/corgi/chain.js:184-189`). YouTube lengths are not in the piece; ads and failures break sync.

**Recommendation:** v1 UI shows the full ordered queue and highlights “now playing” as **queue head among not-yet-heard locally**. Call it a station. Defer block+duration sync to v2, or add a `skip` piece type with fold-level semantics later.

---

### 2. House picks are sybilable today (#8) — blocks public free mode

`ArcadeAuthorizer` bounds **global** budget and **per-signer** cooldown (`contracts/authorizer/src/ArcadeAuthorizer.sol:134-145`). A fresh secp256k1 guest key is a fresh cooldown slot (`games/lib/transport-byow.js:413-427`).

Issue #8 states this plainly: one person with a key generator can burn the whole window. Paint’s 1000/day budget (`site/arcade.json:22`) is fine for pixels; a jukebox house lane at scale is not.

**Recommendation:** Paid lane can ship without #8. **Free/house lane needs** a `link` piece (#8’s cheapest option) or a **separate, tiny** house budget with owner-tuned pause — and honest copy that house picks are best-effort.

---

### 3. `walletSig` is necessary but incomplete without dedupe + domain rules

Guest `token`/`sig` (`games/lib/identity.js`) proves who **wrote** the piece, not who **paid**. Wallet proof is the right split.

Gaps vs. `identity.js` conventions:

| Concern | Required |
|--------|----------|
| Unsigned fields | Strip `walletSig`, `sig`, `ref`, `src`, `pieceId`, `removed` before verify (mirror `identity.js:41-46`) |
| Canonical body | Reuse `canon()` or document EIP-191 preimage; must include `v`, `app`, `log`, `type`, `track`, `wallet` |
| Replay | Same `walletSig` on two pieces with different `pieceId` must **not** consume two credits — **dedupe by `walletSig` (or `nonce` in signed body), first `pieceId` wins** |
| Binding | Include jukebox room / `log` in signed payload so signatures don’t port across rooms |

EIP-191 `personal_sign` over canonical JSON is enough for v1. No contract change.

**Do not** pair credits by `ref` alone; `pieceRef` is content-addressed (`identity.js:49-52`) and unrelated to wallet intent.

---

### 4. Filecoin Pay deposit is the right “coin” — reuse corgi, add a credit fold

**Yes.** Alternatives are worse given what’s already proven:

| Rail | Verdict |
|------|---------|
| **FilecoinPay.deposit → payer** | ✅ `DepositRecorded` gives `from` + `amount` (`apps/corgi/chain.js:25-27`, `feed()` at `:285-310`). Funds the jukebox data-set payer (self-storage). Same path as corgi feeding. |
| ERC-20 transfer to arcade wallet | ❌ Does not extend runway; no attributed deposit log in the corgi fold. |
| One-time payment rail | ❌ Not in repo; more moving parts. |
| Share corgi’s payer only | ⚠️ Works economically (arcade wallet `site/arcade.json:3` already is the corgi), but **queue pieces should live in a dedicated data set** (paint board model), not DS 35446 chat. |

**What `apps/corgi/fold.js` already gives:** per-deposit `{ from, amount, epoch }`, `totalFed`, `distinctFeeders`, withdrawal awareness (`events()` at `:100-107`).

**What’s missing for jukebox:**

```text
credits(wallet) = floor(sum(deposits[from=wallet].amount) / price)
```

Then walk the play queue in fold order; each verified paid play decrements that wallet’s balance; zero → ignore (`paint` ignores unusable pixels the same way).

**Withdrawals:** `from = payer` only (`chain.js:28-30`). Listener deposits are not clawed back via credit math, but owner withdrawal can starve storage — same as corgi death. UI should show payer runway (optional corgi fold on jukebox payer).

**UX:** Mirror corgi — deposit confirms, **then** sign + `appendSponsored` (`apps/corgi/app.js` feed flow). Plays before `DepositRecorded` indexes should show pending/ignored until refresh.

---

### 5. Paint pattern is the right write path; chat/room shell is the wrong one

| Pattern | Use for jukebox? |
|---------|------------------|
| `games/paint/app.js` + one DS | ✅ `appendSponsored`, `guestStatus`, `verifyAll`, single `list()` |
| `games/lib/room-byow.js` + multi-DS | ❌ Chat’s cross-author interleave is display-only (`games/chat/fold.js:84-101`) |

Proposed fold ordering — **paid plays by `pieceId`, then house plays by `pieceId`** — is implementable as a pure sort before credit consumption. That is the priority lane.

Piece shape (~200 bytes) is well under `maxHeight: 10` → 32 KiB (`ArcadeAuthorizer.sol:40`, `site/arcade.json:11`).

---

### 6. What makes it a jukebox vs. a playlist (the second-coin mechanic)

A playlist is free enqueue. A jukebox needs **scarce skips**:

1. **Credits don’t expire** (`floor` remainder) — topping up is rational after one play.
2. **Paid lane jumps house lane** — visible premium (already in design).
3. **Queue position UI** — “you’re #4” drives the next deposit; without it, coin feels like a tip.
4. **Optional v2:** `type: 'bump'` piece burning 2 credits to move to front — not needed for v1 if priority sort exists.

If radio semantics stand, **none of this fires** — payers never hear their song. Fix sync/queue UX before tuning price.

---

### 7. Costs and abuse (calibration numbers)

From `research/2026-09-01-expansion-synthesis.md:15` and paint review: **~$0.011 per sponsored piece** (arcade pays).

| Action | Who pays | Calibration sketch |
|--------|----------|-------------------|
| Paid pick | Listener: gas + USDFC deposit + implicit storage share | `price = 1 USDFC` (test money); deposit tx ~same as corgi feed |
| House pick | Arcade: ~$0.011/piece + budget slot | Separate DS; start `budgetPerWindow: 50–100`, `cooldownEpochs: 4` (~2 min/guest/key); not paint’s 1000/day |
| Spam ignored plays | Arcade still pays piece fee if authorizer accepts | Fold ignores; authorizer still burns budget — cap `track` validation in fold, keep pieces small |

**Mainnet delta:** real USDFC, higher gas, **must** ship admission (#8) before a public house lane. Paid lane is naturally rate-limited by deposit cost.

**Abuse surfaces:**

- Guest key farm → house budget (#8).
- `walletSig` replay → fold dedupe (above).
- Junk YouTube IDs → fold validation only; arcade still pays — prefer allowlist or max title length like `games/chat/fold.js:26-27`.
- Deposit griefing (dust to payer) → harmless; increases runway.

---

### 8. Gaps in the codebase today (nothing blocking a prototype)

| Gap | Path / note |
|-----|-------------|
| No jukebox fold/app | Copy `games/paint/` shape |
| No per-wallet credit fold | New `games/jukebox/fold.js`; don’t overload `apps/corgi/fold.js` |
| No EIP-191 verify in `games/lib/` | Add `wallet-sig.js` (viem `verifyMessage`); keep async-before-fold like `identity.js` |
| `chain.js` lives under `apps/corgi/` | Extract shared `readDeposits`/`feed` or import from a shared module — don’t fork log-scan logic |
| No jukebox entry in `site/arcade.json` | New DS via `sponsor-setup.mjs` (paint `boards.paint` pattern) |
| Incremental sync | `transport-byow.js:324` comment — fine for early jukebox; snapshot pieces later (`docs/IDEAS.md:75-77`) |
| YouTube on GitHub Pages | iframe API works static; autoplay/tab-background is UX polish, not architecture |

---

## Direct answers to your six questions

1. **Deposit as coin?** Yes. Corgi gives attributed deposits and runway; add `floor(sum/price)` per wallet. Dedicated jukebox DS + arcade payer (or sub-payer) is cleaner than sharing chat DS 35446.

2. **`walletSig` sound?** Yes with `canon()`/EIP-191, `log`/`app` domain separation, and **mandatory dedupe by signature (or nonce)** so one signature ≠ two plays. Guest `token` stays for writer identity only.

3. **Radio without clock?** Acceptable only if marketed as **station**, not “your song plays next.” For bar-jukebox fidelity you need queue-head sync or block+duration math (v2).

4. **Second coin?** Credit remainder + paid-over-house priority + visible queue position. Without heard-queue feedback, economics don’t close the loop.

5. **Costs?** ~$0.011/piece arcade-side; listener pays deposit tx. Calibration: 1 USDFC/pick, 50–100 house plays/day on a **separate** DS. Mainnet: real money + #8 before public free tier.

6. **Wrong given today’s code?** Architecture matches paint + corgi; nothing fundamental is missing on-chain. The risks are **product semantics** (radio vs. queue), **#8 for house mode**, and **walletSig replay** — all fold/UI, not FOC primitives.

---

## Suggested v1 scope (smallest honest ship)

1. New sponsored DS in `site/arcade.json`.
2. `fold.js`: deposits → credits; plays → queue (paid then house); `walletSig` verify + dedupe.
3. Page: corgi-style **insert coin** → sign play → `appendSponsored`; show **full queue + local now-playing at head**.
4. **No house lane** until `link` (#8) or invite-only budget.
5. YouTube + `<audio url>` embeds only; no media on FOC.

That is a legitimate static-site coin-op radio with cryptographic queue integrity and no backend — Russell’s vision — without over-promising bar-jukebox sync.
