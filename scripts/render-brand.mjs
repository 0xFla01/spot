// Renders the brand artwork to PNG at exactly the sizes each platform wants.
// The art itself lives in brand/*.html, so it stays editable — change the
// design, run this again, get new files.
//
//   npm run brand
//
// Needs the dev server running (npm run dev) so the fonts and pages load.

import { chromium } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(here, '..', 'brand')
const BASE = process.env.BRAND_BASE || 'http://localhost:5173'

const ASSETS = [
  // profile picture — rendered at 2x so it stays sharp when X shows it large
  { page: 'pfp.html', file: 'spot-pfp.png', w: 500, h: 500, scale: 2, note: 'X / Telegram profile picture' },
  // X wants exactly 1500x500
  { page: 'banner.html', file: 'spot-banner.png', w: 1500, h: 500, scale: 1, note: 'X banner' },
  // the card shown when the link is posted anywhere
  { page: 'og.html', file: 'spot-og.png', w: 1200, h: 630, scale: 1, note: 'link preview card' },
  // a small square for favicons and token metadata
  { page: 'pfp.html', file: 'spot-mark-512.png', w: 512, h: 512, scale: 1, note: 'token logo / favicon source' },
]

fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
console.log('')

for (const a of ASSETS) {
  const ctx = await browser.newContext({
    viewport: { width: a.w, height: a.h },
    deviceScaleFactor: a.scale,
  })
  const page = await ctx.newPage()

  const url = `${BASE}/brand/${a.page}`
  const res = await page.goto(url, { waitUntil: 'networkidle' }).catch(() => null)
  if (!res || !res.ok()) {
    console.error(`  FAILED  ${a.file} — could not load ${url}`)
    console.error('          is the dev server running? (npm run dev)\n')
    await ctx.close()
    continue
  }

  // the wordmark is set in Archivo; rendering before it arrives gives a
  // fallback face and the spacing comes out wrong
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(350)

  const out = path.join(OUT, a.file)
  await page.screenshot({ path: out, type: 'png' })
  await ctx.close()

  const kb = (fs.statSync(out).size / 1024).toFixed(0)
  console.log(`  ${a.file.padEnd(22)} ${String(a.w * a.scale).padStart(4)}x${String(a.h * a.scale).padEnd(5)} ${kb.padStart(4)}KB   ${a.note}`)
}

await browser.close()
console.log(`\nWritten to ${OUT}\n`)
