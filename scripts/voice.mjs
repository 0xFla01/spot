// Turns the script into audio with ElevenLabs.
//
//   node scripts/voice.mjs samples          a short line in three voices
//   node scripts/voice.mjs full <voiceId>   every line of the film, one file each
//
// The key lives in .env, which is gitignored. Lines are rendered separately so
// each one can be placed against the picture rather than hoping a single take
// happens to line up.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const OUT = path.join(ROOT, 'brand', 'voice')

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
const KEY = env.match(/ELEVENLABS_API_KEY=(.+)/)?.[1]?.trim()
if (!KEY) {
  console.error('\n  no ELEVENLABS_API_KEY in .env\n')
  process.exit(1)
}

fs.mkdirSync(OUT, { recursive: true })

// Deadpan suits this script — the lines are already the joke, so a voice that
// performs them kills it.
const CANDIDATES = [
  { name: 'Roger', id: 'CwhRBWXzGAHq8TQ4Fs17', why: 'laid back, resonant' },
  { name: 'River', id: 'SAz9YHcvj6GT2YYXdXww', why: 'neutral, informative' },
  { name: 'Liam', id: 'TX3LPaxmHKxFdv7VOQHJ', why: 'punchier, social' },
]

// each line is cut to a beat in the film
export const LINES = [
  ['01', 'This is SPOT.'],
  ['02', 'Every inch of this page is for sale.'],
  ['03', 'You buy a spot. You put whatever you want in it.'],
  ['04', 'Your face. Your coin. Your dog.'],
  ['05', 'But here is the thing.'],
  ['06', 'Anyone can take it off you.'],
  ['07', 'For one and a half times what you paid.'],
  ['08', 'You cannot stop them.'],
  ['09', 'But you do not lose. Ninety five percent of that goes straight to you.'],
  ['10', 'The rest burns. Gone.'],
  ['11', 'And whoever claims a spot first? All of it burns.'],
  ['12', 'Even this O is for sale.'],
  ['13', 'So is the cursor. Really.'],
  ['14', 'SPOT. Every inch is for sale.'],
]

const SAMPLE =
  'This is SPOT. Every inch of this page is for sale. Anyone can take it off ' +
  'you, for one and a half times what you paid. Even this O is for sale. ' +
  'So is the cursor. Really.'

async function speak(text, voiceId, file) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: {
        stability: 0.45,       // a little variation, not robotic
        similarity_boost: 0.75,
        style: 0.1,            // low: let the words do the work
        use_speaker_boost: true,
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${res.status} ${body.slice(0, 200)}`)
  }
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return fs.statSync(file).size
}

const mode = process.argv[2] || 'samples'
console.log('')

if (mode === 'samples') {
  for (const v of CANDIDATES) {
    const file = path.join(OUT, `el-${v.name}.mp3`)
    try {
      const size = await speak(SAMPLE, v.id, file)
      console.log(`  ${v.name.padEnd(8)} ${(size / 1024).toFixed(0).padStart(4)}KB   ${v.why}`)
    } catch (err) {
      console.log(`  ${v.name.padEnd(8)} failed: ${err.message}`)
    }
  }
  console.log(`\n  listen: http://localhost:5173/brand/voice.html\n`)
} else if (mode === 'full') {
  const voiceId = process.argv[3]
  if (!voiceId) {
    console.error('  give me a voice id:  node scripts/voice.mjs full <voiceId>\n')
    process.exit(1)
  }
  for (const [n, text] of LINES) {
    const file = path.join(OUT, `line-${n}.mp3`)
    try {
      const size = await speak(text, voiceId, file)
      console.log(`  line ${n}  ${(size / 1024).toFixed(0).padStart(4)}KB  "${text.slice(0, 52)}"`)
    } catch (err) {
      console.log(`  line ${n}  failed: ${err.message}`)
    }
  }
  console.log('')
}
