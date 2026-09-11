# Play with your own wallet

The games live at https://sgtpooki.github.io/foc-collab/ (tic-tac-toe and
connect four; the corgi on the same site is a different thing, see the
end). That origin is stable across releases, so your session key and
identity survive updates.

The game pages have no backend and no key of anyone's in them. You bring a
Filecoin calibration wallet; your moves are pieces in a data set that your
wallet pays for; your opponent's moves are in theirs; both pages read both
data sets straight from Filecoin Onchain Cloud and agree on the board.
Every piece takes about a minute to settle, so a game against a person is
chess by mail, not an arcade.

## What you need

A browser wallet (MetaMask or any EIP-1193 wallet) with a calibration
account holding a little tFIL for gas and at least 5 USDFC. Faucets:
https://faucet.calibnet.chainsafe-fil.io/ (tFIL) and
https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc (USDFC).
No repo, no scripts, nothing to paste.

## First visit (about 3 minutes, a handful of wallet prompts)

Press the "connect wallet to play" button. The page asks your wallet for
an account and switches it to calibration if needed (one or two prompts),
then:

1. deposits 5 USDFC into Filecoin Pay and approves the storage service
   (one permit signature plus one transaction; skipped when the account
   already holds at least 2.5 USDFC of available funds and the approval
   is in place)
2. authorizes a session key minted in the page, AddPieces only, 7 days
   (one transaction; skipped if this browser already holds one the chain
   still honors with more than an hour left)
3. finds the data set this site made for your wallet before, or creates
   one (one typed-data signature; the storage provider submits the
   transaction)

Every step is shown as it runs and every failure names its step. The page
saves its progress once the session key is authorized and again once the
data set is found, and the deposit is visible on chain, so a failure or a
closed tab resumes where it stopped instead of paying again. When it says ready the page
reloads with "BYOW: your data set #N" at the top. From then on your wallet
is not involved: the session key signs your moves, and it cannot move
funds, create data sets, or delete anything. When it expires, the page
asks you to reconnect.

One data set serves every game on the site. Your seat in a game belongs to
that data set, so opening the same game from another browser with the same
wallet (after connecting there) shows you as the same player.

## Playing a person

1. Create a game and send the invite link to your opponent, or open a
   link someone sent you and press "join as O" (Yellow in connect four).
2. Right after you create a game the page says "game created, you are X
   once it settles on-chain" with a countdown; the board unlocks when the
   create piece is on chain.
3. The creator's page finds the joiner's data set by scanning the chain's
   PieceAdded events from the block in the invite. The creator's first
   move seats the joiner. From then on it is turns: each move lands in
   the mover's own data set and shows up on the other side within a
   minute or two.
4. If the chain scan is unavailable (an RPC outage, or an invite without
   a start block), the joiner's page shows "copy link for X"; send that
   link back to the creator.

Press the bell to get a notification on your turn whenever the game
window is not the one in front. Anyone with the invite link can watch a
game with no wallet at all.

## Playing the computer

"Play the computer" in the lobby starts a solo game. The computer is a
second signing identity in your browser; it plays O and writes its moves
into your data set through your session key, so a solo game needs no
second wallet and costs only its own pieces. Expect about a minute per
computer reply. Tic-tac-toe's computer never loses; connect four's can be
beaten.

## If the page forgets you

The session key and identities live in this browser's IndexedDB for the
site's origin. Browser settings that clear site data on exit, private
windows, and Brave's ephemeral storage for a site all wipe them, and the
page then shows "connect wallet to play" again. Reconnecting finds your
data set again (no new data set, no genesis upload); the session key
lives only in the browser, so a wiped browser authorizes a new one (one
transaction). Your seats survive either way, because they belong to the
data set. In the browser console, `await indexedDB.databases()` should
list `ttt-byow` and `ttt-identity`.

## Scripted alternative

`node scripts/byow-setup-player.mjs [days]` does the same provisioning
from a private key in `.env` (session key valid 2 days by default, where
the page uses 7) and prints the descriptor; the scripted proofs seed it
into localStorage under `ttt:byow:me`.

## What to look at

The line under the board says which data sets the board was folded from
and who writes where. The lobby lists games created in the last 4000
blocks, about 33 hours (scanned from chain events); older games stay
reachable by link forever.

## The corgi

The corgi page uses your wallet differently: feeding is a USDFC deposit
straight into the corgi's Filecoin Pay account (an ERC-20 approval plus
one deposit transaction), with no data set and no session key. A deposit
at or above the page's adoption threshold puts a corgi with your address's
traits in the park.
