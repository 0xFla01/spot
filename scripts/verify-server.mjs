// Proves the server refuses a forged claim. Builds parsed transactions the way
// the chain reports them, then feeds honest and tampered versions to the same
// function the server uses.  node scripts/verify-server.mjs

import { Keypair, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { checkPurchase } from '../server/verify.js'
import { PROJECT } from '../src/core/config.js'

const MINT = Keypair.generate().publicKey.toBase58()
const BUYER = Keypair.generate().publicKey.toBase58()
const SELLER = Keypair.generate().publicKey.toBase58()
const THIEF = Keypair.generate().publicKey.toBase58()
const DECIMALS = 6

const unit = (n) => String(BigInt(n) * 10n ** BigInt(DECIMALS))
let failures = 0

function expect(label, actual, wanted) {
  const pass = actual === wanted
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}`)
  if (!pass) {
    console.log(`        expected ${wanted}, got ${actual}`)
    failures++
  }
}

const spot = { id: 'PAR-09', owner: SELLER }
const expected = { total: 750000, previousOwner: 712500, burn: 37500, treasury: 0, isPrimary: false }

const sellerAta = (
  await getAssociatedTokenAddress(new PublicKey(MINT), new PublicKey(SELLER), false, new PublicKey(PROJECT.tokenProgram))
).toBase58()

// a transaction shaped exactly as the chain reports one
function tx({
  signer = BUYER,
  memo = `spot:${spot.id}:${expected.total}`,
  burn = expected.burn,
  paid = expected.previousOwner,
  burnMint = MINT,
  destination = sellerAta,
  err = null,
} = {}) {
  return {
    meta: { err, innerInstructions: [] },
    transaction: {
      message: {
        accountKeys: [{ pubkey: signer, signer: true, writable: true }],
        instructions: [
          {
            program: 'spl-token',
            parsed: {
              type: 'transferChecked',
              info: { destination, mint: MINT, tokenAmount: { amount: unit(paid) } },
            },
          },
          {
            program: 'spl-token',
            parsed: {
              type: 'burnChecked',
              info: { mint: burnMint, tokenAmount: { amount: unit(burn) } },
            },
          },
          { program: 'spl-memo', parsed: memo },
        ],
      },
    },
  }
}

const run = (t) => checkPurchase(t, { spot, expected, mint: MINT, decimals: DECIMALS, buyer: BUYER })

console.log('\nAn honest purchase')
expect('is accepted', (await run(tx())).ok, true)

console.log('\nForgeries the server has to refuse')
expect('burning less than claimed', (await run(tx({ burn: 1 }))).ok, false)
expect('burning nothing at all', (await run(tx({ burn: 0 }))).ok, false)
expect('burning a different token', (await run(tx({ burnMint: THIEF }))).ok, false)
expect('underpaying the previous owner', (await run(tx({ paid: 1 }))).ok, false)
expect('paying yourself instead of the owner', (await run(tx({ destination: THIEF }))).ok, false)
expect('a memo for a different spot', (await run(tx({ memo: 'spot:PIN-04:750000' }))).ok, false)
expect('a memo with a smaller price', (await run(tx({ memo: `spot:${spot.id}:1` }))).ok, false)
expect('no memo at all', (await run(tx({ memo: null }))).ok, false)
expect('somebody else signing', (await run(tx({ signer: THIEF }))).ok, false)
expect('a transaction that failed on chain', (await run(tx({ err: { InstructionError: [] } }))).ok, false)
expect('no transaction found', (await run(null)).ok, false)

console.log('\nWhy each was refused')
for (const [label, t] of [
  ['short burn', tx({ burn: 1 })],
  ['wrong spot', tx({ memo: 'spot:PIN-04:750000' })],
  ['wrong signer', tx({ signer: THIEF })],
  ['seller underpaid', tx({ paid: 1 })],
]) {
  const r = await run(t)
  console.log(`  ${label.padEnd(18)} ${r.reason}`)
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
