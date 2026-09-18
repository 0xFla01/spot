// ---------------------------------------------------------------------------
// Shared state. With a server configured the wall is the same for everyone:
// ownership comes from the server, and changes arrive live over SSE.
//
// With no server the whole module no-ops and the site runs on local demo
// state, which is what happens during design work.
// ---------------------------------------------------------------------------

import { byId } from './spots.js'
import { hydrate as hydrateNames } from './profiles.js'
import { signAction } from '../chain/wallet.js'

export const API = import.meta.env?.VITE_SPOT_API || null

/**
 * Uploads are stored as a bare path (`/uploads/x.webp`) rather than a full url,
 * so the records survive a change of domain and cannot name somebody else's
 * host. The path is relative to the API, not to the page, so it has to be
 * resolved here. Anything already absolute is left alone.
 */
export function resolveMedia(src) {
  if (!src) return src
  if (!src.startsWith('/')) return src
  return API ? API.replace(/\/$/, '') + src : src
}

export function isLive() {
  return Boolean(API)
}

/** Copy a server's view of a spot onto the local registry entry. */
export function applyServerSpot(data) {
  const spot = byId.get(data.id)
  if (!spot) return null
  spot.owner = data.owner ?? null
  spot.lastPrice = data.lastPrice ?? null
  spot.flips = data.flips ?? 0
  spot.media = data.media ?? null
  spot.claimedAt = data.claimedAt ?? null
  return spot
}

/**
 * Load the wall as it currently stands. Returns the recent events so the
 * ledger can start with real history instead of invented rows.
 */
export async function hydrate() {
  if (!API) return { spots: [], events: [], simulation: true }

  const res = await fetch(`${API}/state`)
  if (!res.ok) throw new Error('Could not load the wall: ' + res.status)
  const json = await res.json()

  const touched = []
  for (const data of Object.values(json.spots || {})) {
    const spot = applyServerSpot(data)
    if (spot) touched.push(spot)
  }
  if (json.names) hydrateNames(json.names)

  return { spots: touched, events: json.events || [], simulation: json.simulation }
}

/**
 * Listen for everyone else's activity. Reconnects on its own — EventSource
 * retries, but a server restart can leave a dead stream, so it is watched.
 */
export function subscribe(handlers = {}) {
  if (!API) return () => {}

  let source = null
  let closed = false
  let retry = 1000

  const open = () => {
    if (closed) return
    source = new EventSource(`${API}/events`)

    source.onopen = () => {
      retry = 1000
    }

    source.onmessage = (e) => {
      let msg
      try {
        msg = JSON.parse(e.data)
      } catch {
        return
      }
      if (msg.type === 'claim') {
        const spot = applyServerSpot(msg.spot)
        if (spot) handlers.onClaim?.(spot, msg.event)
      } else if (msg.type === 'media') {
        const spot = applyServerSpot(msg.spot)
        if (spot) handlers.onMedia?.(spot)
      } else if (msg.type === 'name') {
        handlers.onName?.(msg.address, msg.name)
      }
    }

    source.onerror = () => {
      source?.close()
      if (closed) return
      setTimeout(open, retry)
      retry = Math.min(retry * 2, 15_000)
    }
  }

  open()
  return () => {
    closed = true
    source?.close()
  }
}

/**
 * Hold a spot while the buyer signs. Returns { ok } or { ok: false, error }.
 * Without this two people can pay for the same spot and only one can have it.
 */
export async function hold(spot, buyer) {
  if (!API) return { ok: true, local: true }
  try {
    const res = await fetch(`${API}/reserve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotId: spot.id, buyer }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok) return { ok: true, ...json }
    // A stopped state server does NOT land in the catch below: nginx is still
    // up, so it answers with a served 502 and an HTML body. That is the same
    // situation as unreachable, so treat it the same way instead of blocking
    // the flow with an error the server never actually sent.
    if (res.status >= 500) return { ok: true, offline: true }
    // a 4xx is a real, deliberate refusal - somebody else holds this spot
    return { ok: false, error: json.error || 'That spot is not available right now.' }
  } catch {
    // the server being unreachable is not a reason to block; the claim will fail
    return { ok: true, offline: true }
  }
}

/** Let go of a hold when the buyer walks away. */
export function release(spot, buyer) {
  if (!API || !spot) return
  // keepalive so it still sends if the tab is closing
  try {
    fetch(`${API}/release`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spotId: spot.id, buyer }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* nothing to do */
  }
}

/** Record a purchase. The server re-checks the transaction before it counts. */
export async function claim({ spot, signature, buyer, mediaUrl }) {
  if (!API) return { local: true }

  const res = await fetch(`${API}/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spotId: spot.id, signature, buyer, mediaUrl }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Claim rejected')
  if (json.spot) applyServerSpot(json.spot)
  return json
}

/** Change the picture on a spot you already own. */
export async function saveMedia({ spot, owner, media, auth }) {
  if (!API) return { local: true }

  // the server will not take our word for who we are. Reuse the signature the
  // studio already collected rather than prompting the wallet a second time.
  const { nonce, signature } = auth ?? (await signAction(`media:${spot.id}`))

  const res = await fetch(`${API}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spotId: spot.id, owner, media, nonce, signature }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Could not save that')
  if (json.spot) applyServerSpot(json.spot)
  return json
}
