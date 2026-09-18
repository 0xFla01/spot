import { resolveMedia } from './sync.js'
// ---------------------------------------------------------------------------
// Reticle cursor. A surveying crosshair that reads the deed underneath it.
//
// It is also, quietly, a deed itself. The ring is a circle, so somebody can
// own it: press C while reveal mode is on. Whoever holds CURSOR-01 becomes
// the pointer everyone on the site is dragging around.
// ---------------------------------------------------------------------------

import gsap from 'gsap'
import { byId } from './spots.js'
import { nextPrice, fmt, fmtUsd, PROJECT } from './config.js'

export const CURSOR_DEED = 'CURSOR-01'

let root = null

export function paintCursorDeed() {
  if (!root) return
  const spot = byId.get(CURSOR_DEED)
  const ring = root.querySelector('.reticle__ring')
  if (!ring) return

  if (spot?.media?.src && spot.media.type === 'image') {
    ring.style.backgroundImage = `url("${resolveMedia(spot.media.src)}")`
    root.classList.add('is-deed-owned')
  } else {
    ring.style.backgroundImage = ''
    root.classList.remove('is-deed-owned')
  }
}

function isTyping(target) {
  if (!(target instanceof Element)) return false
  return target.matches('input, textarea, select, [contenteditable="true"]')
}

export function initCursor() {
  const el = document.querySelector('.reticle')
  if (!el || window.matchMedia('(pointer: coarse)').matches) return
  root = el

  const label = el.querySelector('.reticle__label')
  const x = gsap.quickTo(el, 'x', { duration: 0.32, ease: 'power3' })
  const y = gsap.quickTo(el, 'y', { duration: 0.32, ease: 'power3' })

  window.addEventListener('pointermove', (e) => {
    el.classList.add('is-live')
    x(e.clientX)
    y(e.clientY)
  })

  document.addEventListener('pointerover', (e) => {
    const spotEl = e.target.closest('.spot')
    const hot = e.target.closest('.btn, .iconbtn, a, button, input, .spot')

    document.body.classList.toggle('is-hot', Boolean(hot))

    if (spotEl) {
      const spot = byId.get(spotEl.dataset.spotId)
      if (!spot) return
      const price = nextPrice(spot)
      const verb = spot.owner ? 'take' : 'claim'
      label.textContent = `${verb} · ${fmt(price)} ${PROJECT.ticker} · ${fmtUsd(price)}`
    } else if (hot) {
      label.textContent = ''
    }
  })

  // the easter egg: claim the pointer itself
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'c' && e.key !== 'C') return
    if (isTyping(e.target)) return
    if (e.metaKey || e.ctrlKey) return // never hijack copy
    document.dispatchEvent(new CustomEvent('spot:open', { detail: { id: CURSOR_DEED } }))
  })

  paintCursorDeed()
}
