// ---------------------------------------------------------------------------
// The claim / takeover sheet. Shows exactly where the money goes, then makes
// it happen: one transaction, signed once, that pays out and burns.
// ---------------------------------------------------------------------------

import { byId } from './spots.js'
import {
  TIERS,
  ECONOMY,
  PROJECT,
  priceBreakdown,
  nextPrice,
  fmt,
  fmtUsd,
} from './config.js'
import { displayName } from './profiles.js'
import { wallet, onWallet, connect, canAfford, hasPhantom } from '../chain/wallet.js'
import { sendPurchase, explorerUrl } from '../chain/pay.js'
import * as sync from './sync.js'

let current = null

// A stable id for this visitor, so a hold survives reopening the sheet and the
// server can tell "me again" from "someone else".
let guestId = null
function buyerId() {
  if (wallet.address) return wallet.address
  if (!guestId) {
    try {
      guestId = localStorage.getItem('spot.guest')
    } catch {
      /* private mode */
    }
    if (!guestId) {
      guestId = 'sim' + Math.random().toString(36).slice(2, 12)
      try {
        localStorage.setItem('spot.guest', guestId)
      } catch {
        /* fine, it just will not persist */
      }
    }
  }
  return guestId
}

export function initModal({ onPurchased, onEdit } = {}) {
  const modal = document.getElementById('modal')
  if (!modal) return { open: () => {}, close: () => {} }

  const m = (k) => modal.querySelector(`[data-m="${k}"]`)
  const buy = m('buy')
  const edit = m('edit')
  const line = m('wallet')

  let busy = false

  function close() {
    // let go of the hold so the next person is not locked out for 90s
    if (current && !current.owner) sync.release(current, buyerId())
    else if (current) sync.release(current, buyerId())
    modal.classList.remove('is-open')
    document.body.classList.remove('panel-open')
    current = null
  }

  // closing the tab mid-purchase should not hold the spot either
  window.addEventListener('pagehide', () => {
    if (current) sync.release(current, buyerId())
  })

  modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', close))
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !busy) close()
  })

  // --- what the buttons say, given the wallet and the spot ---------------
  function refreshActions() {
    if (!current) return
    const spot = current
    const price = nextPrice(spot)
    const isMine = wallet.address && spot.owner === wallet.address

    edit.hidden = !isMine
    buy.hidden = isMine

    if (isMine) {
      line.textContent = 'You own this one.'
      line.dataset.kind = 'ok'
      return
    }

    if (busy) {
      buy.querySelector('span').textContent = 'Confirm in Phantom…'
      buy.disabled = true
      return
    }

    buy.disabled = false

    if (!wallet.address) {
      // before the token exists there is nothing to pay with, so let people
      // walk the whole flow and see what it does
      if (!PROJECT.mint) {
        buy.querySelector('span').textContent = spot.owner
          ? `Take for ${fmt(price)}`
          : `Claim for ${fmt(price)}`
        line.textContent = `Simulation. ${PROJECT.ticker} is not launched yet, nothing is charged.`
        line.dataset.kind = ''
        return
      }
      buy.querySelector('span').textContent = hasPhantom() ? 'Connect wallet' : 'Get Phantom'
      line.textContent = `Payable only in ${PROJECT.ticker}.`
      line.dataset.kind = ''
      return
    }

    const afford = canAfford(price)
    buy.querySelector('span').textContent = spot.owner
      ? `Take for ${fmt(price)}`
      : `Claim for ${fmt(price)}`
    buy.disabled = !afford

    if (!afford) {
      const short = price - wallet.balance
      line.textContent = `Not enough. You need ${fmt(short)} more ${PROJECT.ticker}.`
      line.dataset.kind = 'bad'
    } else {
      line.textContent = `Balance ${fmt(wallet.balance)} ${PROJECT.ticker}`
      line.dataset.kind = ''
    }
  }

  onWallet(refreshActions)

  // --- open ---------------------------------------------------------------
  function open(id) {
    const spot = byId.get(id)
    if (!spot) return
    current = spot
    busy = false

    const tier = TIERS[spot.tier]
    const b = priceBreakdown(spot)

    m('id').textContent = spot.id
    m('tier').textContent = `${tier.label} — ${tier.media.join(' / ')}`
    m('price').textContent = `${fmt(b.total)}`
    m('price').nextElementSibling.textContent = `${PROJECT.ticker} · ${fmtUsd(b.total)}`

    // [label, value, isAmount, hot]
    const rows = []
    if (b.isPrimary) {
      rows.push(['Burned forever', fmt(b.burn), true, 'burn'])
      rows.push(['Status', 'Never claimed', false])
    } else {
      rows.push([`To ${displayName(spot.owner)}`, fmt(b.previousOwner), true])
      rows.push(['Burned forever', fmt(b.burn), true, 'burn'])
      if (b.treasury > 0) rows.push(['Treasury', fmt(b.treasury), true])
      rows.push(['Times flipped', String(spot.flips), false])
    }
    rows.push(['Next buyout', fmt(Math.round(b.total * ECONOMY.FLIP_MULTIPLIER)), true])

    m('rows').innerHTML = rows
      .map(
        ([k, v, isAmount, hot]) =>
          `<div class="modal__row"${hot ? ` data-hot="${hot}"` : ''}>` +
          `<span>${k}</span><b>${v}${isAmount ? ' ' + PROJECT.ticker : ''}</b></div>`
      )
      .join('')

    const nextOut = fmt(Math.round(b.total * ECONOMY.FLIP_MULTIPLIER))
    m('note').textContent = b.isPrimary
      ? `First claim. Every token you pay is burned on settlement, so nobody receives it. After this, anyone can take ${spot.id} from you for ${nextOut} ${PROJECT.ticker}, and 95% of that comes to you.`
      : `Forced buyout. ${displayName(spot.owner)} cannot refuse, and walks away with ${fmt(b.previousOwner)} ${PROJECT.ticker}, a ${(ECONOMY.FLIP_MULTIPLIER * ECONOMY.split.previousOwner).toFixed(2)}x return on what they paid.`

    refreshActions()
    modal.classList.add('is-open')
    document.body.classList.add('panel-open')

    // hold it while they decide, so nobody else pays for the same spot
    if (sync.isLive() && spot.owner !== buyerId()) {
      sync.hold(spot, buyerId()).then((held) => {
        if (current !== spot) return
        if (!held.ok) {
          buy.disabled = true
          // a refusal with no message would read as a dead button
          line.textContent = held.error || 'That spot is not available right now.'
          line.dataset.kind = 'bad'
        }
      })
    }
  }

  // --- buy ----------------------------------------------------------------
  buy.addEventListener('click', async () => {
    if (!current || busy) return

    // only demand a wallet when there is a real token to move
    if (!wallet.address && PROJECT.mint) {
      try {
        await connect()
      } catch {
        line.textContent = 'Phantom did not connect.'
        line.dataset.kind = 'bad'
      }
      refreshActions()
      return
    }

    const spot = current
    busy = true
    refreshActions()

    try {
      let signature = null

      if (PROJECT.mint) {
        const res = await sendPurchase(spot)
        signature = res.signature
        line.innerHTML = `Burned and settled. <a href="${explorerUrl(signature)}" target="_blank" rel="noopener">View transaction</a>`
        line.dataset.kind = 'ok'
      } else {
        await new Promise((r) => setTimeout(r, 400))
        line.textContent = 'Simulated. Nothing was charged.'
        line.dataset.kind = 'ok'
      }

      // The server re-checks the transaction and is what makes the change real
      // for everybody else. If it refuses, the purchase does not count here
      // either, however convincing the local state would look.
      let applied = false
      if (sync.isLive()) {
        line.textContent = 'Recording…'
        await sync.claim({ spot, signature, buyer: buyerId() })
        applied = true
      }

      busy = false
      onPurchased?.(spot, { signature, applied })
      close()
      onEdit?.(spot, { justBought: true })
    } catch (err) {
      busy = false
      const msg = String(err?.message || err)
      line.textContent = /User rejected|rejected the request/i.test(msg)
        ? 'You rejected the transaction.'
        : msg.slice(0, 120)
      line.dataset.kind = 'bad'
      refreshActions()
    }
  })

  edit.addEventListener('click', () => {
    const spot = current
    close()
    onEdit?.(spot, { justBought: false })
  })

  // Clicking a deed normally opens the buy sheet. But an owner who set a link
  // is paying for the click-through, so on a linked spot the click follows the
  // link instead, and the price chip becomes the way to take it. Reveal mode
  // is the shopping mode, so there every click opens the sheet.
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.spot')
    if (!el) return

    const wantsToBuy =
      e.target.closest('.spot__tag') || document.body.classList.contains('reveal')

    open(el.dataset.spotId)
  })
  document.addEventListener('spot:open', (e) => open(e.detail.id))

  return {
    open,
    close,
    get current() {
      return current
    },
  }
}
