// Same words, different deliveries. The voice was never the problem — how the
// text is written and how the model is driven does most of the work.
//
//   node scripts/voice-test.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const OUT = path.join(ROOT, 'brand', 'voice')
const KEY = fs.readFileSync(path.join(ROOT, '.env'), 'utf8').match(/ELEVENLABS_API_KEY=(.+)/)[1].trim()
const LIAM = 'TX3LPaxmHKxFdv7VOQHJ'

fs.mkdirSync(OUT, { recursive: true })

const TAKES = [
  {
    file: 'take-1-flat.mp3',
    label: 'as it was',
    model: 'eleven_multilingual_v2',
    settings: { stability: 0.45, similarity_boost: 0.75, style: 0.1, use_speaker_boost: true },
    // stiff: no contractions, no pauses written in
    text:
      'Anyone can take it off you. For one and a half times what you paid. ' +
      'You cannot stop them. But you do not lose. Ninety five percent of that goes straight to you.',
  },
  {
    file: 'take-2-written-for-speech.mp3',
    label: 'contractions + pauses written in',
    model: 'eleven_multilingual_v2',
    settings: { stability: 0.35, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
    // ellipses buy a beat, contractions stop it sounding like a form letter,
    // and the short fragment lands the punch
    text:
      "Anyone can take it off you... for one and a half times what you paid.\n\n" +
      "And you can't stop them.\n\n" +
      "But here's the thing — you don't lose. Ninety-five percent of that? " +
      'Goes straight to you.',
  },
  {
    file: 'take-3-loose.mp3',
    label: 'looser, more swing',
    model: 'eleven_multilingual_v2',
    settings: { stability: 0.22, similarity_boost: 0.8, style: 0.55, use_speaker_boost: true },
    text:
      "Anyone can take it off you... for one and a half times what you paid.\n\n" +
      "And you can't stop them.\n\n" +
      "But here's the thing — you don't lose. Ninety-five percent of that? " +
      'Goes straight to you.',
  },
  {
    file: 'take-4-v3-directed.mp3',
    label: 'v3 with direction (may not be on your plan)',
    model: 'eleven_v3',
    settings: { stability: 0.4, similarity_boost: 0.8, style: 0.4, use_speaker_boost: true },
    // v3 takes stage directions inline
    text:
      "[casual] Anyone can take it off you... for one and a half times what you paid.\n\n" +
      "[flat] And you can't stop them.\n\n" +
      "[amused] But here's the thing — you don't lose. [emphasis] Ninety-five percent " +
      'of that goes straight to you.',
  },
]

console.log('')
for (const t of TAKES) {
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${LIAM}`, {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: t.text, model_id: t.model, voice_settings: t.settings }),
    })
    if (!res.ok) {
      const body = await res.text()
      let why = body.slice(0, 150)
      try { why = JSON.parse(body).detail?.message ?? why } catch {}
      console.log(`  ${t.label.padEnd(44)} unavailable — ${why}`)
      continue
    }
    const file = path.join(OUT, t.file)
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    console.log(`  ${t.label.padEnd(44)} ${(fs.statSync(file).size / 1024).toFixed(0)}KB`)
  } catch (err) {
    console.log(`  ${t.label.padEnd(44)} failed — ${err.message}`)
  }
}
console.log('')
