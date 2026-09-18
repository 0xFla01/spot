// Walks every tier through a long chain of flips and checks the money is
// exactly right at every step: the multiplier, the split, and above all that
// the parts always add back up to the whole. Rounding that drifts by one token
// per flip is invisible for a week and then the burn total is a lie.
//
//   node scripts/verify-economics.mjs

import { TIERS, ECONOMY, PROJECT, priceBreakdown, nextPrice, fmt } from '../src/core/config.js'

let failures = 0
const check = (label, pass, detail = '') => {
  if (!pass) {
    console.log(`  FAIL  ${label}   ${detail}`)
    failures++
  }
  return pass
}

console.log('\nsplit in force:')
console.log(`  first claim  ${ECONOMY.primarySplit.burn * 100}% burned`)
console.log(`  every flip   ${ECONOMY.split.previousOwner * 100}% to the seller,`,
  `${(1 - ECONOMY.split.previousOwner - (PROJECT.treasury ? ECONOMY.split.treasury : 0)) * 100}% burned`)
console.log(`  multiplier   ${ECONOMY.FLIP_MULTIPLIER}x`)
console.log(`  treasury     ${PROJECT.treasury ? PROJECT.treasury : 'none, its share is burned'}\n`)

const FLIPS = 15

for (const tier of Object.values(TIERS)) {
  const spot = { id: 'TEST', tier: tier.id, owner: null, lastPrice: null, flips: 0 }

  // --- the first claim --------------------------------------------------
  let b = priceBreakdown(spot)
  check(`${tier.label}: first claim costs the tier price`, b.total === tier.price, `${b.total}`)
  check(`${tier.label}: first claim burns everything`, b.burn === tier.price, `${b.burn}`)
  check(`${tier.label}: first claim pays nobody`, b.previousOwner === 0 && b.treasury === 0)
  check(`${tier.label}: first claim adds up`, b.previousOwner + b.burn + b.treasury === b.total)

  let totalBurned = b.burn
  let paidOut = 0
  let paidIn = b.total
  spot.owner = 'someone'
  spot.lastPrice = b.total
  spot.flips = 1

  // --- then a long chain of takeovers -----------------------------------
  let previous = b.total
  for (let i = 1; i <= FLIPS; i++) {
    b = priceBreakdown(spot)

    check(
      `${tier.label} flip ${i}: price is ${ECONOMY.FLIP_MULTIPLIER}x the last`,
      b.total === Math.round(previous * ECONOMY.FLIP_MULTIPLIER),
      `${b.total} vs ${Math.round(previous * ECONOMY.FLIP_MULTIPLIER)}`
    )
    check(
      `${tier.label} flip ${i}: seller gets ${ECONOMY.split.previousOwner * 100}%`,
      b.previousOwner === Math.round(b.total * ECONOMY.split.previousOwner),
      `${b.previousOwner}`
    )
    // the whole point: nothing invented, nothing lost
    check(
      `${tier.label} flip ${i}: the parts equal the whole`,
      b.previousOwner + b.burn + b.treasury === b.total,
      `${b.previousOwner} + ${b.burn} + ${b.treasury} != ${b.total}`
    )
    check(`${tier.label} flip ${i}: burn is never negative`, b.burn >= 0, `${b.burn}`)
    check(
      `${tier.label} flip ${i}: seller profits`,
      b.previousOwner > previous,
      `got ${b.previousOwner}, paid ${previous}`
    )

    totalBurned += b.burn
    paidOut += b.previousOwner
    paidIn += b.total
    previous = b.total
    spot.lastPrice = b.total
    spot.flips += 1
  }

  // --- the books must balance across the whole chain --------------------
  check(
    `${tier.label}: everything paid in was either paid out or burned`,
    paidIn === paidOut + totalBurned,
    `in ${paidIn}, out ${paidOut}, burned ${totalBurned}`
  )

  const ret = (ECONOMY.FLIP_MULTIPLIER * ECONOMY.split.previousOwner).toFixed(3)
  console.log(
    `  ${tier.label.padEnd(9)} ${fmt(tier.price).padStart(7)} start  ->  ` +
      `${fmt(previous).padStart(8)} after ${FLIPS} flips   ` +
      `burned ${fmt(totalBurned).padStart(8)}   holder return ${ret}x`
  )
}

// --- a holder must never be able to lose money by being taken ------------
const ret = ECONOMY.FLIP_MULTIPLIER * ECONOMY.split.previousOwner
check(
  'being taken always pays more than you paid',
  ret > 1,
  `${ret.toFixed(3)}x — at or below 1 the site's promise is false`
)
console.log(`\n  a holder who gets taken receives ${ret.toFixed(3)}x what they paid`)

// ---------------------------------------------------------------------------
// The rules as decided, pinned to literals.
//
// Everything below this point used to compare the code against config, which
// both move together - the suite passed happily with the multiplier set to
// 1.9. These assertions are the ones that would have caught that, because they
// encode what was actually agreed rather than whatever config currently says.
// If you deliberately change a rule, change it here too, on purpose.
// ---------------------------------------------------------------------------
console.log('')
console.log('the agreed rules, pinned')
check('takeover multiplier is exactly 1.5x', ECONOMY.FLIP_MULTIPLIER === 1.5, String(ECONOMY.FLIP_MULTIPLIER))
check('the seller gets exactly 95%', ECONOMY.split.previousOwner === 0.95, String(ECONOMY.split.previousOwner))
check('exactly 5% burns on a flip', Math.abs((1 - ECONOMY.split.previousOwner) - 0.05) < 1e-9,
  String(1 - ECONOMY.split.previousOwner))
check('no treasury takes a cut', !ECONOMY.split.treasury && !PROJECT.treasury,
  `split=${ECONOMY.split.treasury ?? 0} address=${PROJECT.treasury ?? 'none'}`)
check('a first claim burns the whole payment', ECONOMY.primarySplit?.previousOwner === 0 ||
  ECONOMY.primarySplit?.previousOwner === undefined, JSON.stringify(ECONOMY.primarySplit))
check('the mint uses 6 decimals, as pump.fun does', PROJECT.decimals === 6, String(PROJECT.decimals))
check('price never depends on market cap',
  !/mcap|marketCap|graduation/i.test(nextPrice.toString()), 'nextPrice() reads no market data')

// the four tier prices, as set
for (const [key, want] of [['MONUMENT', 2500000], ['PLOT', 1250000], ['PARCEL', 500000], ['PIN', 250000]]) {
  check(`${key} starts at ${want.toLocaleString()}`, TIERS[key]?.price === want, String(TIERS[key]?.price))
}


console.log('')
if (failures === 0) {
  console.log('All checks passed.')
} else {
  console.log(failures + ' CHECK(S) FAILED')
}
console.log('')
process.exit(failures === 0 ? 0 : 1)
