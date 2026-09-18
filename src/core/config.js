// ---------------------------------------------------------------------------
// SPOT — project configuration
// Everything negotiable lives here. Name, ticker, mint, economics, pricing.
// ---------------------------------------------------------------------------

export const PROJECT = {
  name: 'SPOT',
  ticker: '$SPOT',
  chain: 'SOLANA',
  tagline: 'Every inch is for sale.',
  est: '2026',

  // Set this after the pump.fun launch. Everything on-chain switches on
  // the moment it is a real mint address; until then the site runs in
  // simulation so the design can be worked on.
  mint: '8dxV55CeVA3L54VZegUrMKtdDvGDZ191ibdnFGDspump',

  // The mint was ground as a vanity address, so the contract is known before
  // the coin exists. This is shown in the footer and used for the pump.fun
  // link, and nothing else: it never arms a payment, a balance check or a
  // burn, because until the launch actually happens there is no token behind
  // it. At launch, copy this value into `mint` above and set SPOT_MINT to it
  // for the server, and the whole site goes live.
  announcedMint: '8dxV55CeVA3L54VZegUrMKtdDvGDZ191ibdnFGDspump',

  // How many decimals the mint uses. pump.fun tokens are 6.
  decimals: 6,

  // WHICH token program owns the mint. pump.fun issued this one under
  // Token-2022, not the classic SPL Token program. Every associated-token
  // address is derived FROM the program id, and every instruction is sent TO
  // it, so leaving this at the library default silently derives accounts that
  // do not exist and nothing settles. Classic SPL mints would use
  // TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA instead.
  // CHECK THIS AT EVERY LAUNCH. The first launch came out under Token-2022;
  // a classic SPL mint would be TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA.
  // Getting it wrong makes every purchase fail in a way that is hard to read.
  tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',

  // No treasury: the project takes no cut. Whatever is not paid to the
  // previous owner is burned. Set an address here only if that changes.
  treasury: null,

  // Where the site lives once it is public, e.g. 'https://spot.fun'.
  // The server uses it to refuse requests from anybody else's website.
  // localhost always works, so leave this alone while building.
  siteUrl: 'https://solspot.fun',

  links: {
    x: 'https://x.com/ownyourspotsol',
    pump: 'https://pump.fun',
  },
}

// --- Chain ------------------------------------------------------------------
export const CHAIN = {
  // The free public endpoint is rate limited and will refuse requests the
  // moment the site is busy. Get a free key from helius.dev or quicknode.com
  // and put it here, or set VITE_SPOT_RPC, before telling anyone the address.
  rpc: import.meta.env?.VITE_SPOT_RPC || 'https://api.mainnet-beta.solana.com',

  // Every pump.fun launch mints exactly this many tokens, with 6 decimals.
  supply: 1_000_000_000,

  // Where the bonding curve completes and the coin hits a real market.
  // Tier prices are calibrated so a slot costs the intended amount of SOL
  // at this point. Change this one number to retune everything.
  graduationMcapUsd: 39_000,

  // Reference only, for the SOL figures in comments and the tuning helper.
  solUsd: 200,

  // Only used for the approximate dollar figure shown beside each price,
  // until the token trades and Dexscreener has a real one. Set to a fresh
  // launch rather than a hopeful one, so the site never overstates a price.
  assumedLaunchMcapUsd: 6_000,

  get fallbackUsdPerToken() {
    return this.assumedLaunchMcapUsd / this.supply
  },
}

/** What a tier costs in dollars at a given market cap. Handy for tuning. */
export function priceAtMcap(tokens, mcapUsd) {
  return (tokens / CHAIN.supply) * mcapUsd
}

/** The same thing in SOL, which is how the tiers were actually set. */
export function solAtMcap(tokens, mcapUsd = CHAIN.graduationMcapUsd) {
  return priceAtMcap(tokens, mcapUsd) / CHAIN.solUsd
}

/** Inverse: how many tokens are worth `sol` at a given market cap. */
export function tokensForSol(sol, mcapUsd = CHAIN.graduationMcapUsd) {
  return Math.round((sol * CHAIN.solUsd * CHAIN.supply) / mcapUsd)
}

// --- Economics --------------------------------------------------------------
// First claim : buyer pays TIER.price, 100% of it is burned.
// Every flip  : buyer pays lastPrice * FLIP_MULTIPLIER, split below.
export const ECONOMY = {
  FLIP_MULTIPLIER: 1.5,

  // Resale split. Must total 1.
  // Nothing goes to the project: the previous owner is paid, the rest burns.
  split: {
    previousOwner: 0.95,
    burn: 0.05,
    treasury: 0,
  },

  // Primary sale split. Must total 1.
  primarySplit: {
    burn: 1.0,
    treasury: 0,
  },
}

