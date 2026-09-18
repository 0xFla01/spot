// Records the launch film to a video file.
//
//   npm run film            (needs npm run dev running)
//
// The animation is drawn on a canvas, so it can be captured as a real
// MediaStream. Recording happens in real time — a 36 second film takes 36
// seconds — because MediaRecorder timestamps by the wall clock.

import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', 'brand')
const BASE = process.env.BRAND_BASE || 'http://localhost:5173'

fs.mkdirSync(OUT, { recursive: true })

// headed, because canvas capture and MediaRecorder are unreliable headless
const browser = await chromium.launch({
  headless: false,
  // no --mute-audio: the narration has to reach the recorder
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
})
const page = await ctx.newPage()

console.log('\n  opening the film…')
const res = await page.goto(`${BASE}/brand/video.html`, { waitUntil: 'networkidle' }).catch(() => null)
if (!res || !res.ok()) {
  console.error('  could not load it — is the dev server running? (npm run dev)\n')
  await browser.close()
  process.exit(1)
}

await page.waitForFunction(() => window.__ready === true, { timeout: 20000 })
console.log('  recording in real time, about 36 seconds…')

const download = page.waitForEvent('download', { timeout: 180000 })
await page.evaluate(() => window.__save('spot-film.webm'))
const file = await download

const out = path.join(OUT, 'spot-film.webm')
await file.saveAs(out)
await browser.close()

const mb = (fs.statSync(out).size / 1048576).toFixed(1)
console.log(`\n  spot-film.webm   ${mb}MB   1920x1080\n  ${out}\n`)
