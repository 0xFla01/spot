// Solana's libraries expect Node's Buffer to exist before they load.
// This import has to stay first; see the note in polyfill.js.
import './polyfill.js'

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { SplitText } from 'gsap/SplitText'
import Lenis from 'lenis'

import './style.css'
import './spots.css'
import './sections.css'

import {
  PROJECT,
  ECONOMY,
  TIERS,
  nextPrice,
  priceBreakdown,
  fmt,
  fmtUsd,
  refreshTokenPrice,
  onPrice,
} from './core/config.js'
import { SPOTS, byId } from './core/spots.js'
import { mountAll, paint, seedDemo, stats, mounted } from './core/spot-view.js'
import { initCursor, paintCursorDeed, CURSOR_DEED } from './core/cursor.js'
import { initReveal } from './core/reveal.js'
import { initModal } from './core/modal.js'
import { initFeed, pushEvent } from './core/feed.js'
import { initStudio } from './core/studio.js'
import { initScrollRule } from './core/scrollrule.js'
import { initBackdrop } from './gl/backdrop.js'
import { initTicker, initDrift, initMagnets, initSpotTilt } from './core/motion.js'
import { displayName, rawName, setName, validateName } from './core/profiles.js'
import { wallet, onWallet, connect, disconnect, autoConnect } from './chain/wallet.js'
import * as sync from './core/sync.js'

gsap.registerPlugin(ScrollTrigger, SplitText)

// ---------------------------------------------------------------------------
// scroll
// ---------------------------------------------------------------------------
const lenis = new Lenis({
  duration: 1.15,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  smoothWheel: true,
})

lenis.on('scroll', ScrollTrigger.update)
gsap.ticker.add((time) => lenis.raf(time * 1000))
gsap.ticker.lagSmoothing(0)

document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault()
    lenis.scrollTo(a.getAttribute('href'), { offset: 0 })
  })
})

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
// With a server the wall is real and shared; without one it is a demo wall
// so the design can still be worked on.
if (!sync.isLive()) seedDemo()
mountAll()

const backdrop = initBackdrop()
lenis.on('scroll', ({ progress }) => backdrop.setScroll(progress || 0))

initCursor()
initReveal()
initFeed()
initTicker()
initMagnets()
initSpotTilt()
initScrollRule(lenis)

const studio = initStudio()

// ---------------------------------------------------------------------------
// the studio, opened for a deed
// ---------------------------------------------------------------------------
function openStudio(spot) {
  const el = mounted.get(spot.id)
  const r = el?.getBoundingClientRect()
  const frameRatio = r && r.height > 4 ? r.width / r.height : 1

  studio.open(spot, {
    frameRatio,
    // the deed's true size on the page, so the panel can say so out loud
    pxW: r ? Math.round(r.width) : 0,
    pxH: r ? Math.round(r.height) : 0,
    async onSave(media, auth) {
      // show it immediately, then let the server confirm and tell everyone
      spot.media = media
      paint(spot)
      if (spot.id === CURSOR_DEED) paintCursorDeed()
      flash(spot.id)

      if (sync.isLive()) {
        await sync.saveMedia({ spot, owner: spot.owner, media, auth })
        paint(spot)
      }
    },
  })
  document.body.classList.add('panel-open')
}

// ---------------------------------------------------------------------------
// the modal, and what a completed purchase does
// ---------------------------------------------------------------------------
const modal = initModal({
  // `applied` is true when the server has already written the new owner, in
  // which case the local registry has been updated from its reply and the
  // broadcast will reach everyone else.
  onPurchased(spot, { applied } = {}) {
    if (!applied) {
      const b = priceBreakdown(spot)
      const previous = spot.owner

      spot.lastPrice = b.total
      spot.flips += 1
      spot.owner = wallet.address || 'sim' + Math.random().toString(36).slice(2, 10)
      spot.claimedAt = Date.now()
      // taking a spot gets you the frame, not what the last owner put in it
      if (previous) spot.media = null

      pushEvent({
        kind: previous ? 'flip' : 'claim',
        spot: spot.id,
        buyer: spot.owner,
        from: previous,
        amount: b.total,
        at: Date.now(),
      })
    }

    paint(spot)
    if (spot.id === CURSOR_DEED) paintCursorDeed()
    refreshStats()
    flash(spot.id)
  },
  onEdit(spot) {
    openStudio(spot)
  },
})

