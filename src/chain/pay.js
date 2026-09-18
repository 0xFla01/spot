// ---------------------------------------------------------------------------
// Paying for a spot.
//
// Every leg of the payment is funded by the buyer, so the whole thing fits in
// ONE transaction the buyer signs once: pay the previous owner, burn the
// burn share, pay the treasury. If any leg fails they all fail.
//
// What this does NOT do is prove ownership. A transaction is only money
// moving; nothing here stops someone calling the API and claiming a spot they
// never paid for. `verifyAndRecord` is the seam where a backend (or, later,
// an Anchor program) checks the signature actually contains these exact
// instructions before it writes the new owner. Until that exists, the site
// records ownership locally and the burn is real but the ledger is trust-me.
// ---------------------------------------------------------------------------

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  createTransferCheckedInstruction,
  createBurnCheckedInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token'

import { PROJECT, priceBreakdown } from '../core/config.js'
import { wallet, rpc, refreshBalance } from './wallet.js'

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr')

// The mint's own program. Passed to every derivation and every instruction:
// the spl-token helpers default to the classic program, which would put the
// token accounts at addresses that do not exist for a Token-2022 mint.
const TOKEN_PROGRAM = new PublicKey(PROJECT.tokenProgram)

function baseUnits(wholeTokens) {
  // token amounts are integers in base units; avoid float drift entirely
  const factor = 10n ** BigInt(PROJECT.decimals)
  const whole = BigInt(Math.round(wholeTokens))
  return whole * factor
}

/**
 * The instructions a purchase is made of, with no network involved.
 * Split out from buildPurchase so the payment can be inspected and tested
 * without a blockhash, an RPC or a wallet extension.
 *
 * `buyerAddress` defaults to the connected wallet.
 */
export async function purchaseInstructions(spot, buyerAddress = wallet.address) {
  if (!PROJECT.mint) throw new Error('No mint configured')
  if (!buyerAddress) throw new Error('Wallet not connected')

  const b = priceBreakdown(spot)
  const mint = new PublicKey(PROJECT.mint)
  const buyer = new PublicKey(buyerAddress)
  const buyerAta = await getAssociatedTokenAddress(mint, buyer, false, TOKEN_PROGRAM)

  const tx = new Transaction()
  const legs = []

  // 1. the previous owner gets paid first
  if (!b.isPrimary && b.previousOwner > 0 && spot.owner) {
    const seller = new PublicKey(spot.owner)
    const sellerAta = await getAssociatedTokenAddress(mint, seller, false, TOKEN_PROGRAM)
    // they may have closed their token account since buying; make sure it exists
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(buyer, sellerAta, seller, mint, TOKEN_PROGRAM)
    )
    tx.add(
      createTransferCheckedInstruction(
        buyerAta,
        mint,
        sellerAta,
        buyer,
        baseUnits(b.previousOwner),
        PROJECT.decimals,
        [],
        TOKEN_PROGRAM
      )
    )
    legs.push({ kind: 'owner', to: spot.owner, amount: b.previousOwner })
  }

  // 2. the treasury cut, only if there is somewhere to send it
  if (b.treasury > 0 && PROJECT.treasury) {
    const treasury = new PublicKey(PROJECT.treasury)
    const treasuryAta = await getAssociatedTokenAddress(mint, treasury, false, TOKEN_PROGRAM)
    tx.add(
      createAssociatedTokenAccountIdempotentInstruction(buyer, treasuryAta, treasury, mint, TOKEN_PROGRAM)
    )
    tx.add(
      createTransferCheckedInstruction(
        buyerAta,
        mint,
        treasuryAta,
        buyer,
        baseUnits(b.treasury),
        PROJECT.decimals,
        [],
        TOKEN_PROGRAM
      )
    )
    legs.push({ kind: 'treasury', to: PROJECT.treasury, amount: b.treasury })
  }

  // 3. the burn. Last, so it is the remainder and the totals always match.
  if (b.burn > 0) {
    tx.add(
      createBurnCheckedInstruction(
        buyerAta,
        mint,
        buyer,
        baseUnits(b.burn),
        PROJECT.decimals,
        [],
        TOKEN_PROGRAM
      )
    )
    legs.push({ kind: 'burn', to: null, amount: b.burn })
  }

  // 4. a memo, so the spot this payment is for is readable on-chain.
  //    This is what a verifier matches the transaction against.
  tx.add(
    new TransactionInstruction({
      keys: [{ pubkey: buyer, isSigner: true, isWritable: false }],
      programId: MEMO_PROGRAM,
      data: new TextEncoder().encode(`spot:${spot.id}:${b.total}`),
    })
  )

  tx.feePayer = buyer
  return { tx, legs, breakdown: b }
}

/**
 * The same transaction, made sendable by attaching a recent blockhash.
 */
export async function buildPurchase(spot) {
  const built = await purchaseInstructions(spot)
  const { blockhash, lastValidBlockHeight } = await rpc().getLatestBlockhash('confirmed')
  built.tx.recentBlockhash = blockhash
  return { ...built, blockhash, lastValidBlockHeight }
}

/**
 * Sign, send and wait for confirmation. Returns the signature.
 */
export async function sendPurchase(spot) {
  const { tx, breakdown, blockhash, lastValidBlockHeight } = await buildPurchase(spot)

  const provider = wallet.provider
  if (!provider) throw new Error('Wallet not connected')

  const { signature } = await provider.signAndSendTransaction(tx)

  const result = await rpc().confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed'
  )
  if (result.value.err) {
    throw new Error('Transaction failed on chain: ' + JSON.stringify(result.value.err))
  }

  await refreshBalance()
  return { signature, breakdown }
}

/**
 * The trust seam. With a backend configured this posts the signature and lets
 * the server confirm the transaction really contains the right burn and
 * transfers before recording the new owner. Without one it resolves straight
 * away and the caller records ownership locally.
 */
export async function verifyAndRecord({ spot, signature, mediaUrl }) {
  const endpoint = import.meta.env?.VITE_SPOT_API
  if (!endpoint) return { verified: false, local: true }

  const res = await fetch(`${endpoint}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      spotId: spot.id,
      signature,
      buyer: wallet.address,
      mediaUrl: mediaUrl ?? null,
    }),
  })
  if (!res.ok) throw new Error('Claim rejected: ' + (await res.text()))
  return { verified: true, ...(await res.json()) }
}

export function explorerUrl(signature) {
  return `https://solscan.io/tx/${signature}`
}
