// Proves the money side without a live token: builds the exact transaction the
// site would send, decodes every instruction out of it, and checks the burn is
// really there for the right amount, on the right mint, plus the payout and
// the memo. Run with:  node scripts/verify-burn.mjs

import { PublicKey, Keypair } from '@solana/web3.js'
import {
  decodeBurnCheckedInstruction,
  decodeTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token'

import { PROJECT, TIERS, ECONOMY, priceBreakdown } from '../src/core/config.js'

// the program that owns the mint, from config, so this test follows the mint
// rather than assuming the classic SPL Token program
const TOKEN_PROGRAM = new PublicKey(PROJECT.tokenProgram)
import { purchaseInstructions } from '../src/chain/pay.js'

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'

// Stand-ins. These must be real on-curve keys: deriving an associated token
// account refuses an address that is not a valid ed25519 point.
const MINT = Keypair.generate().publicKey.toBase58()
const BUYER = Keypair.generate().publicKey.toBase58()
const SELLER = Keypair.generate().publicKey.toBase58()

PROJECT.mint = MINT
PROJECT.decimals = 6

const unit = 10n ** BigInt(PROJECT.decimals)
let failures = 0

function check(label, pass, detail = '') {
  console.log(`${pass ? '  PASS' : '  FAIL'}  ${label}${detail ? '  ' + detail : ''}`)
  if (!pass) failures++
}

async function inspect(spot) {
  const b = priceBreakdown(spot)
  const { tx } = await purchaseInstructions(spot, BUYER)

  const out = { burn: 0n, toSeller: 0n, memo: null, count: tx.instructions.length }
  const sellerAta = spot.owner
    ? (await getAssociatedTokenAddress(new PublicKey(MINT), new PublicKey(spot.owner), false, TOKEN_PROGRAM)).toBase58()
    : null

  for (const ix of tx.instructions) {
    if (ix.programId.toBase58() === MEMO_PROGRAM) {
      out.memo = new TextDecoder().decode(ix.data)
      continue
    }
    if (!ix.programId.equals(TOKEN_PROGRAM)) continue

    try {
      const burn = decodeBurnCheckedInstruction(ix, TOKEN_PROGRAM)
      if (burn.keys.mint.pubkey.toBase58() === MINT) out.burn += burn.data.amount
      continue
    } catch {
      /* not a burn */
    }
    try {
      const t = decodeTransferCheckedInstruction(ix, TOKEN_PROGRAM)
      if (t.keys.destination.pubkey.toBase58() === sellerAta) out.toSeller += t.data.amount
    } catch {
      /* not a transfer */
    }
  }
  return { b, out, sellerAta }
}

console.log(`\nmint ${MINT}   decimals ${PROJECT.decimals}\n`)

// --- 1. first claim: everything burns ---------------------------------------
{
  const spot = { id: 'PIN-04', tier: 'PIN', owner: null, lastPrice: null, flips: 0 }
  const { b, out } = await inspect(spot)
  const price = TIERS.PIN.price

  console.log(`FIRST CLAIM  ${spot.id}  price ${price.toLocaleString()} tokens`)
  check('price is the tier price, untouched', b.total === price, `${b.total}`)
  check('100% is burned', b.burn === price, `burn=${b.burn}`)
  check('nobody is paid', b.previousOwner === 0 && b.treasury === 0)
  check(
    'the burn instruction carries the exact amount',
    out.burn === BigInt(price) * unit,
    `${out.burn} base units`
  )
  check('no payout instruction exists', out.toSeller === 0n)
  check('memo names the spot and price', out.memo === `spot:PIN-04:${price}`, out.memo)
  console.log('')
}

// --- 2. a flip: previous owner paid, remainder burned -----------------------
{
  const last = TIERS.PARCEL.price
  const spot = { id: 'PAR-09', tier: 'PARCEL', owner: SELLER, lastPrice: last, flips: 1 }
  const { b, out } = await inspect(spot)
  const expected = Math.round(last * ECONOMY.FLIP_MULTIPLIER)

  console.log(`FLIP  ${spot.id}  last ${last.toLocaleString()} -> ${expected.toLocaleString()}`)
  check('price is exactly 1.5x the last one', b.total === expected, `${b.total}`)
  check('previous owner gets 95%', b.previousOwner === Math.round(expected * 0.95), `${b.previousOwner}`)
  check('the remainder burns', b.burn === expected - b.previousOwner, `${b.burn}`)
  check('nothing is lost to rounding', b.previousOwner + b.burn + b.treasury === b.total)
  check(
    'the burn instruction carries the exact amount',
    out.burn === BigInt(b.burn) * unit,
    `${out.burn} base units`
  )
  check(
    'the payout instruction reaches the seller',
    out.toSeller === BigInt(b.previousOwner) * unit,
    `${out.toSeller} base units`
  )
  check('memo names the spot and price', out.memo === `spot:PAR-09:${expected}`, out.memo)
  console.log('')
}

// --- 3. the burn is a real burn, not a transfer to a dead wallet ------------
{
  const spot = { id: 'MON-01', tier: 'MONUMENT', owner: null, lastPrice: null, flips: 0 }
  const { tx } = await purchaseInstructions(spot, BUYER)

  let realBurn = false
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(TOKEN_PROGRAM)) continue
    try {
      decodeBurnCheckedInstruction(ix, TOKEN_PROGRAM)
      realBurn = true
    } catch {
      /* keep looking */
    }
  }
  console.log('BURN IS A BURN')
  check('uses the SPL burn instruction, so total supply drops', realBurn)
  check('all legs sit in one transaction, so it is atomic', tx.instructions.length >= 2)
  console.log('')
}

console.log(failures === 0 ? 'All checks passed.\n' : `${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