function flash(id) {
  const el = mounted.get(id)
  if (!el) return
  gsap.fromTo(el, { scale: 0.96 }, { scale: 1, duration: 0.7, ease: 'elastic.out(1, 0.5)' })
}

// ---------------------------------------------------------------------------
// wallet chip
// ---------------------------------------------------------------------------
const connectBtn = document.getElementById('connect-btn')
const chip = document.getElementById('wallet-chip')

connectBtn?.addEventListener('click', () => connect().catch(() => {}))
document.getElementById('wallet-disconnect')?.addEventListener('click', () => disconnect())

onWallet((w) => {
  const connected = Boolean(w.address)
  if (connectBtn) connectBtn.hidden = connected
  if (chip) chip.hidden = !connected
  if (!connected) return

  const nameEl = chip.querySelector('[data-wallet-display]')
  if (nameEl) nameEl.textContent = displayName(w.address)
  const balEl = chip.querySelector('[data-wallet-balance]')
  if (balEl) balEl.textContent = PROJECT.mint ? fmt(w.balance) : 'sim'
})

autoConnect()

// ---------------------------------------------------------------------------
// the name panel
// ---------------------------------------------------------------------------
const namer = document.getElementById('namer')
if (namer) {
  const input = namer.querySelector('[data-nm="input"]')
  const status = namer.querySelector('[data-nm="status"]')

  const closeNamer = () => {
    namer.classList.remove('is-open')
    document.body.classList.remove('panel-open')
  }

  namer.querySelectorAll('[data-nm-close]').forEach((b) => b.addEventListener('click', closeNamer))

  document.getElementById('wallet-name')?.addEventListener('click', () => {
    if (!wallet.address) return
    input.value = rawName(wallet.address)
    status.textContent = ''
    namer.classList.add('is-open')
    document.body.classList.add('panel-open')
    setTimeout(() => input.focus(), 120)
  })

  input?.addEventListener('input', () => {
    const check = validateName(input.value)
    status.textContent = check.ok ? '' : check.error
    status.dataset.kind = check.ok ? '' : 'bad'
  })

  namer.querySelector('[data-nm="save"]')?.addEventListener('click', async () => {
    if (!wallet.address) return
    try {
      await setName(wallet.address, input.value)
      const nameEl = chip?.querySelector('[data-wallet-display]')
      if (nameEl) nameEl.textContent = displayName(wallet.address)
      // every place a name is shown has to catch up
      SPOTS.forEach((s) => s.owner && paint(s))
      status.textContent = 'Saved'
      status.dataset.kind = 'ok'
      setTimeout(closeNamer, 380)
    } catch (err) {
      status.textContent = err.message
      status.dataset.kind = 'bad'
    }
  })
}

// ---------------------------------------------------------------------------
// stats + prices
// ---------------------------------------------------------------------------
function refreshStats() {
  const s = stats()
  const set = (k, v) => {
    const el = document.querySelector(`[data-stat="${k}"]`)
    if (el) el.textContent = v
  }
  set('total', s.total)
  set('claimed', s.claimed)
  set('burned', fmt(Math.round(s.burned)))
  set('supply', `${s.total} deeds`)
  set('wall-count', `${s.free} of ${s.total} still unclaimed`)
}
refreshStats()

// price chips carry a dollar figure once the token actually trades
function refreshPriceTags() {
  document.querySelectorAll('[data-spot-id]').forEach((el) => {
    const spot = byId.get(el.dataset.spotId)
    const tag = el.querySelector('.spot__tag')
    if (!spot || !tag) return
    const p = nextPrice(spot)
    tag.title = `${fmt(p)} ${PROJECT.ticker} · ${fmtUsd(p)}`
  })
}
onPrice(refreshPriceTags)
refreshTokenPrice().then(refreshPriceTags)
setInterval(refreshTokenPrice, 60_000)

// Every percentage printed on the page comes from the config, so changing the
// split can never leave the site advertising numbers it does not honour.
{
  const pct = (n) => `${+(n * 100).toFixed(2)}%`
  const econ = {
    multiplier: `${ECONOMY.FLIP_MULTIPLIER}×`,
    'primary-burn': pct(ECONOMY.primarySplit.burn),
    seller: pct(ECONOMY.split.previousOwner),
    // with no treasury its share folds into the burn, so read the real total
    'flip-burn': pct(1 - ECONOMY.split.previousOwner - (PROJECT.treasury ? ECONOMY.split.treasury : 0)),
    // what a holder actually gets back: the multiplier, less the burn's share
    'seller-return':
      (ECONOMY.FLIP_MULTIPLIER * ECONOMY.split.previousOwner).toFixed(2) + '×',
  }
  for (const [key, value] of Object.entries(econ)) {
    document.querySelectorAll(`[data-econ="${key}"]`).forEach((el) => (el.textContent = value))
  }
}

