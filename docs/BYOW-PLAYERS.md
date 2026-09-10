# Play tic-tac-toe with your own wallet

Published 2026-09-10 (calibration):
https://bafybeic2oh2yeljyhmmve55zvyvdcvuw5tnghqpiw6omka23kbonwe7r2a.ipfs.inbrowser.link/
(root CID `bafybeic2oh2yeljyhmmve55zvyvdcvuw5tnghqpiw6omka23kbonwe7r2a`, also at
`https://<cid>.ipfs.dweb.link/`). Note that filecoin-pin 2.0.1 fails on
directory adds ("pieceSizes must contain only positive byte sizes");
publish with `npx filecoin-pin@1.3.1 add dist/byow`.

The published page has no backend and no key of anyone's in it. You bring
a Filecoin calibration wallet; your moves are pieces in a data set that
your wallet pays for; your opponent's moves are in theirs; both pages
read both data sets straight from Filecoin Onchain Cloud and agree on the
board. Every piece takes about a minute to settle, so this is chess by
mail, not an arcade.

## One-time setup (about 10 minutes)

You need node 22+, this repo, and a calibration wallet with some tFIL and
USDFC. Faucets: https://faucet.calibnet.chainsafe-fil.io/ (tFIL) and
https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc (USDFC).

```bash
git clone <this repo> && cd foc-collab && npm install
cp .env.example .env            # put your calibration PRIVATE_KEY in it (gitignored)
set -a; . ./config.env; . ./.env; set +a

# 1. deposit USDFC and approve the storage service (spends a little)
npx --yes filecoin-pin@latest payments setup --auto --deposit 10

# 2. create your game data set and an AddPieces-only session key (default 2 days)
node scripts/byow-setup-player.mjs 7 > my-player.json
```

`my-player.json` is `{ ds, wallet, sessionKey }`. The session key can only
append pieces to your own data sets until it expires. It cannot move
funds, create data sets, or delete anything. Keep the file private anyway;
whoever has it can spend your storage deposit on junk until expiry. Re-run
step 2 when it expires.

## Playing

1. Open the published page. It asks for your descriptor once; paste the
   JSON. It stays in that browser's localStorage.
2. Create a game and send the invite link to your opponent, or open a
   link someone sent you and press "join as O".
3. The creator's page finds the joiner's data set by scanning the chain's
   PieceAdded events from the block in the invite. The creator's first
   move seats the joiner. From then on it is turns: each move lands in
   the mover's own data set and shows up on the other side within a
   minute or two.
4. If the chain scan is unavailable (an RPC outage, or an invite without
   a start block), the joiner's page shows "copy link for X"; send that
   link back to the creator.

Anyone with the invite link can watch the game with no wallet at all.

## What to look at

The line under the board says which data sets the board was folded from
and who writes where. The lobby lists games created in the last day or so
(scanned from chain events); older games stay reachable by link forever.
