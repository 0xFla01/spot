// Reveal mode — the button that lights up every claimable inch of the page.

import gsap from 'gsap'
import { mounted } from './spot-view.js'

let on = false

export function isRevealed() {
  return on
}

function isTyping(target) {
  if (!(target instanceof Element)) return false
  return target.matches('input, textarea, select, [contenteditable="true"]')
}

export function initReveal() {
  const btn = document.getElementById('reveal-btn')
  const labelEl = btn?.querySelector('[data-reveal-label]')
  const sweep = document.querySelector('.sweep')

  function setState(next) {
    on = next
    document.body.classList.toggle('reveal', on)
    if (labelEl) labelEl.textContent = on ? 'Hide spots' : 'Reveal spots'

    if (!on) return

    // sweep the viewport once, then pop the outlines in document order
    gsap.fromTo(
      sweep,
      { opacity: 1, y: '-40vh' },
      { y: '100vh', duration: 0.9, ease: 'power2.inOut',
        onComplete: () => gsap.set(sweep, { opacity: 0 }) }
    )

    const els = [...mounted.values()].sort(
      (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top
    )
    gsap.fromTo(
      els,
      { '--reveal-pop': 0 },
      { '--reveal-pop': 1, duration: 0.01, stagger: 0.012 }
    )
    gsap.fromTo(
      els.map((e) => e.querySelector('.spot__edge')),
      { scale: 1.06, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.5, ease: 'power3.out', stagger: 0.012 }
    )
  }

  btn?.addEventListener('click', () => setState(!on))

  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      if (isTyping(e.target)) return
      setState(!on)
    }
  })
}