// Social cards need an absolute image url, which only exists once the site
// has a domain. Fill it in from the config rather than hard-coding it.
if (PROJECT.siteUrl) {
  const base = PROJECT.siteUrl.replace(/\/$/, '')
  document
    .querySelectorAll('[data-og-image], [data-twitter-image]')
    .forEach((m) => m.setAttribute('content', `${base}/og.png`))
}

// The contract address. `mint` is the live one and only exists after the
// launch; `announcedMint` is the vanity address the coin will be launched
// with, which is publishable in advance. Showing the second one never turns
// on a payment path — only `PROJECT.mint` does that.
const CONTRACT = PROJECT.mint || PROJECT.announcedMint || null

const mintLine = document.getElementById('mint-line')
if (mintLine) {
  mintLine.textContent = CONTRACT || 'Mint address at launch'

  // 44 characters nobody is going to retype: one click puts it on the
  // clipboard and says so, then goes back to the address.
  if (CONTRACT) {
    mintLine.classList.add('mint-line--copy')
    mintLine.setAttribute('role', 'button')
    mintLine.setAttribute('tabindex', '0')
    mintLine.setAttribute('title', 'Copy contract address')

    let restore = 0
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(CONTRACT)
      } catch {
        // http, an old browser, or a denied permission: select it instead so
        // the address can still be copied by hand
        const r = document.createRange()
        r.selectNodeContents(mintLine)
        const sel = window.getSelection()
        sel.removeAllRanges()
        sel.addRange(r)
        return
      }
      mintLine.dataset.copied = 'yes'
      mintLine.textContent = 'Copied'
      clearTimeout(restore)
      restore = setTimeout(() => {
        delete mintLine.dataset.copied
        mintLine.textContent = CONTRACT
      }, 1200)
    }

    mintLine.addEventListener('click', copy)
    mintLine.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        copy()
      }
    })
  }
}

// Solscan, so the burn is checkable by anyone instead of taken on trust. The
// token page carries the live supply: it started at 1,000,000,000, and every
// number below that is tokens this site destroyed.
const SOLSCAN = CONTRACT ? `https://solscan.io/token/${CONTRACT}` : 'https://solscan.io'
document.querySelectorAll('[data-solscan-link]').forEach((a) => (a.href = SOLSCAN))

// the burned counter is the claim, Solscan is the proof, so let people go
// straight from one to the other
if (CONTRACT) {
  const burnedStat = document.querySelector('[data-stat="burned"]')?.closest('.hero__stat')
  if (burnedStat) {
    burnedStat.classList.add('hero__stat--verify')
    burnedStat.setAttribute('role', 'link')
    burnedStat.setAttribute('tabindex', '0')
    burnedStat.setAttribute('title', 'Check the supply on Solscan')
    const go = () => window.open(SOLSCAN, '_blank', 'noopener')
    burnedStat.addEventListener('click', go)
    burnedStat.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() }
    })
  }
}

document.querySelectorAll('[data-x-link]').forEach((a) => (a.href = PROJECT.links.x))
document.querySelectorAll('[data-pump-link]').forEach((a) => {
  a.href = CONTRACT ? `${PROJECT.links.pump}/coin/${CONTRACT}` : PROJECT.links.pump
})

