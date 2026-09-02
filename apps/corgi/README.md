# FOC Corgi

A community pet whose health is the real funding runway of its own Filecoin
Onchain Cloud storage. Feeding it is a USDFC deposit anyone can make and
verify on-chain. If the community stops paying, it declines, dies, and after
the protocol's lockup tail its storage terminates.

The page is static and self-contained. It reads the chain, folds the result
into a corgi, and renders. No server, no indexer, no CDN at runtime.

## How it works

- The corgi is a Filecoin Pay payer account with its own wallet. Its data
  sets (which store this very page) are paid by streaming rails from that
  account, so the account's runway is the corgi's life.
- Life comes from `FilecoinPayV1.accounts(token, payer)` projected to the
  current block exactly as `synapse-core` does in `resolveAccountState`.
  Thresholds: thriving above 90 days, fine 30 to 90, sick under 30, critical
  under 14, dead under 7. Death is declared while funds remain so the
  memorial page is guaranteed to exist through the 30-day lockup tail.
- Mood counts distinct addresses in `DepositRecorded` events addressed to
  the payer in the last 7 days. One large deposit buys life, not happiness.
- Feeding calls `FilecoinPayV1.deposit(token, to = payer, amount)` from the
  feeder's wallet. Plain `deposit`, not `depositWithPermit`, so the event
  carries the feeder as `from`.
- A deposit at or above the adoption threshold spawns a park corgi owned by
  the sender, drawn from the sender's address bytes.
- Generations are a fold over deposits and withdrawals: runway history is
  reconstructed backwards under a constant spend rate, every crossing under
  the death line is a death, and a deposit that lifts it back over is a
  revival that starts the next generation. Rate changes (adding or removing
  data sets) are not modelled; a dedicated wallet with a fixed set of data
  sets keeps the reconstruction exact.

Files: `fold.js` (pure state), `chain.js` (reads and the two wallet
transactions), `sprite.js` (address to corgi), `app.js` (render), `build.mjs`
(bundle), `e2e.mjs` (acceptance test), `scripts/feed.mjs` (CLI feeding).

## Create and fund a corgi (calibration)

1. Copy `../../.env.example` to `../../.env` and set `PRIVATE_KEY` to a fresh
   throwaway key. That wallet is the corgi. Never reuse a wallet with other
   data sets on it, or their rails become part of the corgi's runway.
2. Get calibration tFIL and USDFC for that address. The forest-explorer
   faucet has a claim endpoint documented in its repo; one claim per token
   is enough.
3. Deposit and approve with filecoin-pin under the corgi's key, then upload
   the page so the corgi has a data set to pay for:

   ```bash
   set -a; . config.env; . .env; set +a
   npx --yes filecoin-pin@latest payments setup --auto --deposit 3.5
   node apps/corgi/build.mjs dist/corgi apps/corgi/config.calibration.json
   npx --yes filecoin-pin@latest add dist/corgi
   ```

4. Put the payer address and a start block just before the first deposit in
   `config.calibration.json`. `fromBlock` bounds the first event scan; the
   page caches scanned events in localStorage after that.

`npx filecoin-pin payments status` prints the same runway the page shows.
`npx filecoin-pin payments fund --days N` sets runway to N days by
depositing or withdrawing, which is the lever for forcing death.

## Run

```bash
node apps/corgi/build.mjs dist/corgi apps/corgi/config.calibration.json
python3 -m http.server 4173 --directory dist/corgi
```

Without a config file the page reads `?payer=0x…&chain=calibration&fromBlock=N`
from the URL, which is handy for looking at any payer account.

## Test

```bash
npm test                       # pure fold, read path with a fake RPC, sprites
set -a; . config.env; . .env; set +a
npm run test:e2e:corgi         # browser feeds the live corgi with $FEEDER_KEY
E2E_DEATH_ARC=1 npm run test:e2e:corgi   # also drains, dies, revives
```

The acceptance test injects an EIP-1193 provider that signs with
`FEEDER_KEY` (a second throwaway wallet holding a little tFIL and USDFC).
`scripts/feed.mjs <config> <amount>` feeds from the command line with the
same code path.

## Publish

Follow the repo `publish` skill. Because `.env` holds the corgi's key, a
publish adds the page to the corgi's own data set:

```bash
set -a; . config.env; . .env; set +a
node apps/corgi/build.mjs dist/corgi apps/corgi/config.calibration.json
npx --yes filecoin-pin@latest add dist/corgi
```

The `add` output prints the root CID and an `inbrowser.link/ipfs/<cid>` URL.
