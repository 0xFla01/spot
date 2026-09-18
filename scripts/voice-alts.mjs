// Alternate readings for the lines that are not landing yet. Renders each
// candidate so they can be heard side by side, then the winner gets copied
// into brand/voice/film/ as the real take.
//
//   node scripts/voice-alts.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const OUT = path.join(ROOT, 'brand', 'voice', 'alts')
const KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/ELEVENLABS_API_KEY=(.+)/)[1].trim()

const LIAM = 'TX3LPaxmHKxFdv7VOQHJ'
const MODEL = 'eleven_multilingual_v2'
const SETTINGS = { stability: 0.35, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true }

export const ALTS = [
  // --- the opening: 'every inch' overclaims. 35 spots, and the site's own
  //     footer says "Every inch is for sale. Except the logo." ------------
  { file: '02-almost', line: '02', note: 'honest, and sets up the exception',
    text: 'Almost every inch of this page is for sale.' },
  { file: '02-thirty', line: '02', note: 'a number is funnier than a boast',
    text: 'Thirty-five pieces of this page are for sale.' },
  { file: '02-most',   line: '02', note: 'deflating',
    text: "Most of this page? It's for sale." },
  { file: '02-comma',  line: '02', note: 'the old one, overclaims',
    text: 'Every inch of this page, is for sale.' },

  // --- the specifics: this is where the honesty actually lives ----------
  { file: '02b-fullstop', line: '02b', note: 'names real spots on the site',
    text: 'The letters. The corners. The full stop at the end of a sentence.' },
  { file: '02b-letters',  line: '02b', note: 'shorter',
    text: 'Every letter. Every corner. Even the punctuation.' },

  // --- the cursor: the idea is right, the phrasing was not --------------
  { file: '11-look',    line: '11', note: 'makes the viewer look at their own cursor',
    text: "Look at your cursor. Yeah. That one's for sale too." },
  { file: '11-yours',   line: '11', note: 'the thing in their hand right now',
    text: "And the cursor you're using right now? Someone can own that." },
  { file: '11-pointing',line: '11', note: 'never names it, so they work it out',
    text: 'Even the thing you are pointing with. Somebody owns that.' },
  { file: '11-arrow',   line: '11', note: 'tossed away',
    text: "That little arrow you're moving around? Yeah. That's a spot." },
  { file: '11-even',    line: '11', note: 'your wording, contracted',
    text: "And even the cursor. Yeah, that one's for sale too." },
  { file: '11-even-dots', line: '11', note: 'your wording, run together',
    text: "And even the cursor... yeah, that one's for sale too." },
  { file: '11-even-full', line: '11', note: 'your wording, uncontracted',
    text: 'And even the cursor. Yeah, that one is for sale too.' },
  { file: '11-real',    line: '11', note: 'an earlier one',
    text: "Oh, and the cursor? Yeah. Really." },

  // --- optional: pays off 'almost' at the end, matches the site ---------
  { file: '10-logo',   line: '10', note: 'the one thing you cannot have',
    text: "Everything except the logo. That one's mine." },
  { file: '10-even',   line: '10', note: 'the old one',
    text: 'Even this O is for sale.' },
]


fs.mkdirSync(OUT, { recursive: true })

async function speak(text, file) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${LIAM}`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: SETTINGS }),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return fs.statSync(file).size
}

// `node scripts/voice-alts.mjs 11-real 08-short` renders only those
const only = process.argv.slice(2)
const todo = only.length ? ALTS.filter((a) => only.includes(a.file)) : ALTS

console.log('')
for (const a of todo) {
  const file = path.join(OUT, `${a.file}.mp3`)
  try {
    const size = await speak(a.text, file)
    console.log(`  ${a.file.padEnd(13)} ${(size / 1024).toFixed(0).padStart(3)}KB  "${a.text}"`)
  } catch (err) {
    console.log(`  ${a.file.padEnd(13)} FAILED  ${err.message}`)
  }
}
fs.writeFileSync(path.join(OUT, 'alts.json'), JSON.stringify(ALTS, null, 2))
console.log('')
