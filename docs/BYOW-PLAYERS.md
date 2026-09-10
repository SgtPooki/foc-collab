# Play tic-tac-toe with your own wallet

Play here (stable URL, keeps your session key and identity across releases):
https://sgtpooki.github.io/foc-collab/tic-tac-toe/

Also published to Filecoin Onchain Cloud on 2026-09-10 (each publish is a new
origin, so wallet setup repeats there):
https://bafybeifna5ufep6zocoogxhkgtmpk557vl7mja74yuqr67pkmf72frg45y.ipfs.inbrowser.link/
(root CID `bafybeifna5ufep6zocoogxhkgtmpk557vl7mja74yuqr67pkmf72frg45y`, also at
`https://<cid>.ipfs.dweb.link/`). Note that filecoin-pin 2.0.1 fails on
directory adds ("pieceSizes must contain only positive byte sizes");
publish with `npx filecoin-pin@1.3.1 add dist/byow`.

The published page has no backend and no key of anyone's in it. You bring
a Filecoin calibration wallet; your moves are pieces in a data set that
your wallet pays for; your opponent's moves are in theirs; both pages
read both data sets straight from Filecoin Onchain Cloud and agree on the
board. Every piece takes about a minute to settle, so this is chess by
mail, not an arcade.

## What you need

A browser wallet (MetaMask or any EIP-1193 wallet) with a calibration
account holding a little tFIL for gas and at least 5 USDFC. Faucets:
https://faucet.calibnet.chainsafe-fil.io/ (tFIL) and
https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc (USDFC).
No repo, no scripts, nothing to paste.

## First visit (about 3 minutes, three or four wallet prompts)

Press "connect wallet to play". The page switches your wallet to
calibration if needed, then:

1. deposits 5 USDFC into Filecoin Pay and approves the storage service
   (one permit signature plus one transaction; skipped if already done)
2. authorizes a fresh session key it minted in the page, AddPieces only,
   7 days (one transaction)
3. creates your game data set, or reuses the one this app made before
   (one or two typed-data signatures; the storage provider submits the
   transaction)

Every step is shown as it runs and every failure names its step. When it
says ready the page reloads with "BYOW: your data set #N" at the top.
From then on your wallet is not involved: the session key signs your
moves, and it cannot move funds, create data sets, or delete anything.
When it expires, the page asks you to reconnect.

## Playing

1. Create a game and send the invite link to your opponent, or open a
   link someone sent you and press "join as O".
2. The creator's page finds the joiner's data set by scanning the chain's
   PieceAdded events from the block in the invite. The creator's first
   move seats the joiner. From then on it is turns: each move lands in
   the mover's own data set and shows up on the other side within a
   minute or two.
3. If the chain scan is unavailable (an RPC outage, or an invite without
   a start block), the joiner's page shows "copy link for X"; send that
   link back to the creator.

Anyone with the invite link can watch the game with no wallet at all.

## Scripted alternative

`node scripts/byow-setup-player.mjs` does the same provisioning from a
private key in `.env` and prints the descriptor; the scripted proofs seed
it into localStorage under `ttt:byow:me`.

## What to look at

The line under the board says which data sets the board was folded from
and who writes where. The lobby lists games created in the last day or so
(scanned from chain events); older games stay reachable by link forever.