// ---------------------------------------------------------------------------
// entrance + scroll motion
// ---------------------------------------------------------------------------
document.fonts.ready.then(() => {
  const intro = gsap.timeline({ defaults: { ease: 'expo.out' } })

  intro
    .from('.hero__kicker span', { yPercent: 120, opacity: 0, duration: 1, stagger: 0.06 })
    .from('.hero__line > span', { yPercent: 108, duration: 1.25, stagger: 0.075 }, '-=0.75')
    .from('[data-fade]', { y: 26, opacity: 0, duration: 1, stagger: 0.09 }, '-=0.85')
    .from('.hero .spot', { opacity: 0, y: 40, duration: 1.2, stagger: 0.08 }, '-=1.05')
    .from('.nav__actions > *', { opacity: 0, y: -14, duration: 0.8, stagger: 0.07 }, '-=0.9')

  document.querySelectorAll('[data-split]').forEach((el) => {
    const split = new SplitText(el, { type: 'lines', linesClass: 'sline' })
    gsap.set(split.lines, { overflow: 'hidden' })
    gsap.from(split.lines, {
      yPercent: 110,
      duration: 1.1,
      ease: 'expo.out',
      stagger: 0.08,
      scrollTrigger: { trigger: el, start: 'top 82%' },
    })
  })

  ScrollTrigger.batch('#wall-grid .spot', {
    start: 'top 92%',
    onEnter: (batch) =>
      gsap.from(batch, {
        opacity: 0,
        y: 26,
        scale: 0.94,
        duration: 0.85,
        ease: 'power3.out',
        stagger: { each: 0.035, from: 'random' },
      }),
    once: true,
  })

  gsap.utils.toArray('.step').forEach((el, i) => {
    gsap.from(el, {
      y: 40,
      opacity: 0,
      duration: 1,
      ease: 'power3.out',
      delay: i * 0.08,
      scrollTrigger: { trigger: el, start: 'top 85%' },
    })
  })

  gsap.to('.foot__big', {
    xPercent: -6,
    ease: 'none',
    scrollTrigger: { trigger: '.foot', start: 'top bottom', end: 'bottom bottom', scrub: 0.6 },
  })

  const mon = mounted.get('MON-01')
  if (mon) {
    gsap.to(mon, {
      yPercent: 12,
      ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.8 },
    })
  }

  initDrift()
  ScrollTrigger.refresh()
})

// ---------------------------------------------------------------------------
// shared state: load the real wall, then follow everyone else's moves
// ---------------------------------------------------------------------------
if (sync.isLive()) {
  sync
    .hydrate()
    .then(({ spots, events }) => {
      spots.forEach((s) => paint(s))
      paintCursorDeed()
      refreshStats()
      // start the ledger from real history rather than invented rows
      events
        .slice()
        .reverse()
        .forEach((ev) => pushEvent(ev))
    })
    .catch((err) => console.warn('[spot] could not load shared state:', err.message))

  sync.subscribe({
    onClaim(spot, event) {
      paint(spot)
      if (spot.id === CURSOR_DEED) paintCursorDeed()
      refreshStats()
      flash(spot.id)
      pushEvent(event)
    },
    onMedia(spot) {
      paint(spot)
      if (spot.id === CURSOR_DEED) paintCursorDeed()
    },
    onName() {
      // a name changed somewhere; repaint anything showing one
      SPOTS.forEach((s) => s.owner && paint(s))
      if (wallet.address) {
        const el = chip?.querySelector('[data-wallet-display]')
        if (el) el.textContent = displayName(wallet.address)
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Every inch being clickable is the whole premise, so in development the page
// checks that nothing is sitting on top of a deed. A full-width heading with
// an empty right-hand side will happily swallow clicks meant for a spot
// underneath it, and that is invisible until someone tries.
// ---------------------------------------------------------------------------
async function auditHitTargets() {
  // A panel that is mid-fade has had its class removed but still covers the
  // page, so checking the class alone reports every deed as blocked.
  const covered = [...document.querySelectorAll('.modal, .studio, .namer')].some(
    (p) => parseFloat(getComputedStyle(p).opacity) > 0.01
  )
  if (covered) return

  // Measuring and hit-testing must happen in the same frame. The marquee moves
  // continuously, so a spot measured in one frame has already shifted by the
  // next, and the probe lands on its neighbour — a false alarm every time.
  const blocked = await new Promise((resolve) =>
    requestAnimationFrame(() => {
      const found = []
      for (const [id, el] of mounted) {
        if (!el.isConnected) continue
        const r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue

        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue

        const hit = document.elementFromPoint(cx, cy)
        const owner = hit?.closest('.spot')
        if (!owner || owner.dataset.spotId !== id) {
          found.push(`${id} is covered by <${hit?.tagName.toLowerCase()} class="${hit?.className}">`)
        }
      }
      resolve(found)
    })
  )

  if (blocked.length) {
    console.warn('[spot] these deeds cannot be clicked:', blocked)
  }
}

if (import.meta.env?.DEV) {
  let queued
  const run = () => {
    clearTimeout(queued)
    queued = setTimeout(auditHitTargets, 400)
  }
  window.addEventListener('scroll', run, { passive: true })
  window.addEventListener('resize', run)
  setTimeout(run, 2500)
}

// dev handle
window.SPOT = { SPOTS, byId, mounted, paint, TIERS, nextPrice, lenis, modal, studio, wallet, sync, auditHitTargets }
