// Converts a Solana keypair file (the 64-byte array format) into the base58
// string most wallets ask for on import. Writes next to the original; prints
// only the public address, never the secret.
//
//   node scripts/key-to-base58.mjs <path-to-keypair.json>

import fs from 'node:fs'
import path from 'node:path'
import bs58 from 'bs58'
import { Keypair } from '@solana/web3.js'

const file = process.argv[2]
if (!file) { console.error('\n  usage: node scripts/key-to-base58.mjs <keypair.json>\n'); process.exit(1) }

const bytes = Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')))
const kp = Keypair.fromSecretKey(bytes)
const b58 = bs58.default ? bs58.default.encode(bytes) : bs58.encode(bytes)

const out = path.join(path.dirname(file), path.basename(file, '.json') + '-PRIVATE-KEY.txt')
fs.writeFileSync(out, b58)
try { fs.chmodSync(out, 0o600) } catch {}

console.log('')
console.log('  address:  ' + kp.publicKey.toBase58())
console.log('  written:  ' + out)
console.log('')
console.log('  That file contains the private key as one long line of text.')
console.log('  Paste it into Phantom, then DELETE the file.')
console.log('')
