import { resolveMedia } from './sync.js'
// ---------------------------------------------------------------------------
// Turns registry entries into DOM. Placeholders in the HTML carry data-spot;
// the wall is generated. Every spot on the page goes through here.
// ---------------------------------------------------------------------------

import { SPOTS, byId, bySection } from './spots.js'
import { TIERS, nextPrice, fmt } from './config.js'
import { displayName } from './profiles.js'
import { mockImage, mockWallet } from './mockmedia.js'

export const mounted = new Map() // id -> element

function build(spot) {
  const el = document.createElement('button')
  el.className = 'spot'
  el.type = 'button'
  el.dataset.spotId = spot.id
  el.dataset.tier = spot.tier
  el.dataset.shape = spot.shape
  el.setAttribute('aria-label', `${spot.id} — ${TIERS[spot.tier].label}`)

  const tier = TIERS[spot.tier]
  const plaque =
    spot.tier === 'PIN'
      ? ''
      : `<span class="spot__vacant">
           <b>${tier.label}</b>
           <i></i>
           <em>${fmt(tier.price)} ${'$SPOT'} · unclaimed</em>
         </span>`

  // An 'inside' label goes within the shape itself. Hanging it on the wrapper
  // leaves it stranded in empty space for anything that does not fill its
  // cell — a circle or a diamond sits centred with air around it.
  const inside =
    spot.label && spot.lpos === 'inside'
      ? `<span class="plabel plabel--inside">${spot.label}</span>`
      : ''

  el.innerHTML = `
    <span class="spot__ticks"><span></span><span></span><span></span><span></span></span>
    ${plaque}
    ${inside}
    <span class="spot__id">${spot.id}</span>
    <span class="spot__owner"></span>
    <span class="spot__tag">${fmt(nextPrice(spot))}</span>
  `
  return el
}

export function paint(spot) {
  // a deed can appear more than once in the document (the ticker clones its
  // row), so every copy has to stay in sync
  const all = document.querySelectorAll(`[data-spot-id="${spot.id}"]`)
  all.forEach((el) => paintOne(spot, el))
}

function paintOne(spot, el) {
  el.classList.toggle('is-owned', Boolean(spot.owner))
  const tag = el.querySelector('.spot__tag')
  if (tag) tag.textContent = fmt(nextPrice(spot))

  let fill = el.querySelector('.spot__fill')
  const wantTag = spot.media?.type === 'video' ? 'video' : 'img'

  if (spot.media) {
    if (!fill || fill.tagName.toLowerCase() !== wantTag) {
      fill?.remove()
      fill = document.createElement(wantTag)
      fill.className = 'spot__fill'

      if (wantTag === 'video') {
        // These have to be real attributes, set before the source, or Chrome
        // refuses to autoplay and the Monument just sits there on a black frame.
        fill.setAttribute('muted', '')
        fill.setAttribute('autoplay', '')
        fill.setAttribute('loop', '')
        fill.setAttribute('playsinline', '')
        fill.setAttribute('preload', 'auto')
        fill.muted = true
        fill.defaultMuted = true
        fill.playsInline = true
      } else {
        fill.loading = 'lazy'
        fill.decoding = 'async'
      }
      el.prepend(fill)
    }

    const url = resolveMedia(spot.media.src)
    if (fill.src !== url) fill.src = url
    fill.dataset.media = spot.media.type

    // whichever part of a moving image the owner chose to show
    const f = spot.media.focus
    fill.style.objectPosition = f ? `${f.x}% ${f.y}%` : ''

    if (wantTag === 'video') {
      // autoplay can still be refused; asking directly covers the rest
      const go = () => fill.play?.().catch(() => {})
      go()
      fill.addEventListener('loadeddata', go, { once: true })
    } else {
      fill.alt = spot.media.alt || spot.id
    }
  } else {
    fill?.remove()
  }

  const chip = el.querySelector('.spot__owner')
  if (chip) chip.textContent = spot.owner ? displayName(spot.owner) : ''

  // Spots used to be able to carry a link. That is gone on purpose: a bought
  // spot pointing at a wallet drainer would have been this site handing its
  // own visitors to an attacker, with Phantom already open. Nothing here reads
  // media.href any more, and old records are stripped rather than trusted.
  delete el.dataset.href
  el.classList.remove('has-link')
  el.removeAttribute('title')

  if (!el.querySelector('.spot__edge')) {
    const edge = document.createElement('span')
    edge.className = 'spot__edge'
    el.append(edge)
  }
}

