// ---------------------------------------------------------------------------
// The bits of movement that make the page feel built rather than assembled.
// ---------------------------------------------------------------------------

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'

// --- the marquee -----------------------------------------------------------
// One row is authored in the markup; it gets cloned until it covers twice the
// viewport, then the whole track slides by exactly one row width and loops.
export function initTicker() {
  const track = document.getElementById('ticker-track')
  if (!track) return

  const row = track.firstElementChild
  if (!row) return

  const rowWidth = () => row.getBoundingClientRect().width

  let copies = Math.max(2, Math.ceil((window.innerWidth * 2) / Math.max(rowWidth(), 1)))
  for (let i = 0; i < copies; i++) {
    const clone = row.cloneNode(true)
    clone.setAttribute('aria-hidden', 'true')
    // clones must not shadow the originals for anything that looks up by id
    clone.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'))
    track.append(clone)
  }

  const loop = gsap.to(track, {
    x: () => -rowWidth(),
    duration: 18,
    ease: 'none',
    repeat: -1,
    modifiers: {
      x: (x) => {
        const w = rowWidth()
        return (parseFloat(x) % w) + 'px'
      },
    },
  })

  // scroll speeds it up and can flip its direction, like a real ticker
  let base = 1
  ScrollTrigger.create({
    onUpdate: (self) => {
      const v = gsap.utils.clamp(-6, 6, self.getVelocity() / 260)
      base = self.direction === -1 ? -1 : 1
      gsap.to(loop, {
        timeScale: base * (1 + Math.abs(v)),
        duration: 0.35,
        overwrite: true,
      })
    },
  })

  // settle back to a walking pace when the scroll stops
  let idle
  window.addEventListener('scroll', () => {
    clearTimeout(idle)
    idle = setTimeout(() => {
      gsap.to(loop, { timeScale: base, duration: 0.9, ease: 'power2.out', overwrite: true })
    }, 180)
  })

  window.addEventListener('resize', () => ScrollTrigger.refresh())
}

// --- the strip drifts sideways as it passes -------------------------------
export function initDrift() {
  const grid = document.querySelector('.strip__grid')
  if (!grid) return

  gsap.fromTo(
    grid,
    { xPercent: 0 },
    {
      xPercent: -6,
      ease: 'none',
      scrollTrigger: {
        trigger: '.strip',
        start: 'top bottom',
        end: 'bottom top',
        scrub: 0.8,
      },
    }
  )
}

// --- magnetic buttons ------------------------------------------------------
export function initMagnets(selector = '.btn, .iconbtn') {
  if (window.matchMedia('(pointer: coarse)').matches) return

  document.querySelectorAll(selector).forEach((el) => {
    const x = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3' })
    const y = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3' })

    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect()
      const dx = e.clientX - (r.left + r.width / 2)
      const dy = e.clientY - (r.top + r.height / 2)
      x(dx * 0.32)
      y(dy * 0.38)
    })

    el.addEventListener('pointerleave', () => {
      x(0)
      y(0)
    })
  })
}

// --- deeds lift slightly toward the cursor --------------------------------
export function initSpotTilt() {
  if (window.matchMedia('(pointer: coarse)').matches) return

  document.addEventListener('pointermove', (e) => {
    const el = e.target.closest('.spot')
    if (!el || el.classList.contains('inline-spot')) return
    const r = el.getBoundingClientRect()
    if (r.width < 70 || r.height < 70) return
    const dx = (e.clientX - (r.left + r.width / 2)) / r.width
    const dy = (e.clientY - (r.top + r.height / 2)) / r.height
    gsap.to(el, {
      rotateX: -dy * 5,
      rotateY: dx * 6,
      transformPerspective: 900,
      duration: 0.5,
      ease: 'power3.out',
    })
  })

  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest('.spot')
    if (!el) return
    gsap.to(el, { rotateX: 0, rotateY: 0, duration: 0.7, ease: 'power3.out' })
  })
}
