// ---------------------------------------------------------------------------
// The real thing, on devnet.
//
// Creates a throwaway token, mints some, then buys a spot using the exact same
// code the website uses — and checks the mint's total supply actually went
// down by the amount that was supposed to burn. Then feeds the resulting
// signature to the same verifier the server uses.
//
//   node scripts/devnet-burn-test.mjs
//
// Devnet airdrops are rate limited. If one fails the script prints an address
// to fund and waits for it.
// ---------------------------------------------------------------------------

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  PublicKey,
} from '@solana/web3.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  getMint,
  getAccount,
  getAssociatedTokenAddress,
} from '@solana/spl-token'

import { PROJECT, TIERS, priceBreakdown } from '../src/core/config.js'
import { purchaseInstructions } from '../src/chain/pay.js'
import { checkPurchase } from '../server/verify.js'

const RPC = process.env.DEVNET_RPC || 'https://api.devnet.solana.com'
const DECIMALS = 6
const UNIT = 10n ** BigInt(DECIMALS)

const connection = new Connection(RPC, 'confirmed')

// The buyer is kept on disk. Devnet faucets are rate limited, so funding a
// fresh address on every run would be pointless — fund it once, re-run freely.
const here = path.dirname(fileURLToPath(import.meta.url))
const KEYFILE = path.join(here, '.devnet-buyer.json')

let buyer
if (fs.existsSync(KEYFILE)) {
  buyer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEYFILE, 'utf8'))))
} else {
  buyer = Keypair.generate()
  fs.writeFileSync(KEYFILE, JSON.stringify([...buyer.secretKey]))
}
const seller = Keypair.generate()

let failures = 0
const check = (label, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`)
  if (!pass) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fund(pubkey, sol = 2) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL)
      await connection.confirmTransaction(sig, 'confirmed')
      return true
    } catch (err) {
      console.log(`  airdrop attempt ${attempt} failed (${err.message.slice(0, 60)})`)
      await sleep(2500)
    }
  }
  return false
}

console.log(`\ndevnet: ${RPC}`)
console.log(`buyer:  ${buyer.publicKey.toBase58()}`)
console.log(`seller: ${seller.publicKey.toBase58()}\n`)

const existing = await connection.getBalance(buyer.publicKey)
if (existing >= 0.3 * LAMPORTS_PER_SOL) {
  console.log(`Already funded: ${(existing / LAMPORTS_PER_SOL).toFixed(2)} SOL
`)
} else if (!(await fund(buyer.publicKey))) {
  console.log(
    '\nCould not get a devnet airdrop (they are heavily rate limited).\n' +
      'Fund this address with ~1 devnet SOL and run again:\n\n' +
      `  solana airdrop 1 ${buyer.publicKey.toBase58()} --url devnet\n\n` +
      'or paste it into https://faucet.solana.com\n'
  )
  process.exit(2)
}
const bal = await connection.getBalance(buyer.publicKey)
console.log(`  funded: ${(bal / LAMPORTS_PER_SOL).toFixed(2)} SOL\n`)

console.log('Creating a throwaway token...')
const mint = await createMint(connection, buyer, buyer.publicKey, null, DECIMALS)
PROJECT.mint = mint.toBase58()
PROJECT.decimals = DECIMALS
console.log(`  mint: ${mint.toBase58()}`)

const buyerAta = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer.publicKey)
await mintTo(connection, buyer, mint, buyerAta.address, buyer, 50_000_000n * UNIT)
const startSupply = (await getMint(connection, mint)).supply
console.log(`  minted: ${(startSupply / UNIT).toLocaleString()} tokens\n`)

async function buy(spot, label) {
  const expected = priceBreakdown(spot)
  const before = (await getMint(connection, mint)).supply

  const { tx } = await purchaseInstructions(spot, buyer.publicKey.toBase58())
  const signature = await sendAndConfirmTransaction(connection, tx, [buyer], {
    commitment: 'confirmed',
  })

  const after = (await getMint(connection, mint)).supply
  const actuallyBurned = before - after

  console.log(`${label}`)
  console.log(`  tx  https://solscan.io/tx/${signature}?cluster=devnet`)
  check(
    'total supply dropped by exactly the burn amount',
    actuallyBurned === BigInt(expected.burn) * UNIT,
    `${(actuallyBurned / UNIT).toLocaleString()} tokens burned`
  )

  if (!expected.isPrimary && expected.previousOwner > 0) {
    const sellerAta = await getAssociatedTokenAddress(mint, new PublicKey(spot.owner))
    const acct = await getAccount(connection, sellerAta)
    check(
      'previous owner received their 95%',
      acct.amount === BigInt(expected.previousOwner) * UNIT,
      `${(acct.amount / UNIT).toLocaleString()} tokens`
    )
  }

  // now the server's verifier, against the real on-chain transaction
  let parsed = null
  for (let i = 0; i < 8 && !parsed; i++) {
    parsed = await connection.getParsedTransaction(signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    })
    if (!parsed) await sleep(1200)
  }

  const verdict = await checkPurchase(parsed, {
    spot,
    expected,
    mint: mint.toBase58(),
    decimals: DECIMALS,
    buyer: buyer.publicKey.toBase58(),
  })
  check('the server accepts this real transaction', verdict.ok, verdict.reason || '')

  // and refuses the same transaction claimed against a different spot
  const wrong = await checkPurchase(parsed, {
    spot: { id: 'PIN-99', owner: null },
    expected,
    mint: mint.toBase58(),
    decimals: DECIMALS,
    buyer: buyer.publicKey.toBase58(),
  })
  check('the server refuses it for a different spot', !wrong.ok, wrong.reason || '')
  console.log('')

  return signature
}

// 1. a first claim — everything burns
await buy(
  { id: 'PIN-04', tier: 'PIN', owner: null, lastPrice: null, flips: 0 },
  `FIRST CLAIM  PIN-04  ${TIERS.PIN.price.toLocaleString()} tokens, all of it burns`
)

// 2. a flip — previous owner paid, remainder burns
await buy(
  {
    id: 'PAR-09',
    tier: 'PARCEL',
    owner: seller.publicKey.toBase58(),
    lastPrice: TIERS.PARCEL.price,
    flips: 1,
  },
  `FLIP  PAR-09  ${TIERS.PARCEL.price.toLocaleString()} -> ${(TIERS.PARCEL.price * 1.5).toLocaleString()}, 95% out and the rest burns`
)

const endSupply = (await getMint(connection, mint)).supply
console.log('SUPPLY')
console.log(`  before  ${(startSupply / UNIT).toLocaleString()}`)
console.log(`  after   ${(endSupply / UNIT).toLocaleString()}`)
console.log(`  gone    ${((startSupply - endSupply) / UNIT).toLocaleString()} tokens`)
console.log(`\n  mint on solscan: https://solscan.io/token/${mint.toBase58()}?cluster=devnet`)

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
