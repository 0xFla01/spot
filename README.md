# SPOT

Every inch of the page is for sale. Buy a spot with `$SPOT`, put a picture in
it, and anyone can take it off you for 1.5x — you keep 95% of that, the rest
burns.

## Running it

Two processes. The site, and the server that makes the wall the same for
everyone.

```bash
npm install

# 1. shared state (port 8787)
npm run server

# 2. the site (port 5173)
npm run dev
```

`.env` points the site at the server:

```
VITE_SPOT_API=http://localhost:8787
```

Delete that line and the site falls back to a local demo wall — useful for
design work, but every visitor sees something different.

## Before launch

Everything that changes at launch lives in `src/core/config.js`:

| What | Where |
|---|---|
| Mint address | `PROJECT.mint` |
| Token decimals | `PROJECT.decimals` (pump.fun is 6) |
| X / pump.fun links | `PROJECT.links` |
| Tier prices | `TIERS[*].price`, in whole tokens |
| Flip multiplier and split | `ECONOMY` |
| RPC endpoint | `CHAIN.rpc` — swap the public one for Helius |

Then start the server with the mint so it verifies every purchase:

```bash
SPOT_MINT=<mint address> SPOT_RPC=<your rpc> npm run server
```

Without `SPOT_MINT` the server refuses to start unless you pass
`SPOT_ALLOW_SIMULATION=1`, so an unverified server can never go live by
accident.

## How a purchase works

One transaction, signed once, containing every leg:

1. transfer to the previous owner (95%, skipped on a first claim)
2. `burn` — a real SPL burn, so total supply actually drops
3. a memo, `spot:<id>:<price>`, naming what was bought

All of it is paid by the buyer, so it is atomic: if any leg fails, none of it
happens. The server then fetches that signature from the chain and checks the
memo, the burn amount, the payout and the signer before it records the new
owner. A signature can only be used once.

Changing your picture or your name is signed with the wallet too, so nobody
can paint over a spot they do not own.

## Tier prices

Calibrated against a pump.fun launch: 1B supply, graduation around $39k.

| Tier | Tokens | % of supply | at $6k | at $39k | at $150k |
|---|---|---|---|---|---|
| Pin | 250,000 | 0.025% | 0.007 SOL | 0.05 SOL | 0.19 SOL |
| Parcel | 500,000 | 0.05% | 0.015 SOL | 0.10 SOL | 0.38 SOL |
| Plot | 1,250,000 | 0.125% | 0.037 SOL | 0.24 SOL | 0.94 SOL |
| Monument | 2,500,000 | 0.25% | 0.075 SOL | 0.49 SOL | 1.88 SOL |

A spot's price is a fixed number of tokens. It never moves with the market
cap — the only thing that raises it is somebody taking it, at 1.5x. The dollar
figure on the site is just that token amount valued at the live price.

## Layout

```
src/core/config.js    prices, splits, mint, links — the only file to edit
src/core/spots.js     the registry: every ownable inch, one entry each
src/core/spot-view.js builds the DOM, keeps every copy of a deed in sync
src/core/studio.js    the upload panel: crop, zoom, rotate
src/core/sync.js      shared state: hydrate, live updates, claims
src/chain/wallet.js   Phantom, balances, message signing
src/chain/pay.js      builds the purchase transaction
server/server.js      shared state, upload storage, chain verification
```

Only the Monument can run video or a GIF. Everything else is stills.

## Going live

Two lines in `src/core/config.js`:

```js
mint:    '7GCihgDB8...',        // your coin's address from pump.fun
siteUrl: 'https://yourdomain.com',
```

The website and the server both read that file, so that is the whole
configuration. Then:

```bash
npm run build     # produces dist/, serve it as static files
npm run server    # the shared-state server
```

`mint` is what lets the server check people paid in **your** coin rather than
some worthless token they minted themselves. With it unset the server refuses
to start unless you pass `SPOT_ALLOW_SIMULATION=1`.

`siteUrl` stops anyone else's website from using your server. localhost keeps
working either way, so local development is unaffected.

Optional, as environment variables:

| Variable | What it does |
|---|---|
| `SPOT_RPC` | A paid Solana endpoint. The public one is rate limited. |
| `SPOT_ADMIN_TOKEN` | Enables `POST /admin/clear` to blank one spot's picture. |
| `PORT` | Defaults to 8787. |

**Hosting: the disk matters.** Uploads live in `server/uploads/` and ownership
in `server/data/state.json`. Hosts with ephemeral filesystems (Vercel, Netlify,
Render's free tier) wipe both on every redeploy — every picture and every
ownership record, gone. Use a VPS with a real disk, or a host with a persistent
volume, or move uploads to object storage.

HTTPS is required: Phantom will not connect over plain HTTP.

## Checks

```bash
npm run check    # both of the below
```

- `npm run check:burn` decodes the purchase transaction and proves the burn is
  there for the exact amount, the previous owner is paid, and it is all one
  atomic transaction.
- `npm run check:server` feeds forged transactions to the verifier and proves
  each one is rejected.
- `node scripts/devnet-burn-test.mjs` does it for real on devnet: makes a
  throwaway token, buys a spot, and checks total supply actually dropped.

## Still to do

- **No moderation, by choice.** Anything uploaded is live for everyone
  immediately. `POST /admin/clear` with `x-admin-token` is the only lever, for
  the day something has to come down.
- `server/data/state.json` is a file, not a database. Fine for this size,
  worth moving to SQLite or Postgres if it gets busy.
- The Solana libraries are most of the JS bundle. Loading them only when
  someone connects would cut the first paint considerably.
