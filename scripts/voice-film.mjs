// Renders the film's narration, one line per file, with the delivery directed
// line by line. Each one is placed against a specific beat in the picture, so
// they are rendered separately rather than as one take that happens to fit.
//
//   node scripts/voice-film.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const OUT = path.join(ROOT, 'brand', 'voice', 'film')
const KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/ELEVENLABS_API_KEY=(.+)/)[1].trim()

const LIAM = 'TX3LPaxmHKxFdv7VOQHJ'
const MODEL = 'eleven_multilingual_v2'

/**
 * `cue` is the second in the film the line starts on.
 *
 * Written the way somebody would actually say it: contractions, ellipses
 * where a person would breathe, and one statement turned into a question so
 * the stress lands without having to ask for it.
 */
export const LINES = [
  // Cues come from the measured length of each take, and the picture is keyed
  // to these rather than the other way round. See brand/video.html.
  { id: '01',  cue: 1.5,  text: 'This is SPOT.' },
  // 'every inch' overclaimed: 35 spots, and the site's own footer already says
  // "Every inch is for sale. Except the logo."
  { id: '02',  cue: 2.8,  text: 'Almost every inch of this page is for sale.' },
  // the honesty lives here — all three are real spots on the site, the full
  // stop being PIN-32. Also covers the price chips popping onto S, O and T.
  { id: '02b', cue: 5.35, text: 'The letters. The corners. The full stop at the end of a sentence.' },
  { id: '03',  cue: 9.5,  text: 'You buy a spot, and you put whatever you want in it.' },
  { id: '04',  cue: 12.5, text: "But here's the thing." },
  // still running when the cursor clicks at 17.6 — he is explaining the rule
  // at the moment it happens to him
  { id: '05',  cue: 14.3, text: "Anyone can take it off you... for one and a half times what you paid." },
  { id: '06',  cue: 18.2, text: "And you can't stop them." },
  // "Ninety-five percent" falls 1.48s in, at 21.38s. '95% TO YOU' is keyed there.
  { id: '07',  cue: 19.9, text: "But you don't lose. Ninety-five percent of that? Goes straight to you." },
  // "burns" falls at 25.9s, which is where the embers now ignite.
  { id: '08',  cue: 24.6, text: "The rest of it just burns. It's gone. For good." },
  { id: '09',  cue: 27.5, text: 'And the price only goes one way.' },
  { id: '10',  cue: 30.6, text: 'Even this O is for sale.' },
  // the button. The commas matter: they buy a beat either side of "Yeah",
  // which is where the whole joke sits.
  { id: '11',  cue: 32.9, text: "And even the cursor. Yeah, that one's for sale too." },
]


async function speak(text, file) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${LIAM}`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: MODEL,
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.8,
        style: 0.35,
        use_speaker_boost: true,
      },
    }),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`)
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return fs.statSync(file).size
}

// Only render when this file is run directly. Importing it elsewhere (for
// LINES) must not fire off a dozen paid requests and overwrite the takes
// that were chosen by ear.
if (process.argv[1] && /voice-film\.mjs$/.test(process.argv[1])) {
  fs.mkdirSync(OUT, { recursive: true })

  console.log(`\n  voice: Liam · model: ${MODEL}\n`)
  const manifest = []

  for (const line of LINES) {
    const file = path.join(OUT, `${line.id}.mp3`)
    try {
      const size = await speak(line.text, file)
      manifest.push({ id: line.id, cue: line.cue, file: `voice/film/${line.id}.mp3` })
      console.log(`  ${line.id}  @${String(line.cue).padStart(5)}s  ${(size / 1024).toFixed(0).padStart(3)}KB  "${line.text.slice(0, 54)}"`)
    } catch (err) {
      console.log(`  ${line.id}  FAILED  ${err.message}`)
    }
  }

  fs.writeFileSync(path.join(OUT, 'cues.json'), JSON.stringify(manifest, null, 2))
  console.log(`\n  ${manifest.length} lines written, cues.json alongside them\n`)

}
