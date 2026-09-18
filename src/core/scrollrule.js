// ---------------------------------------------------------------------------
// The scroll rule: how far through the page you are, and how much is left.
//
// Drawn as a surveyor's staff to match the rest of the site — a vertical rule
// with a notch for each section, a fill for the ground covered, and a readout
// that travels with you.
// ---------------------------------------------------------------------------

import gsap from 'gsap'

const SECTIONS = [
  ['.hero', 'Top'],
  ['.proof', '01'],
  ['.how', '02'],
  ['.wall', '03'],
  ['.feed', '04'],
  ['.foot', 'End'],
]

export function initScrollRule(lenis) {
  const root = document.getElementById('scroll-rule')
  if (!root) return

  const fill = root.querySelector('.staff__fill')
  const marker = root.querySelector('.staff__marker')
  const pct = root.querySelector('.staff__pct')
  const ticksHost = root.querySelector('.staff__ticks')
  const track = root.querySelector('.staff__track')

  let ticks = []

  // Place a notch at the same fraction down the rule as its section sits down
  // the page, so the staff is a map of the document rather than even spacing.
  function layOutTicks() {
    ticksHost.innerHTML = ''
    ticks = []

    const scrollable = document.documentElement.scrollHeight - window.innerHeight
    if (scrollable <= 0) return

    for (const [selector, label] of SECTIONS) {
      const el = document.querySelector(selector)
      if (!el) continue

      const at = gsap.utils.clamp(0, 1, el.offsetTop / scrollable)
      const tick = document.createElement('i')
      tick.className = 'staff__tick'
      tick.style.top = `${at * 100}%`
      tick.innerHTML = `<span>${label}</span>`
      ticksHost.append(tick)
      ticks.push({ el: tick, at })
    }
  }

  const moveTo = gsap.quickTo(marker, 'y', { duration: 0.35, ease: 'power3' })
  let lastShown = -1

  function update(progress) {
    const p = gsap.utils.clamp(0, 1, progress || 0)

    fill.style.height = `${p * 100}%`
    moveTo(p * track.getBoundingClientRect().height)

    const shown = Math.round(p * 100)
    if (shown !== lastShown) {
      pct.textContent = `${shown}%`
      lastShown = shown
    }

    for (const t of ticks) {
      t.el.classList.toggle('is-passed', p >= t.at - 0.005)
      // light up the label of whichever section you are actually in
      t.el.classList.toggle('is-near', Math.abs(p - t.at) < 0.06)
    }

    root.classList.toggle('is-at-end', p > 0.985)
  }

  layOutTicks()
  update(0)
  // hold it back until the page has settled, so it does not flash during load
  setTimeout(() => root.classList.add('is-live'), 900)

  lenis.on('scroll', ({ progress }) => update(progress))

  let resizeTimer
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      layOutTicks()
      update(lenis.progress ?? 0)
    }, 200)
  })

  // the document gets taller as images load, which moves every notch
  window.addEventListener('load', () => {
    layOutTicks()
    update(lenis.progress ?? 0)
  })
}
