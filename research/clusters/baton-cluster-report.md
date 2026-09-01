# Baton cluster feasibility report

2026-09-01. Feature-feasibility analysis for the agent-workflow cluster on
Filecoin Onchain Cloud: (1) Baton v0 + HITL review relay, (2) compliance
evidence packets, (3) bounty board / agent task market, (4) OSS merge-train
relay. Grounded in source; all citations verified this session.

Source roots:

- `filozone/filecoin-services/service_contracts` — FWSS (`src/FilecoinWarmStorageService.sol`),
  `src/lib/SignatureVerificationLib.sol`, `src/interfaces/IDataSetAuthorizer.sol`,
  `lib/fws-payments/src/FilecoinPayV1.sol`, `lib/pdp/src/PDPVerifier.sol`
- `filozone/synapse-sdk/packages` — `synapse-sdk`, `synapse-core`

## Answers to the critical questions

### 1. What an authorizer receives for AddPieces — better than the peer review implied

`piecesAdded` (FilecoinWarmStorageService.sol:782-874) decodes extraData as
`(uint256 nonce, string[][] metadataKeys, string[][] metadataValues, bytes signature)`
(line 796-797) and calls `verifyAddPiecesSignature` (line 819) →
`SignatureVerificationLib.verifyAddPiecesAuthorization`
(SignatureVerificationLib.sol:213-244). When a data set has an authorizer
attached (`setDataSetAuthorizer`, FWSS.sol:1540-1544), the authorizer receives:

- `operationData = abi.encode(clientDataSetId, nonce, pieceDataArray, allKeys, allValues)`
  (SignatureVerificationLib.sol:242) — i.e. **all piece CIDs and all metadata
  keys/values**, not just opaque bytes;
- the EIP-712 digest and the raw signature, which it recovers itself on
  whatever curve it supports (IDataSetAuthorizer.sol:14-21);
- `isAuthorized` is **state-mutating** (not view) so it may consume nonces or
  rate-limit while deciding (IDataSetAuthorizer.sol:8-10), under a gas cap
  (`AUTHORIZER_GAS_LIMIT = 150_000_000`, SignatureVerificationLib.sol:301) and
  a transient-storage re-entrancy latch (SignatureVerificationLib.sol:306-318).

It never sees piece bodies — peer-review correction 1 stands: protocol-critical
fields (relay id, piece type, leg, prev-piece commitment, body hash, deadline)
must be duplicated into piece metadata.

**Metadata limits** (FWSS.sol:226-229, mirrored in
synapse-core/src/utils/metadata.ts:18-21):

| constant | value |
|---|---|
| `MAX_KEY_LENGTH` | 32 |
| `MAX_VALUE_LENGTH` | 96 |
| `MAX_KEYS_PER_PIECE` | 3 |
| `MAX_KEYS_PER_DATASET` | 10 |

So a piece carries at most 3 × (32+96) = **384 bytes** of metadata, ~288 bytes
of values. The asked-for 200-500 bytes of protocol fields fits only with tight
packing: one key with a 96-char base64 value holds ~72 raw bytes; three keys
hold ~216 raw bytes. A 32-byte body hash + 32-byte prev-piece digest +
leg/type/deadline (~16 bytes) ≈ 80 raw bytes = feasible across two keys, but
there is no room for a full uncompressed CIDv1 or relay UUID; prev-CID must
degrade to a digest. Note `withCDN` already burns a dataset-level key by
convention (FWSS.sol:631, 1348).

Metadata is signed — it is inside `ADD_PIECES_TYPEHASH`
(`AddPieces(clientDataSetId,nonce,Cid[] pieceData,PieceMetadata[] pieceMetadata)`,
SignatureVerificationLib.sol:29-33, hashing at 89-141) — and emitted in
`PieceAdded(dataSetId indexed, pieceId indexed, pieceCid, keys, values)`
(FWSS.sol:114-116, emit at 834/872). So protocol fields in metadata are both
contract-enforceable and event-indexable. There is no explicit byte cap on
addPieces extraData (only `len > 0`, FWSS.sol:793-794), unlike createDataSet
(5 KiB, FWSS.sol:53); the practical bound is per-key/value limits plus gas.