// --- Tiers ------------------------------------------------------------------
// Deliberately cheap. The point is that a lot of people can afford to play,
// not that a few whales own everything. Prices are in whole tokens; the
// approximate dollar cost shown on the site is price * live token price.
export const TIERS = {
  MONUMENT: {
    id: 'MONUMENT',
    label: 'Monument',
    price: 2_500_000, // ~0.50 SOL at graduation. 0.25% of supply.
    media: ['image', 'video'],
    blurb: 'One exists. Square, above the fold, and the only one that moves.',
  },
  PLOT: {
    id: 'PLOT',
    label: 'Plot',
    price: 1_250_000, // ~0.25 SOL at graduation. 0.125% of supply.
    media: ['image'],
    blurb: 'Large format. Impossible to scroll past.',
  },
  PARCEL: {
    id: 'PARCEL',
    label: 'Parcel',
    price: 500_000, // ~0.10 SOL at graduation. 0.05% of supply.
    media: ['image'],
    blurb: 'The standard unit of ownership.',
  },
  PIN: {
    id: 'PIN',
    label: 'Pin',
    price: 250_000, // ~0.05 SOL at graduation. 0.025% of supply.
    media: ['image'],
    blurb: 'Pocket change. Everyone starts here.',
  },
}

// --- Media rules ------------------------------------------------------------
export const MEDIA = {
  maxImageBytes: 4 * 1024 * 1024,
  maxVideoBytes: 12 * 1024 * 1024,

  // It loops silently in a 420px square. Past half a minute nobody is still
  // watching, and every extra second is bandwidth paid for on every visit.
  maxVideoSeconds: 30,
  // still images anyone can use
  imageTypes: ['image/png', 'image/jpeg', 'image/webp'],
  // anything that moves is reserved for the one tier that allows it
  animatedTypes: ['image/gif', 'video/mp4', 'video/webm'],
  // what an upload is downscaled to before it is stored
  maxEdge: 1200,
}

/** Only a tier that lists 'video' may run anything animated. */
export function allowsAnimation(tierId) {
  return Boolean(TIERS[tierId]?.media.includes('video'))
}

export function acceptAttr(tierId) {
  const types = [...MEDIA.imageTypes]
  if (allowsAnimation(tierId)) types.push(...MEDIA.animatedTypes)
  return types.join(',')
}

// --- Derived helpers --------------------------------------------------------

export function nextPrice(spot) {
  const base = spot.lastPrice ?? TIERS[spot.tier].price
  return spot.owner ? Math.round(base * ECONOMY.FLIP_MULTIPLIER) : base
}

export function priceBreakdown(spot) {
  const total = nextPrice(spot)
  const split = spot.owner ? ECONOMY.split : ECONOMY.primarySplit
  const previousOwner = Math.round(total * (split.previousOwner ?? 0))
  const treasury = PROJECT.treasury ? Math.round(total * (split.treasury ?? 0)) : 0
  // whatever is not paid out is burned, so the numbers always add up exactly
  const burn = total - previousOwner - treasury
  return { total, previousOwner, burn, treasury, isPrimary: !spot.owner }
}

export function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K'
  return String(Math.round(n))
}

export function shortAddr(a) {
  if (!a) return '—'
  return a.slice(0, 4) + '..' + a.slice(-4)
}

// --- Live token price -------------------------------------------------------
let usdPerToken = CHAIN.fallbackUsdPerToken
const priceListeners = new Set()

export function getUsd(tokenAmount) {
  return tokenAmount * usdPerToken
}

export function fmtUsd(tokenAmount) {
  const v = getUsd(tokenAmount)
  if (v < 0.01) return '<$0.01'
  if (v < 1) return '$' + v.toFixed(2)
  if (v < 1000) return '$' + v.toFixed(v < 100 ? 2 : 0)
  return '$' + (v / 1000).toFixed(1) + 'k'
}

export function onPrice(fn) {
  priceListeners.add(fn)
  return () => priceListeners.delete(fn)
}

export async function refreshTokenPrice() {
  if (!PROJECT.mint) return usdPerToken
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${PROJECT.mint}`)
    if (!res.ok) throw new Error('dexscreener ' + res.status)
    const json = await res.json()
    const pair = json?.pairs?.[0]
    const price = Number(pair?.priceUsd)
    if (Number.isFinite(price) && price > 0) {
      usdPerToken = price
      priceListeners.forEach((fn) => fn(usdPerToken))
    }
  } catch {
    // keep the fallback; a missing price must never break the page
  }
  return usdPerToken
}
