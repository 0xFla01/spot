// Checks a freshly launched mint is really the one the site advertises, and is
// shaped the way the economics assume.
//
//   npm run check:launch
//
// The address is read from PROJECT.announcedMint, so there is nothing to type
// and no chance of checking a different address than the one on the page.
// Plain JSON-RPC over fetch on purpose: a web3.js Connection keeps a websocket
// open and makes this script crash on exit under Windows.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8')

const cfg = read('src/core/config.js')
const announced = (cfg.match(/announcedMint: '([^']+)'/) || [])[1]
const liveMint = /^\s*mint: null/m.test(cfg) ? null : (cfg.match(/^\s*mint: '([^']+)'/m) || [])[1]

const env = fs.existsSync(path.join(root, '.env')) ? read('.env') : ''
const rpc = (env.match(/^SPOT_RPC=(.+)$/m) || [])[1]?.trim() || 'https://api.mainnet-beta.solana.com'

const EXPECTED_SUPPLY = 1_000_000_000
const EXPECTED_DECIMALS = 6
const TOKEN_PROGRAMS = {
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: 'SPL Token',
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: 'Token-2022',
}

let pass = 0, fail = 0
const ok = (m, x = '') => { pass++; console.log(`  PASS  ${m}${x ? '  ' + x : ''}`) }
const bad = (m, x = '') => { fail++; console.log(`  FAIL  ${m}${x ? '  ' + x : ''}`) }

async function call(method, params) {
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const j = await r.json()
  if (j.error) throw new Error(`${method}: ${j.error.message}`)
  return j.result
}

console.log(`\nadvertised on the site:  ${announced}`)
console.log(`rpc: ${new URL(rpc).host}\n`)

const acct = await call('getAccountInfo', [announced, { encoding: 'jsonParsed' }])

if (!acct?.value) {
  console.log('NOT LAUNCHED YET — nothing exists at that address.\n')
  console.log('Before the launch that is the right answer, and it also means')
  console.log('the address is still free: nobody has taken it.\n')
  process.exitCode = 0
} else {
  const owner = acct.value.owner
  const info = acct.value.data?.parsed?.info || {}

  console.log('THE MINT EXISTS')
  ok('an account exists at the advertised address')
  TOKEN_PROGRAMS[owner]
    ? ok('owned by a token program', TOKEN_PROGRAMS[owner])
    : bad('NOT owned by a token program — this is not a mint', owner)

  // naming the program is not enough: the site derives every associated-token
  // address FROM PROJECT.tokenProgram, so if config disagrees with the chain
  // nothing settles and the failure looks like a broken site, not a wrong id.
  const configured = (cfg.match(/tokenProgram: '([^']+)'/) || [])[1]
  configured === owner
    ? ok('config tokenProgram matches the mint', TOKEN_PROGRAMS[owner] || owner)
    : bad('config tokenProgram is WRONG — every purchase will fail',
          `config ${TOKEN_PROGRAMS[configured] || configured}, chain ${TOKEN_PROGRAMS[owner] || owner}`)

  const sup = await call('getTokenSupply', [announced])
  const amount = Number(sup.value.uiAmount)

  Number(sup.value.decimals) === EXPECTED_DECIMALS
    ? ok('decimals match what the site assumes', String(EXPECTED_DECIMALS))
    : bad('decimals differ from the site', `chain ${sup.value.decimals}, site ${EXPECTED_DECIMALS}`)

  amount <= EXPECTED_SUPPLY
    ? ok('supply is at or below the launch supply', amount.toLocaleString())
    : bad('supply exceeds a pump.fun launch', amount.toLocaleString())

  if (amount < EXPECTED_SUPPLY) {
    console.log(`        ${(EXPECTED_SUPPLY - amount).toLocaleString()} already burned`)
  }

  // a pump.fun launch revokes mint authority, so no more can ever be printed
  info.mintAuthority == null
    ? ok('mint authority revoked — supply can never grow')
    : bad('MINT AUTHORITY STILL SET — more tokens can be printed', String(info.mintAuthority))
  info.freezeAuthority == null
    ? ok('freeze authority null — nobody can freeze holders')
    : bad('freeze authority is set', String(info.freezeAuthority))

  console.log('\nTHE SITE')
  liveMint === announced
    ? ok('PROJECT.mint is this address — the site is live')
    : bad('PROJECT.mint not set — the site is still in simulation',
          liveMint ? `currently ${liveMint}` : 'currently null')

  console.log(`\n  ${pass} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
}

console.log(`  solscan: https://solscan.io/token/${announced}\n`)