Replay protection: per-payer nonces (`clientNonces`, FWSS.sol:800-802).

### 2. "Pay B when C accepts" via Filecoin Pay — yes, without a custom escrow vault

Three verified building blocks in fws-payments/src/FilecoinPayV1.sol:

1. **Anyone the payer approves can operate rails.** `setOperatorApproval(token,
   operator, approved, rateAllowance, lockupAllowance, maxLockupPeriod)`
   (line 340) is payer-called; the approved operator then calls
   `createRail(token, from, to, validator, commissionRateBps, serviceFeeRecipient)`
   (line 816-857) where operator = `msg.sender` (line 824). So **a Baton
   contract can be the operator** of a rail from task-creator to worker and
   can name **itself as validator** (line 820, stored at 844).
2. **Operator-triggered release.** `modifyRailPayment(railId, newRate,
   oneTimePayment)` is `onlyRailOperator` (line 980-984) and pays the
   one-time amount immediately out of the rail's fixed lockup (doc at 976-977;
   deduction at 1024-1029; transfer via `processOneTimePayment`, 1058,
   1122-1141). The operator sets the fixed lockup via `modifyRailLockup`
   (line 867). One-time payments go through even if the payer account is
   otherwise underfunded, provided lockup covers them (doc comment, line 973).
3. **Streaming arbitration.** The `IValidator` interface —
   `validatePayment(railId, proposedAmount, fromEpoch, toEpoch, rate)` →
   `{modifiedAmount, settleUpto, note}` and `railTerminated(...)`
   (FilecoinPayV1.sol:22-43) — lets a validator reduce or delay settlement.
   FWSS itself implements it (FWSS.sol:78, 1557-1606, 1675), prorating payment
   by proven epochs — the exact PATTERN for "pay only for accepted work" on a
   streaming rail. Escape hatch: after termination + max settlement epoch the
   payee can settle without validation (`settleTerminatedRailWithoutValidation`
   doc, FilecoinPayV1.sol:1144) — a griefing bound on a buggy/hostile validator.

**Composition** for acceptance-triggered bounties: creator approves BatonEscrow
as operator with a lockup allowance; BatonEscrow creates a rail per leg with
`lockupFixed = bounty`; because BatonEscrow is also the data set's
IDataSetAuthorizer it observes the successor's claim inside `isAuthorized`
(state-mutating, sees metadata) and calls `modifyRailPayment(railId, 0, bounty)`.
Commission bps + `serviceFeeRecipient` (line 831-835, 847-848) give the
protocol-fee skim for free.

This revises peer-review correction 6: **funds custody stays inside
FilecoinPay** (payer account lockup) — no separate escrow vault holding tokens.
What remains true from the correction: `isAuthorized` is not a payment path,
and the escrow guarantee is only as strong as the `lockupFixed` already placed
on the rail (the payer can decline to fund further legs). Self-dealing
(correction 4) and claim MEV (correction 5) are unchanged — protocol-design
problems, not plumbing.

### 3. Event push for agent wakeups

Two events fire in the same transaction on every accepted add:

- `PDPVerifier.PiecesAdded(uint256 indexed setId, uint256[] pieceIds, Cids.Cid[] pieceCids)`
  (lib/pdp/src/PDPVerifier.sol:65)
- `FWSS.PieceAdded(uint256 indexed dataSetId, uint256 indexed pieceId, Cids.Cid pieceCid, string[] keys, string[] values)`
  (FWSS.sol:114-116)

The FWSS event is the right subscription target: it carries metadata, so an
agent filtering on `dataSetId` and decoding the `baton` metadata key gets push
wakeups with leg/type inline — no piece fetch needed to decide relevance.

SDK gap: synapse-sdk has **no general event-subscription API**. viem's
`watchContractEvent` is used only inside the session-key login flow
(synapse-core/src/session-key/secp256k1.ts), and `onPiecesAdded`
(synapse-sdk/src/types.ts:462, storage/manager.ts:277,439) is an
upload-lifecycle callback for your own upload, not a log watcher. Agents must
drop to raw viem plus a websocket Filecoin RPC. Works today; hurts the
"add one MCP server and join" story.

