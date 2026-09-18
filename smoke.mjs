import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
p.on('pageerror', e => errors.push(String(e)))
await p.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
const text = await p.textContent('#smoke')
const ok = await p.getAttribute('#smoke', 'data-ok')
await p.screenshot({ path: 'smoke.png' })
await b.close()
console.log(text)
console.log('\ndata-ok =', ok)
console.log('console errors:', errors.length ? errors : 'none')