function labelFor(spot) {
  if (!spot.label) return null
  // inside-labels are rendered within the spot itself, by build()
  if (spot.lpos === 'inside') return null
  const el = document.createElement('span')
  el.className = `plabel plabel--${spot.lpos || 'top'}`
  el.textContent = spot.label
  return el
}

// A deed = the spot plus its annotation, so the label can sit outside the
// spot's own clipped box without any hand-placed coordinates.
function wrap(spot, el) {
  const label = labelFor(spot)
  if (!label) return el
  const deed = document.createElement('span')
  deed.className = 'deed'
  deed.append(el, label)
  return deed
}

function mount(spot, host, inline = false) {
  const el = build(spot)

  if (inline) {
    // a deed set into the typography is sized purely by CSS
    el.classList.add(...host.classList)
    host.replaceWith(el)
    mounted.set(spot.id, el)
    paint(spot)
    return el
  }

  // Otherwise the placeholder owns the placement (its classes, its inline
  // style, or the registry position). Whatever ends up in the document tree
  // must carry that placement, so hand it to the wrapper when there is one.
  const node = wrap(spot, el)
  const placed = node

  placed.classList.add(...host.classList)
  if (host.getAttribute('style')) {
    placed.style.cssText = host.getAttribute('style')
  } else if (spot.pos) {
    Object.assign(placed.style, spot.pos, { position: 'absolute' })
  }

  // The spot fills its deed, but that has to come from the stylesheet
  // (`.deed > .spot`) rather than an inline style. Inline beats every rule,
  // including the ones that keep a circle round and an arch the right shape,
  // so writing it here silently squashed every deed that carried a label.

  host.replaceWith(placed)
  mounted.set(spot.id, el)
  paint(spot)
  return el
}

// Grid sections (the wall, the strip) are generated straight from the registry.
function fillGrid(sectionName, hostId) {
  const grid = document.getElementById(hostId)
  if (!grid) return
  for (const spot of bySection(sectionName)) {
    if (spot.inType) continue // typographic deeds are placed by hand in the markup
    const el = build(spot)
    const node = wrap(spot, el)
    const [c, r] = spot.span || [2, 1]
    node.style.gridColumn = `span ${c}`
    node.style.gridRow = `span ${r}`
    grid.append(node)
    mounted.set(spot.id, el)
    paint(spot)
  }
}

export function mountAll() {
  // 1. placeholders already in the markup
  document.querySelectorAll('[data-spot]').forEach((host) => {
    const spot = byId.get(host.dataset.spot)
    if (!spot) return
    mount(spot, host, host.classList.contains('inline-spot'))
  })

  // 2. generated grids
  fillGrid('wall', 'wall-grid')
  fillGrid('strip', 'strip-grid')
}

// --- demo seeding ----------------------------------------------------------
// Half-claimed state so the layout can be judged honestly.
export function seedDemo(count = 13) {
  // deterministic shuffle, so the demo looks the same on every reload and
  // the loop can never outlive the pool
  const pool = SPOTS.filter((s) => s.tier !== 'MONUMENT')
  let seed = 1337
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  const order = [...pool]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const picked = order.slice(0, Math.min(count, order.length))

  for (const spot of picked) {
    spot.owner = mockWallet(spot.id)
    spot.flips = spot.id.charCodeAt(4) % 3
    spot.lastPrice = Math.round(
      TIERS[spot.tier].price * Math.pow(1.5, spot.flips)
    )
    spot.media = { type: 'image', src: mockImage(spot.id), alt: spot.id }
    spot.claimedAt = Date.now() - (spot.id.charCodeAt(5) % 40) * 3600_000
  }

  // the Monument shows what video looks like once someone owns it
  const mon = byId.get('MON-01')
  mon.owner = null
  mon.media = null
}

export function stats() {
  const claimed = SPOTS.filter((s) => s.owner).length
  const burned = SPOTS.reduce((sum, s) => {
    if (!s.owner) return sum
    return sum + TIERS[s.tier].price + (s.lastPrice - TIERS[s.tier].price) * 0.03
  }, 0)
  return { total: SPOTS.length, claimed, free: SPOTS.length - claimed, burned }
}