### 4. Private relays / encryption

Zero encryption support anywhere in the stack: no encryption code in
synapse-sdk/synapse-core (outside node_modules) and nothing in
service_contracts. Purely app-level: encrypt piece bodies client-side;
metadata must stay plaintext because the authorizer and indexers read it.
Cross-org key distribution is entirely out of scope of the current stack.

### Bonus finding: session keys are typehash-scoped but payments-blind

Session-key signatures are accepted per operation typehash via
`sessionKeyRegistry.authorizationExpiry(payer, signer, operation)`
(SignatureVerificationLib.sol:346-350) — an AddPieces-only key is native.
But FilecoinPay's `setOperatorApproval` and deposits are `msg.sender`-based
(FilecoinPayV1.sol:340); SessionKeyRegistry only gates FWSS operation
typehashes. Peer-review correction 3 confirmed: **every economic act needs the
owner wallet online.**

## Per-idea assessment

Directions: A = richer product (DAG relays, parallel legs, private relays,
reputation); B = economy (escrow, streaming per-leg pay, fees, bonds);
C = enterprise (multi-tenant, compliance/retention, SLAs, ERC-8004 identity).

### Idea 1 — Baton v0 + HITL review relay

- **A — SHIPPED/PATTERN.** SHIPPED: signed-piece log, per-piece signed
  metadata for protocol fields (384 B budget), deterministic ordering,
  timeline page (foc-collab stack verbatim). PATTERN: DAG/parallel legs are
  pure fold work; contract-side DAG claim exclusivity is buildable because
  `isAuthorized` is stateful and sees metadata. GAP: metadata budget is tight
  for DAG edges (multiple prev-CIDs do not fit — need digest-only
  commitments); no SDK event subscription for push wakeups.
- **B — PATTERN with one GAP.** HITL micro-payment on human approval = the
  operator/one-time-payment composition above; the human's acceptance
  signature is what `isAuthorized` checks before release. Owner-acceptance
  also neutralizes self-dealing for HITL specifically (a human signs; Sybil
  successors do not help). GAP: session keys cannot approve operators or fund
  (see bonus finding), so plug-and-play MCP agents cannot participate
  economically without their owner wallet.
- **C — PATTERN/GAP.** PATTERN: multi-tenant log with authorizer-enforced
  per-tenant ACL keyed on a `tenant` metadata key. GAP: no per-piece read
  privacy; `SchedulePieceRemovals` remains the payer's delete button (custody
  caveat must stay in messaging — see idea 2 for the mitigation); ERC-8004 is
  a separate integration, nothing in this stack references it.

### Idea 2 — Compliance evidence packets

- **A — SHIPPED/PATTERN.** SHIPPED: `PieceAdded` events + signed metadata give
  an independently indexable receipt chain; PDP possession proofs cover the
  artifacts. PATTERN: as-of-epoch folds (peer-review correction 2) are pure
  client code; `verify` CLI is app work.
- **B — none needed.** The low-economics idea; storage billing already works.
- **C — the direction that matters, and it is mostly PATTERN, not GAP.**
  Strong finding: **retention-locked custody needs no protocol change.** The
  authorizer is consulted on SchedulePieceRemovals
  (`verifySchedulePieceRemovalsAuthorization`,
  SignatureVerificationLib.sol:247-278, operationData =
  `abi.encode(clientDataSetId, pieceIds)`) and on TerminateService
  (`verifyTerminateServiceAuthorization`, SignatureVerificationLib.sol:281-296)
  — so a retention authorizer can veto deletion and payer-side termination
  until epoch N, today. Residual GAPs: the payer can still stop paying
  (economic deletion via runway exhaustion) — true retention needs a
  payer-as-contract/endowment holding the USDFC, buildable as an app contract;
  and provider-initiated termination/faults are outside the authorizer's
  reach. This materially softens the "payer's delete button" narrative
  tension flagged in the peer review.

