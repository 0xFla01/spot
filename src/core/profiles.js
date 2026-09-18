// ---------------------------------------------------------------------------
// Names. Nobody wants to be "7xKq..9fPa" on a wall they paid for.
//
// A name is attached to a wallet address. Stored locally for now; the same
// functions post to the backend the moment one is configured, so the display
// layer never has to change.
// ---------------------------------------------------------------------------

import { shortAddr } from './config.js'

const KEY = 'spot.names.v1'

let names = {}
try {
  names = JSON.parse(localStorage.getItem(KEY) || '{}')
} catch {
  names = {}
}

const listeners = new Set()
export function onNames(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
function emit() {
  listeners.forEach((fn) => fn(names))
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(names))
  } catch {
    // private mode, a full disk — a name is not worth breaking the page over
  }
}

/** What to show for an address anywhere on the site. */
export function displayName(address) {
  if (!address) return '—'
  const n = names[address]
  return n ? n : shortAddr(address)
}

export function hasName(address) {
  return Boolean(address && names[address])
}

export function rawName(address) {
  return address ? (names[address] ?? '') : ''
}

const BAD = /[^\p{L}\p{N} _.\-]/u

export function validateName(name) {
  const v = name.trim()
  if (v.length === 0) return { ok: true, value: '' } // clearing is allowed
  if (v.length < 2) return { ok: false, error: 'At least 2 characters' }
  if (v.length > 18) return { ok: false, error: 'Keep it under 18 characters' }
  if (BAD.test(v)) return { ok: false, error: 'Letters, numbers, spaces, . _ - only' }
  return { ok: true, value: v }
}

export async function setName(address, name) {
  const check = validateName(name)
  if (!check.ok) throw new Error(check.error)

  if (check.value) names[address] = check.value
  else delete names[address]

  persist()
  emit()

  const endpoint = import.meta.env?.VITE_SPOT_API
  if (endpoint) {
    // the server is the one that can stop two people taking the same name,
    // and it needs proof the wallet actually asked for it
    const { signAction } = await import('../chain/wallet.js')
    const { nonce, signature } = await signAction('name')

    const res = await fetch(`${endpoint}/name`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, name: check.value, nonce, signature }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      // put the local copy back so the UI does not lie about what was saved
      delete names[address]
      persist()
      emit()
      throw new Error(err.error || 'Could not save that name')
    }
  }
  return check.value
}

/** Seed names from the backend (or from demo data). */
export function hydrate(map) {
  names = { ...map, ...names } // anything set locally wins
  emit()
}
