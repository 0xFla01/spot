// Live ledger. Mock events now; the same render function takes chain logs later.

import gsap from 'gsap'
import { SPOTS } from './spots.js'
import { TIERS, fmt, PROJECT } from './config.js'
import { displayName } from './profiles.js'
import { isLive } from './sync.js'
import { mockWallet } from './mockmedia.js'

const list = () => document.getElementById('feed-list')

function ago(ms) {
  const s = Math.floor(ms / 1000)
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  return Math.floor(s / 3600) + 'h ago'
}

function row(ev) {
  const el = document.createElement('div')
  el.className = 'feed__row'
  el.dataset.kind = ev.kind

  const what =
    ev.kind === 'claim'
      ? `<b>${displayName(ev.buyer)}</b> claimed <span class="tag">${ev.spot}</span> · burned`
      : `<b>${displayName(ev.buyer)}</b> took <span class="tag">${ev.spot}</span> from <b>${displayName(ev.from)}</b>`

  el.innerHTML = `
    <span class="feed__time">${ago(Date.now() - ev.at)}</span>
    <span class="feed__what">${what}</span>
    <span class="feed__amt">${fmt(ev.amount)} ${PROJECT.ticker}</span>
  `
  return el
}

function randomEvent(at) {
  const spot = SPOTS[Math.floor(Math.random() * SPOTS.length)]
  const flip = Math.random() > 0.45
  const base = TIERS[spot.tier].price
  return {
    kind: flip ? 'flip' : 'claim',
    spot: spot.id,
    buyer: mockWallet(spot.id + at),
    from: flip ? mockWallet(spot.id) : null,
    amount: flip ? Math.round(base * 1.5) : base,
    at,
  }
}

/** Put a real event at the top of the ledger. */
export function pushEvent(ev) {
  const host = list()
  if (!host) return
  host.querySelector('.feed__row--empty')?.remove()
  const el = row(ev)
  host.prepend(el)
  gsap.from(el, { height: 0, opacity: 0, duration: 0.5, ease: 'power3.out' })
  while (host.children.length > 8) host.lastElementChild.remove()
}

export function initFeed() {
  const host = list()
  if (!host) return

  // Once there is a server the ledger shows what actually happened. Inventing
  // rows next to real ones would make the whole thing untrustworthy.
  if (isLive()) {
    host.innerHTML =
      '<div class="feed__row feed__row--empty"><span class="feed__time"></span>' +
      '<span class="feed__what">Nothing has been claimed yet. Be first.</span>' +
      '<span class="feed__amt"></span></div>'
    return
  }

  const now = Date.now()
  for (let i = 0; i < 7; i++) {
    host.append(row(randomEvent(now - (i + 1) * 1000 * 60 * (3 + i * 4))))
  }

  setInterval(() => {
    const el = row(randomEvent(Date.now()))
    host.prepend(el)
    gsap.from(el, { height: 0, opacity: 0, duration: 0.5, ease: 'power3.out' })
    while (host.children.length > 8) host.lastElementChild.remove()
  }, 5200)
}
