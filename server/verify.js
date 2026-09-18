// ---------------------------------------------------------------------------
// Deciding whether a transaction really paid for a spot.
//
// Kept apart from the server so it can be run against fixed transactions in a
// test. This is the only thing standing between "I paid" and "the site says I
// own it", so it is worth being able to prove it rejects the obvious forgeries.
// ---------------------------------------------------------------------------

import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'

import { PROJECT } from '../src/core/config.js'

/**
 * A parsed instruction belonging to whichever token program owns the mint.
 * jsonParsed names Token-2022 instructions 'spl-token-2022', so matching the
 * literal 'spl-token' would reject every real purchase on a Token-2022 mint.
 */
const isTokenIx = (i) => i.program === 'spl-token' || i.program === 'spl-token-2022'

/** Pull every instruction out, including the ones inside inner instructions. */
export function allInstructions(tx) {
  const top = tx?.transaction?.message?.instructions ?? []
  const inner = (tx?.meta?.innerInstructions ?? []).flatMap((i) => i.instructions)
  return [...top, ...inner]
}

function amountOf(info) {
  // burnChecked / transferChecked report a tokenAmount; plain ones a raw amount
  return BigInt(info?.tokenAmount?.amount ?? info?.amount ?? 0)
}

/**
 * @param tx        a parsed transaction, as getParsedTransaction returns it
 * @param spot      { id, owner }
 * @param expected  the breakdown the server independently calculated
 * @param opts      { mint, decimals, buyer }
 */
export async function checkPurchase(tx, { spot, expected, mint, decimals, buyer }) {
  const baseUnits = (whole) => BigInt(Math.round(whole)) * 10n ** BigInt(decimals)

  if (!tx) return { ok: false, reason: 'Transaction not found yet' }
  if (tx.meta?.err) return { ok: false, reason: 'Transaction failed on chain' }

  // the buyer must have signed and paid for it
  const signer = tx.transaction?.message?.accountKeys?.find((k) => k.signer)?.pubkey?.toString()
  if (signer !== buyer) return { ok: false, reason: 'Signer is not the buyer' }

  const ix = allInstructions(tx)

  // 1. the memo has to name this exact spot and price
  const memo = ix.find(
    (i) => i.program === 'spl-memo' || String(i.programId ?? '').startsWith('MemoSq')
  )
  const memoText = typeof memo?.parsed === 'string' ? memo.parsed : null
  if (memoText !== `spot:${spot.id}:${expected.total}`) {
    return { ok: false, reason: 'Memo does not match this spot and price' }
  }

  // 2. the burn has to be real, on our mint, for the exact amount
  if (expected.burn > 0) {
    const burned = ix
      .filter(
        (i) =>
          isTokenIx(i) &&
          (i.parsed?.type === 'burn' || i.parsed?.type === 'burnChecked') &&
          i.parsed?.info?.mint === mint
      )
      .reduce((sum, i) => sum + amountOf(i.parsed.info), 0n)

    if (burned !== baseUnits(expected.burn)) {
      return { ok: false, reason: `Burn was ${burned}, expected ${baseUnits(expected.burn)}` }
    }
  }

  // 3. the previous owner has to have been paid, into their own token account
  if (!expected.isPrimary && expected.previousOwner > 0) {
    const sellerAta = (
      await getAssociatedTokenAddress(
        new PublicKey(mint),
        new PublicKey(spot.owner),
        false,
        new PublicKey(PROJECT.tokenProgram)
      )
    ).toBase58()

    const paid = ix
      .filter(
        (i) =>
          isTokenIx(i) &&
          (i.parsed?.type === 'transfer' || i.parsed?.type === 'transferChecked') &&
          i.parsed?.info?.destination === sellerAta
      )
      .reduce((sum, i) => sum + amountOf(i.parsed.info), 0n)

    if (paid !== baseUnits(expected.previousOwner)) {
      return {
        ok: false,
        reason: `Seller was paid ${paid}, expected ${baseUnits(expected.previousOwner)}`,
      }
    }
  }

  return { ok: true }
}