### Idea 3 — Bounty board / agent task market

- **A — PATTERN.** Open-task listing = fold over `baton-create` pieces;
  reputation = fold over reject/complete history keyed by signer address.
  GAP (policy, not tech): public reject pieces are a defamation-adjacent
  reputation record.
- **B — the core; mostly PATTERN via the escrow-operator composition.**
  Escrow = FilecoinPay lockup with Baton contract as rail operator/validator;
  acceptance-triggered release = `modifyRailPayment` one-time payment gated on
  an authorized claim; protocol fee = `commissionRateBps`. GAPs: worker
  **bonds** require the worker to lock funds, i.e. the worker's owner wallet
  must approve the Baton contract as operator on a worker→escrow rail —
  blocked for session-key-only agents; claim **MEV** (correction 5) has no
  stack mitigation — commit-reveal claims would live in the authorizer;
  **self-dealing** (correction 4) still needs owner-acceptance, quorum, or
  bonded registries at the protocol-design level.
- **C — GAP.** Per-leg SLAs are buildable with the streaming `IValidator`
  pattern, but dispute arbitration, identity/KYC (ERC-8004 integration), and
  cross-org billing are all greenfield.

### Idea 4 — OSS merge-train relay

- **A — SHIPPED/PATTERN.** Identical protocol shape to Baton v0; patches are
  small and fit as pieces; the GitHub-integration layer is pure app work.
- **B — same as idea 3**, but one-time-on-accept suffices; streaming per-leg
  pay is overkill.
- **C — weakest enterprise case.** Ride on cluster-wide multi-tenancy.
  Public-by-default is a fit for OSS — the privacy gap does not bite here.

## Top 5 missing features (ranked by cluster value)

1. **SDK event subscription surface.** A `watchPieces(dataSetId, filter)`
   helper over `FWSS.PieceAdded` with websocket transport and metadata
   decoding. The SDK already ships viem and the ABI; today only the
   session-key login flow watches events. Unblocks push wakeups for every
   idea; smallest ask, biggest UX gain.
2. **Session-key reach into payments.** Typehash-scoped session signers on
   FilecoinPay `setOperatorApproval`/deposit, or an SDK-blessed delegation
   pattern. Without it every economic feature (bounties, bonds, HITL
   micro-payments) requires the owner wallet online, killing plug-and-play
   MCP UX. This is the concrete form of v2-economics blocker (peer-review
   correction 3).
3. **Reference "escrow-operator" contract.** One small audited contract
   combining IDataSetAuthorizer + FilecoinPay rail operator + IValidator —
   the composition proven feasible in section 2. Every economy direction
   across all four ideas needs exactly this contract; build it once as
   cluster-shared infrastructure.
4. **Piece-metadata headroom.** Raise `MAX_KEYS_PER_PIECE` (3) or
   `MAX_VALUE_LENGTH` (96), or add a binary `bytes` metadata slot. 384 signed
   bytes forces lossy packing of protocol fields; DAG relays and compliance
   packets both strain it. Contract-versioning ask — flag early.
5. **App-level encryption recipe in the SDK.** Envelope-encrypt piece bodies
   with per-relay keys, plaintext metadata for the authorizer. Nothing exists
   today; private cross-org relays — the differentiated GTM claim — are
   impossible without at least a documented pattern.

## Corrections to the peer-review doc worth relaying

- Correction 1 (authorizer blindness) is narrower than stated: the authorizer
  receives full piece CIDs and metadata keys/values in operationData
  (SignatureVerificationLib.sol:242), and `isAuthorized` is stateful — only
  piece bodies are invisible.
- Correction 6 (escrow must be a separate funded contract) is half-wrong:
  escrowed release is expressible inside FilecoinPay via operator + fixed
  lockup + one-time payments; no separate token vault needed. The
  non-payment-path point about `isAuthorized` stands.
- New: retention-locked custody (compliance idea C) is buildable today with a
  removal/termination-vetoing authorizer — no protocol change.
