// Flips the site from simulation to live, after the token really exists.
//
//   npm run golive
//
// Sets PROJECT.mint to the address already advertised in announcedMint, checks
// the mint is actually on chain first, rebuilds for production, then prints the
// two commands that put it on the server.

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** thrown to stop cleanly; a real process.exit() crashes libuv mid-fetch here */
class ExitEarly extends Error {}
process.on('uncaughtException', (e) => { if (!(e instanceof ExitEarly)) throw e })

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG = path.join(root, 'src/core/config.js')
const IP = '164.92.161.134'
const DOMAIN = 'solspot.fun'

let cfg = fs.readFileSync(CONFIG, 'utf8')
const ca = (cfg.match(/announcedMint: '([^']+)'/) || [])[1]
if (!ca) { console.error('\n  no announcedMint in config.js\n'); process.exit(1) }

const env = fs.readFileSync(path.join(root, '.env'), 'utf8')
const rpc = (env.match(/^SPOT_RPC=(.+)$/m) || [])[1].trim()

console.log(`\n  going live with  ${ca}\n`)

// never flip the site onto a mint that does not exist
const res = await fetch(rpc, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [ca, { encoding: 'jsonParsed' }] }),
}).then((r) => r.json())

if (!res.result?.value) {
  console.error('  REFUSING: nothing exists at that address yet.')
  console.error('  Launch the token first, then run this again.\n')
  process.exit(1)
}
const info = res.result.value.data?.parsed?.info || {}
console.log('  mint found on chain')
console.log(`    decimals        ${info.decimals}`)
console.log(`    mint authority  ${info.mintAuthority ?? 'revoked'}`)
console.log(`    freeze auth     ${info.freezeAuthority ?? 'null'}`)
if (info.mintAuthority) console.log('    WARNING: mint authority is still set, more tokens can be printed')

if (/^\s*mint: '/m.test(cfg)) {
  console.log('\n  PROJECT.mint is already set, leaving it alone')
} else {
  cfg = cfg.replace(/^(\s*)mint: null,$/m, `$1mint: '${ca}',`)
  fs.writeFileSync(CONFIG, cfg)
  console.log('\n  config.js: PROJECT.mint set')
}

console.log('  building for production...')
execSync(`npm run build -- --outDir deploy/dist-prod --emptyOutDir`, {
  cwd: root, stdio: 'pipe', env: { ...process.env, VITE_SPOT_API: `https://${DOMAIN}/api` },
})

const js = fs.readdirSync(path.join(root, 'deploy/dist-prod/assets')).find((f) => f.endsWith('.js'))
const bundle = fs.readFileSync(path.join(root, 'deploy/dist-prod/assets', js), 'utf8')
const serverKey = new URL(rpc).searchParams.get('api-key')
console.log(`  bundle ${js}`)
console.log(`    contains the CA        ${bundle.includes(ca)}`)
console.log(`    server key exposed     ${bundle.includes(serverKey)}   (must be false)`)
console.log(`    points at ${DOMAIN}/api  ${bundle.includes(`https://${DOMAIN}/api`)}`)

console.log(`\n  ---- run these in PowerShell ----\n`)
console.log(`scp -r deploy/dist-prod root@${IP}:/tmp/spot-dist\n`)
console.log(`ssh root@${IP} "sed -i '/^SPOT_MINT=/d' /opt/spot/.env.server && echo 'SPOT_MINT=${ca}' >> /opt/spot/.env.server && chmod 600 /opt/spot/.env.server && systemctl enable --now spot && sleep 2 && systemctl is-active spot && cp -r /tmp/spot-dist/* /var/www/${DOMAIN}/ && chown -R www-data:www-data /var/www/${DOMAIN} && rm -rf /tmp/spot-dist && echo LIVE"\n`)
console.log(`scp src/core/config.js root@${IP}:/opt/spot/src/core/\n`)
console.log(`  then tell me, and I will verify the live site end to end.\n`)
