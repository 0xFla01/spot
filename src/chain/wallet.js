// ---------------------------------------------------------------------------
// Phantom. Connect, read the $SPOT balance, tell the rest of the page about it.
//
// Everything here degrades quietly: no Phantom installed, no mint configured,
// or a dead RPC must never stop the site from rendering.
// ---------------------------------------------------------------------------

import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import bs58 from 'bs58'
import { PROJECT, CHAIN } from '../core/config.js'

export const wallet = {
  provider: null,
  address: null,
  balance: 0, // whole tokens
  connecting: false,
}

const listeners = new Set()
export function onWallet(fn) {
  listeners.add(fn)
  fn(wallet)
  return () => listeners.delete(fn)
}
function emit() {
  listeners.forEach((fn) => fn(wallet))
}

let connection = null
export function rpc() {
  if (!connection) {
    if (PROJECT.mint && /api\.(mainnet-beta|devnet)\.solana\.com/.test(CHAIN.rpc)) {
      console.warn(
        '[spot] Using the free public Solana endpoint. It is rate limited and ' +
          'will fail under real traffic. Set VITE_SPOT_RPC to a Helius or ' +
          'QuickNode url before launch.'
      )
    }
    connection = new Connection(CHAIN.rpc, 'confirmed')
  }
  return connection
}

export function getProvider() {
  const p = window.phantom?.solana ?? window.solana
  return p?.isPhantom ? p : null
}

export function hasPhantom() {
  return Boolean(getProvider())
}

// --- connect ---------------------------------------------------------------

export async function connect({ silent = false } = {}) {
  const provider = getProvider()
  if (!provider) {
    if (!silent) window.open('https://phantom.app/', '_blank', 'noopener')
    throw new Error('Phantom not found')
  }

  wallet.connecting = true
  emit()
  try {
    const res = await provider.connect(silent ? { onlyIfTrusted: true } : undefined)
    wallet.provider = provider
    wallet.address = res.publicKey.toBase58()

    provider.removeAllListeners?.('disconnect')
    provider.on?.('disconnect', () => {
      wallet.provider = null
      wallet.address = null
      wallet.balance = 0
      emit()
    })
    provider.on?.('accountChanged', (pk) => {
      wallet.address = pk ? pk.toBase58() : null
      emit()
      refreshBalance()
    })

    emit()
    refreshBalance()
    return wallet.address
  } finally {
    wallet.connecting = false
    emit()
  }
}

// reconnect without a prompt if this browser already trusts the site
export async function autoConnect() {
  try {
    await connect({ silent: true })
  } catch {
    /* not trusted yet, that is fine */
  }
}

export async function disconnect() {
  try {
    await getProvider()?.disconnect()
  } catch {
    /* ignore */
  }
  wallet.provider = null
  wallet.address = null
  wallet.balance = 0
  emit()
}

// --- balance ---------------------------------------------------------------

export async function refreshBalance() {
  if (!wallet.address || !PROJECT.mint) {
    wallet.balance = 0
    emit()
    return 0
  }
  try {
    const owner = new PublicKey(wallet.address)
    const mint = new PublicKey(PROJECT.mint)
    const ata = await getAssociatedTokenAddress(mint, owner, false, new PublicKey(PROJECT.tokenProgram))
    const res = await rpc().getTokenAccountBalance(ata)
    wallet.balance = Number(res.value.uiAmount ?? 0)
  } catch {
    // no token account yet means a zero balance, not an error worth showing
    wallet.balance = 0
  }
  emit()
  return wallet.balance
}

/**
 * Prove this wallet authorised something, without spending anything.
 * The server checks the signature before it lets you edit a spot or take a
 * name, so nobody can paint over someone else's picture by guessing their
 * address. Returns nulls when there is no wallet, which the server only
 * accepts while it is running in simulation.
 */
export async function signAction(action) {
  const nonce = String(Date.now())
  if (!wallet.provider || !wallet.address) return { nonce, signature: null }

  const message = new TextEncoder().encode(`spot:${action}:${nonce}`)
  const res = await wallet.provider.signMessage(message, 'utf8')
  const raw = res?.signature ?? res
  return { nonce, signature: bs58.encode(raw) }
}

export function canAfford(amount) {
  // with no mint configured the site is in simulation, so never block the flow
  if (!PROJECT.mint) return true
  return wallet.balance >= amount
}
