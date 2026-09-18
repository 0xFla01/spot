// Grinds a Solana keypair whose address ends in a chosen suffix, across all
// cores. The output file IS the private key - it is written outside the project
// directory on purpose, so it cannot be swept into a deploy or a repo.
//
//   node scripts/grind-vanity.mjs spot
//
// base58 has no 0, O, I or l, so those cannot appear in a suffix.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { Keypair } from '@solana/web3.js'

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function grindForever() {
  const { suffix, caseSensitive } = workerData
  const want = caseSensitive ? suffix : suffix.toLowerCase()
  let tried = 0
  for (;;) {
    const kp = Keypair.generate()
    const addr = kp.publicKey.toBase58()
    const part = workerData.mode === 'prefix'
      ? addr.slice(0, suffix.length)
      : addr.slice(-suffix.length)
    if ((caseSensitive ? part : part.toLowerCase()) === want) {
      parentPort.postMessage({ found: true, address: addr, secret: Array.from(kp.secretKey), tried })
      return
    }
    if (++tried % 20000 === 0) parentPort.postMessage({ tried: 20000 })
  }
}

if (!isMainThread) {
  grindForever()
} else {

const mode = process.argv[3] === 'prefix' ? 'prefix' : 'suffix'
const suffix = process.argv[2]
if (!suffix) { console.error('\n  usage: node scripts/grind-vanity.mjs <suffix>\n'); process.exit(1) }
const bad = [...suffix].filter((c) => !B58.includes(c))
if (bad.length) {
  console.error(`\n  "${suffix}" cannot exist in a Solana address: base58 has no ${bad.join(', ')}\n`)
  process.exit(1)
}

const OUT_DIR = path.join(os.homedir(), 'spot-keys')
fs.mkdirSync(OUT_DIR, { recursive: true })

const cores = Math.max(1, os.cpus().length - 1)
const started = Date.now()
let total = 0
const workers = []

console.log(`\n  grinding for an address ending in "${suffix}" on ${cores} cores\n`)

const stop = () => workers.forEach((w) => w.terminate())

for (let i = 0; i < cores; i++) {
  const w = new Worker(new URL(import.meta.url), { workerData: { suffix, caseSensitive: true, mode } })
  workers.push(w)
  w.on('message', (m) => {
    if (m.tried && !m.found) {
      total += m.tried
      if (total % 500000 < 20000) {
        const rate = Math.round(total / ((Date.now() - started) / 1000))
        process.stdout.write(`\r  tried ${total.toLocaleString()}  ·  ${rate.toLocaleString()}/sec   `)
      }
      return
    }
    if (m.found) {
      stop()
      const file = path.join(OUT_DIR, `${mode}-${suffix}-${m.address.slice(0, 4)}.json`)
      // the array-of-bytes format solana-keygen and most tooling expect
      fs.writeFileSync(file, JSON.stringify(m.secret))
      try { fs.chmodSync(file, 0o600) } catch {}
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`\n\n  FOUND in ${secs}s after ~${(total + m.tried).toLocaleString()} tries\n`)
      console.log(`  address:  ${m.address}`)
      console.log(`  keyfile:  ${file}`)
      console.log(`\n  That file is the PRIVATE KEY of this mint.`)
      console.log(`  Do not commit it, upload it, paste it anywhere, or email it.\n`)
      process.exit(0)
    }
  })
  w.on('error', (e) => { console.error('\n  worker error: ' + e.message); stop(); process.exit(1) })
}

}
