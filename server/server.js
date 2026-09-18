// ---------------------------------------------------------------------------
// SPOT — the shared state server.
//
// Without this, ownership lives in each visitor's browser and everybody sees a
// different wall. This is what makes the page the same for everyone.
//
// It deliberately trusts nothing the browser says about money. A claim is only
// recorded once the transaction has been fetched from the chain and checked:
// right mint, right amounts, the burn is really there, the memo names this
// exact spot, the signer is the buyer, and the signature has not been used
// before.
//
//   node server/server.js
// ---------------------------------------------------------------------------

import express from 'express'
import cors from 'cors'
import multer from 'multer'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Connection, PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddress } from '@solana/spl-token'
import { checkPurchase } from './verify.js'
import nacl from 'tweetnacl'
import bs58 from 'bs58'

import { SPOTS } from '../src/core/spots.js'
import { PROJECT, CHAIN, TIERS, ECONOMY } from '../src/core/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, 'data')
const UPLOAD_DIR = path.join(__dirname, 'uploads')
const STATE_FILE = path.join(DATA_DIR, 'state.json')

const PORT = process.env.PORT || 8787
const MINT = process.env.SPOT_MINT || PROJECT.mint
const DECIMALS = Number(process.env.SPOT_DECIMALS || PROJECT.decimals)
const TREASURY = process.env.SPOT_TREASURY || PROJECT.treasury
const RPC = process.env.SPOT_RPC || CHAIN.rpc

// Which sites may talk to this server. Comma separated, e.g.
//   SPOT_ORIGINS=https://spot.fun,https://www.spot.fun
// Left unset it allows anything, which is only sensible in development.
const ORIGINS = [
  ...(process.env.SPOT_ORIGINS || '').split(','),
  PROJECT.siteUrl || '',
]
  .map((o) => o.trim())
  .filter(Boolean)

// developing against localhost has to keep working even once a real site url
// is set, otherwise the next change you make locally cannot reach the server
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

// Lets you wipe a single spot's picture if you ever have to. Not a moderation
// queue, just a lever that exists for the day somebody posts something you
// are legally obliged to remove.
const ADMIN_TOKEN = process.env.SPOT_ADMIN_TOKEN || null

// With no mint there is nothing to verify against, so the server records what
// it is told. Fine for building the site, never acceptable once real money is
// involved — it refuses to start that way unless explicitly allowed.
const SIMULATION = !MINT

// Simulation accepts any claim without checking the chain, which is right for
// building the site and catastrophic in public: every spot becomes free. The
// giveaway that a server is public is a real origin in SPOT_ORIGINS, so that
// combination is refused outright rather than merely warned about.
if (SIMULATION && process.env.SPOT_ALLOW_SIMULATION === '1') {
  const publicOrigin = (process.env.SPOT_ORIGINS || '')
    .split(',').map((o) => o.trim()).filter(Boolean)
    .find((o) => !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o))
  if (publicOrigin || process.env.NODE_ENV === 'production') {
    const why = publicOrigin || 'NODE_ENV=production'
    console.error(
      [
        '',
        'Refusing to run.',
        `Simulation mode is on, but this looks like a public server (${why}).`,
        'In simulation nothing is verified and every spot can be taken for free.',
        'Set SPOT_MINT=<address> instead.',
        '',
      ].join('\n')
    )
    process.exit(1)
  }
}

if (SIMULATION && process.env.SPOT_ALLOW_SIMULATION !== '1') {
  console.error(
    '\nNo mint configured.\n' +
      'Set SPOT_MINT=<address> to run for real, or SPOT_ALLOW_SIMULATION=1 to\n' +
      'run an unverified server for local development.\n'
  )
  process.exit(1)
}

fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const connection = new Connection(RPC, 'confirmed')
const registry = new Map(SPOTS.map((s) => [s.id, s]))

// --- state ------------------------------------------------------------------

const empty = { spots: {}, names: {}, events: [], usedSignatures: {}, usedNonces: {} }

// How long a spot is held for someone while they sign in their wallet.
const RESERVE_MS = 90_000
let state = empty

try {
  state = { ...empty, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) }
  console.log(`Loaded ${Object.keys(state.spots).length} claimed spots.`)
} catch {
  console.log('Starting with an empty wall.')
}

let saveQueued = false
async function save() {
  if (saveQueued) return
  saveQueued = true
  setTimeout(async () => {
    saveQueued = false
    const tmp = STATE_FILE + '.tmp'
    // write then rename, so a crash mid-write cannot leave a truncated file
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2))
    await fsp.rename(tmp, STATE_FILE)
  }, 120)
}

/** The live view of a spot: its registry definition plus whatever has happened. */
function liveSpot(id) {
  const base = registry.get(id)
  if (!base) return null
  const owned = state.spots[id]
  return {
    id,
    tier: base.tier,
    owner: owned?.owner ?? null,
    lastPrice: owned?.lastPrice ?? null,
    flips: owned?.flips ?? 0,
    media: owned?.media ?? null,
    claimedAt: owned?.claimedAt ?? null,
  }
}

function nextPriceFor(spot) {
  const base = spot.lastPrice ?? TIERS[spot.tier].price
  return spot.owner ? Math.round(base * ECONOMY.FLIP_MULTIPLIER) : base
}

function breakdownFor(spot) {
  const total = nextPriceFor(spot)
  const split = spot.owner ? ECONOMY.split : ECONOMY.primarySplit
  const previousOwner = Math.round(total * (split.previousOwner ?? 0))
  const treasury = TREASURY ? Math.round(total * (split.treasury ?? 0)) : 0
  const burn = total - previousOwner - treasury
  return { total, previousOwner, burn, treasury, isPrimary: !spot.owner }
}

// --- one buyer at a time, per spot ------------------------------------------
// Checking a purchase means a round trip to the chain, and during that wait a
// second buyer can read the same "unclaimed" state and be told they got it
// too. At launch that is not a rare race, it is the normal traffic pattern:
// several people hitting the same spot in the same second, all of them paying.
// Work on a given spot is therefore queued, and the state is re-read inside
// the queue rather than before it.

const spotQueues = new Map()

function withSpotLock(spotId, fn) {
  const previous = spotQueues.get(spotId) ?? Promise.resolve()
  const result = previous.then(fn, fn)
  // the queue must continue whether the last one succeeded or threw
  spotQueues.set(
    spotId,
    result.then(
      () => {},
      () => {}
    )
  )
  return result
}

// --- reservations -----------------------------------------------------------
// A queue stops the state going incoherent, but on its own it still lets two
// people pay for the same spot: both see it at 500K, both sign, and the second
// one's transaction is rejected for having the old price — after their money
// has already burned. So opening the buy sheet holds the spot, and with it the
// price, for as long as it takes to sign. Nobody else can pay for it meanwhile.
//
// It is not airtight: somebody bypassing the site can still send a transaction
// for a spot they never reserved, and they will lose it. Only an on-chain
// program can make that impossible. For anyone using the website, this is what
// stops them paying for something they cannot get.

const reservations = new Map() // spotId -> { buyer, until, price }

function currentReservation(spotId) {
  const r = reservations.get(spotId)
  if (!r) return null
  if (Date.now() > r.until) {
    reservations.delete(spotId)
    return null
  }
  return r
}

function reserve(spotId, buyer, price) {
  const held = currentReservation(spotId)
  if (held && held.buyer !== buyer) {
    return { ok: false, secondsLeft: Math.ceil((held.until - Date.now()) / 1000) }
  }
  const entry = { buyer, until: Date.now() + RESERVE_MS, price }
  reservations.set(spotId, entry)
  return { ok: true, until: entry.until, price }
}

// --- live updates -----------------------------------------------------------

const clients = new Set()

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`
  for (const res of clients) {
    try {
      res.write(payload)
    } catch {
      clients.delete(res)
    }
  }
}

// --- chain verification -----------------------------------------------------
// The decision itself lives in verify.js so it can be tested against fixed
// transactions; this only fetches the one to judge.

async function verifyPurchase({ signature, buyer, spot, expected }) {
  // A transaction the buyer just sent can take a moment to become visible to
  // whichever node we happen to ask. Giving up on the first miss would reject
  // somebody who genuinely paid, so it is worth waiting a few seconds.
  let tx = null
  for (let attempt = 0; attempt < 6 && !tx; attempt++) {
    try {
      tx = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      })
    } catch (err) {
      // a rate limited or flaky node is not the buyer's fault either
      if (attempt === 5) throw err
    }
    if (!tx) await new Promise((r) => setTimeout(r, 1200))
  }

  return checkPurchase(tx, {
    spot,
    expected,
    buyer,
    mint: MINT,
    decimals: DECIMALS,
  })
}

// --- proof of ownership -----------------------------------------------------
// Editing a spot or claiming a name changes something that belongs to
// somebody. Taking the owner's address from the request body would let anyone
// paint over anyone, so the wallet has to sign for it.

const NONCE_WINDOW_MS = 5 * 60 * 1000

/**
 * `consume` marks the nonce spent so the same signature cannot be replayed.
 * The upload step checks the signature but does not spend it, because the
 * owner signs once and that one signature has to carry both the upload and
 * the save that follows it. Uploading is not a state change and already
 * requires owning the spot, so a replay there achieves nothing.
 */
function checkSigned({ address, action, nonce, signature, consume = true }) {
  if (SIMULATION) return { ok: true }

  if (!address || !signature || !nonce) {
    return { ok: false, reason: 'Not signed' }
  }
  const age = Date.now() - Number(nonce)
  if (!Number.isFinite(age) || age > NONCE_WINDOW_MS || age < -60_000) {
    return { ok: false, reason: 'Signature expired, try again' }
  }
  const key = `${address}:${nonce}`
  if (state.usedNonces[key]) return { ok: false, reason: 'Already used' }

  const message = `spot:${action}:${nonce}`
  let valid = false
  try {
    valid = nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      bs58.decode(signature),
      bs58.decode(address)
    )
  } catch {
    return { ok: false, reason: 'Malformed signature' }
  }
  if (!valid) return { ok: false, reason: 'Signature does not match that wallet' }

  if (consume) state.usedNonces[key] = Date.now()
  // keep the replay table from growing without bound
  for (const [k, at] of Object.entries(state.usedNonces)) {
    if (Date.now() - at > NONCE_WINDOW_MS * 2) delete state.usedNonces[k]
  }
  return { ok: true }
}

// --- app --------------------------------------------------------------------

const app = express()

// behind Cloudflare or any proxy, the real client ip is in x-forwarded-for
app.set('trust proxy', 1)

app.use(
  cors({
    origin(origin, cb) {
      if (!ORIGINS.length) return cb(null, true) // nothing configured yet
      if (!origin) return cb(null, true) // curl, server to server
      cb(null, ORIGINS.includes(origin) || LOCAL.test(origin))
    },
  })
)
app.use(express.json({ limit: '256kb' }))

// Uploaded files are arbitrary bytes from strangers. Stopping the browser from
// second-guessing their type is what keeps a file that claims to be a png from
// being run as something else.
app.use(
  '/uploads',
  (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'")
    next()
  },
  express.static(UPLOAD_DIR, { maxAge: '365d', immutable: true })
)

// --- rate limiting ----------------------------------------------------------
// Uploading does not require owning anything yet, so without a cap one person
// with a script can fill the disk. A simple per-address bucket is enough.
function limiter({ windowMs, max, name }) {
  const hits = new Map()
  return (req, res, next) => {
    const now = Date.now()
    const key = req.ip || 'unknown'
    const rec = hits.get(key)

    if (!rec || now - rec.start > windowMs) {
      hits.set(key, { start: now, count: 1 })
    } else if (rec.count >= max) {
      const wait = Math.ceil((windowMs - (now - rec.start)) / 1000)
      return res.status(429).json({ error: `Too many ${name}. Try again in ${wait}s.` })
    } else {
      rec.count++
    }

    // keep the table from growing forever
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k)
    }
    next()
  }
}

const uploadLimit = limiter({ windowMs: 60 * 60 * 1000, max: 40, name: 'uploads' })
const writeLimit = limiter({ windowMs: 60 * 1000, max: 30, name: 'requests' })

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.bin').toLowerCase()
      cb(null, crypto.randomBytes(16).toString('hex') + ext)
    },
  }),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/webm',
    ].includes(file.mimetype)
    cb(ok ? null : new Error('Unsupported file type'), ok)
  },
})

app.get('/state', (req, res) => {
  const spots = {}
  for (const id of registry.keys()) {
    const s = liveSpot(id)
    if (s.owner) spots[id] = s
  }
  res.json({
    spots,
    names: state.names,
    events: state.events.slice(0, 20),
    simulation: SIMULATION,
  })
})

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  res.write(': connected\n\n')
  clients.add(res)

  const ping = setInterval(() => {
    try {
      res.write(': ping\n\n')
    } catch {
      /* the cleanup below handles it */
    }
  }, 25_000)

  req.on('close', () => {
    clearInterval(ping)
    clients.delete(res)
  })
})

/**
 * Only an owner may upload, and only for a spot they hold — which means they
 * paid for it. The proof travels in headers rather than the form body so it
 * can be checked BEFORE multer writes anything to disk; otherwise anyone
 * could fill the drive and be rejected afterwards, which is too late.
 */
function mustOwnASpot(req, res, next) {
  const spotId = req.get('x-spot-id')
  const owner = req.get('x-spot-owner')

  if (!spotId || !owner) {
    return res.status(401).json({ error: 'Uploads are for spot owners' })
  }
  const spot = liveSpot(spotId)
  if (!spot) return res.status(404).json({ error: 'No such spot' })
  if (spot.owner !== owner) {
    return res.status(403).json({ error: 'You do not own that spot' })
  }

  const proof = checkSigned({
    address: owner,
    action: `media:${spotId}`,
    nonce: req.get('x-spot-nonce'),
    signature: req.get('x-spot-signature'),
    consume: false, // the save that follows needs the same signature
  })
  if (!proof.ok) return res.status(401).json({ error: proof.reason })

  next()
}

app.post('/upload', uploadLimit, mustOwnASpot, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' })
  res.json({ url: `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}` })
})

app.post('/reserve', writeLimit, (req, res) => {
  const { spotId, buyer } = req.body || {}
  if (!registry.has(spotId)) return res.status(404).json({ error: 'No such spot' })
  if (!buyer) return res.status(400).json({ error: 'Missing buyer' })

  const spot = liveSpot(spotId)
  if (spot.owner === buyer) return res.status(400).json({ error: 'You already own it' })

  const price = breakdownFor(spot).total
  const held = reserve(spotId, buyer, price)
  if (!held.ok) {
    return res.status(409).json({
      error: `Someone is buying this right now. Try again in ${held.secondsLeft}s.`,
      secondsLeft: held.secondsLeft,
    })
  }
  res.json({ ok: true, until: held.until, price, holdSeconds: Math.round(RESERVE_MS / 1000) })
})

app.post('/release', (req, res) => {
  const { spotId, buyer } = req.body || {}
  const held = currentReservation(spotId)
  if (held && held.buyer === buyer) reservations.delete(spotId)
  res.json({ ok: true })
})

// Media must be a file THIS server is hosting.
//
// The old guard was `src.includes('/uploads/')`, which
// `https://evil.example/uploads/x.gif` satisfies happily. A remote url lets an
// owner swap the picture after the fact without buying again, and logs every
// visitor's IP to a third party. So the url is parsed, not pattern-matched:
// the filename must be one of ours, and the host must be us.
const UPLOAD_NAME = /^[A-Za-z0-9._-]{1,128}$/

function localMedia(src, host) {
  if (src == null || src === '') return { ok: true, src: null }
  if (typeof src !== 'string' || src.length > 512) return { ok: false, reason: 'Bad media' }
  const bad = { ok: false, reason: 'Media must be uploaded here first' }

  let path
  if (src.startsWith('//')) return bad          // protocol-relative, points elsewhere
  if (src.startsWith('/')) {
    path = src                                   // relative to us, fine
  } else {
    let u
    try { u = new URL(src) } catch { return bad }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return bad
    // only our own host; anything else is somebody else's server
    if (!host || u.host !== host) return bad
    if (u.search || u.hash) return bad
    path = u.pathname
  }

  const m = /^\/uploads\/([^/]+)$/.exec(path)
  if (!m) return bad
  const name = decodeURIComponent(m[1])
  if (!UPLOAD_NAME.test(name) || name === '.' || name === '..') return bad

  // stored canonically, so what comes back out is never what was sent in
  return { ok: true, src: `/uploads/${name}` }
}

// Takeovers are the whole mechanic here, so pictures get replaced constantly.
// Nothing used to delete the old file, so the uploads folder only ever grew -
// and a full disk breaks writes to state.json, which is who owns what.
async function dropUpload(src, keepFor = null) {
  if (!src) return
  const m = /^\/uploads\/([A-Za-z0-9._-]+)$/.exec(src)
  if (!m) return
  // never delete something another spot is still showing
  const stillUsed = Object.entries(state.spots).some(
    ([id, v]) => id !== keepFor && v?.media?.src === src
  )
  if (stillUsed) return
  try {
    await fsp.unlink(path.join(UPLOAD_DIR, m[1]))
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('could not remove ' + src + ': ' + err.message)
  }
}

// A sweep for whatever the above misses: a crash mid-upload, a file left by an
// abandoned claim, rows edited by hand. Runs at boot and once a day.
async function sweepUploads() {
  let files
  try { files = await fsp.readdir(UPLOAD_DIR) } catch { return }
  const kept = new Set(
    Object.values(state.spots)
      .map((v) => v?.media?.src)
      .filter(Boolean)
      .map((src) => src.replace('/uploads/', ''))
  )
  let removed = 0
  for (const f of files) {
    if (kept.has(f)) continue
    try {
      // leave very recent files alone, an upload may be mid-claim
      const st = await fsp.stat(path.join(UPLOAD_DIR, f))
      if (Date.now() - st.mtimeMs < 60 * 60 * 1000) continue
      await fsp.unlink(path.join(UPLOAD_DIR, f))
      removed++
    } catch {}
  }
  if (removed) console.log('swept ' + removed + ' orphaned upload(s).')
}

app.post('/claim', writeLimit, async (req, res) => {
  const { spotId, signature, buyer, mediaUrl } = req.body || {}

  if (!registry.has(spotId)) return res.status(404).json({ error: 'No such spot' })
  if (!buyer) return res.status(400).json({ error: 'Missing buyer' })
  const okMedia = localMedia(mediaUrl, req.get('host'))
  if (!okMedia.ok) return res.status(400).json({ error: okMedia.reason })

  try {
    await withSpotLock(spotId, () => handleClaim({ spotId, signature, buyer, mediaSrc: okMedia.src, res }))
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message })
  }
})

async function handleClaim({ spotId, signature, buyer, mediaSrc, res }) {
  // read the spot inside the queue: whatever happened while we waited counts
  const spot = liveSpot(spotId)

  // Somebody else holding it means this buyer was never going to get it. Say so
  // before their transaction is checked, not after they have already paid.
  const held = currentReservation(spotId)
  if (held && held.buyer !== buyer) {
    return res.status(409).json({
      error: `Someone else is buying this one. Try again in ${Math.ceil((held.until - Date.now()) / 1000)}s.`,
    })
  }

  if (!SIMULATION) {
    if (!signature) return res.status(400).json({ error: 'Missing signature' })
    if (state.usedSignatures[signature]) {
      return res.status(409).json({ error: 'That transaction was already used' })
    }
  }

  const expected = breakdownFor(spot)

  if (!SIMULATION) {
    let check
    try {
      check = await verifyPurchase({ signature, buyer, spot, expected })
    } catch (err) {
      return res.status(502).json({ error: 'Could not read the chain: ' + err.message })
    }
    if (!check.ok) return res.status(400).json({ error: check.reason })
    state.usedSignatures[signature] = { spotId, at: Date.now() }
  }

  const previous = spot.owner

  // A takeover hands over the frame, not the contents. Inheriting the last
  // owner's picture would leave the new owner advertising the person they
  // just took it from, link and all. They put their own thing in it.
  const media = mediaSrc ? { type: 'image', src: mediaSrc } : null

  state.spots[spotId] = {
    owner: buyer,
    lastPrice: expected.total,
    flips: (spot.flips || 0) + 1,
    media,
    claimedAt: Date.now(),
  }

  const event = {
    kind: previous ? 'flip' : 'claim',
    spot: spotId,
    buyer,
    from: previous,
    amount: expected.total,
    burned: expected.burn,
    signature: signature ?? null,
    at: Date.now(),
  }
  state.events.unshift(event)
  state.events = state.events.slice(0, 200)

  reservations.delete(spotId)

  await save()
  broadcast({ type: 'claim', spot: liveSpot(spotId), event })
  res.json({ ok: true, spot: liveSpot(spotId) })
}

// Changing the picture on a spot you already own.
app.post('/media', writeLimit, async (req, res) => {
  const { spotId, owner, media, nonce, signature } = req.body || {}
  const spot = liveSpot(spotId)
  if (!spot) return res.status(404).json({ error: 'No such spot' })
  if (!spot.owner || spot.owner !== owner) {
    return res.status(403).json({ error: 'You do not own that spot' })
  }

  const proof = checkSigned({
    address: owner,
    action: `media:${spotId}`,
    nonce,
    signature,
  })
  if (!proof.ok) return res.status(401).json({ error: proof.reason })
  if (!media?.src || typeof media.src !== 'string') {
    return res.status(400).json({ error: 'Bad media' })
  }
  const okSrc = localMedia(media.src, req.get('host'))
  if (!okSrc.ok || !okSrc.src) {
    return res.status(400).json({ error: okSrc.reason || 'Media must be uploaded here first' })
  }

  // Rebuilt field by field rather than stored as sent: the client does not get
  // to decide what keys live on a spot. This is what stops a crafted request
  // re-introducing media.href after the link feature was removed.
  const previousSrc = state.spots[spotId].media?.src ?? null
  state.spots[spotId].media = {
    type: media.type === 'video' ? 'video' : 'image',
    src: okSrc.src,
    ...(media.alt ? { alt: String(media.alt).slice(0, 64) } : {}),
    ...(media.focus && typeof media.focus === 'object'
      ? { focus: { x: Number(media.focus.x) || 0, y: Number(media.focus.y) || 0 } }
      : {}),
  }
  await save()
  if (previousSrc && previousSrc !== okSrc.src) await dropUpload(previousSrc, spotId)
  broadcast({ type: 'media', spot: liveSpot(spotId) })
  res.json({ ok: true, spot: liveSpot(spotId) })
})

app.post('/name', writeLimit, async (req, res) => {
  const { address, name, nonce, signature } = req.body || {}
  if (!address) return res.status(400).json({ error: 'Missing address' })

  const proof = checkSigned({ address, action: 'name', nonce, signature })
  if (!proof.ok) return res.status(401).json({ error: proof.reason })

  const clean = String(name ?? '').trim()
  if (clean.length > 18) return res.status(400).json({ error: 'Too long' })
  if (clean && !/^[\p{L}\p{N} _.\-]+$/u.test(clean)) {
    return res.status(400).json({ error: 'Bad characters' })
  }
  // one name per person
  const taken = Object.entries(state.names).find(
    ([addr, n]) => n.toLowerCase() === clean.toLowerCase() && addr !== address
  )
  if (clean && taken) return res.status(409).json({ error: 'That name is taken' })

  if (clean) state.names[address] = clean
  else delete state.names[address]

  await save()
  broadcast({ type: 'name', address, name: clean })
  res.json({ ok: true, name: clean })
})

// Blank a spot's picture. The owner keeps the spot; only the contents go.
app.post('/admin/clear', async (req, res) => {
  if (!ADMIN_TOKEN) return res.status(404).json({ error: 'Not enabled' })
  if (req.get('x-admin-token') !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Nope' })
  }
  const { spotId } = req.body || {}
  if (!state.spots[spotId]) return res.status(404).json({ error: 'Not claimed' })

  const clearedSrc = state.spots[spotId].media?.src ?? null
  state.spots[spotId].media = null
  await save()
  if (clearedSrc) await dropUpload(clearedSrc, spotId)
  broadcast({ type: 'media', spot: liveSpot(spotId) })
  res.json({ ok: true, spot: liveSpot(spotId) })
})

app.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || 'Bad request' })
})

async function flush() {
  // the debounced save may still be pending when a deploy stops the process
  const tmp = STATE_FILE + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify(state, null, 2))
  await fsp.rename(tmp, STATE_FILE)
}

sweepUploads()
setInterval(sweepUploads, 24 * 60 * 60 * 1000).unref()

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    console.log(`
${sig} — saving state before exit.`)
    try {
      await flush()
    } catch (err) {
      console.error('Could not save state:', err.message)
    }
    process.exit(0)
  })
}

app.listen(PORT, () => {
  console.log(`\nSPOT server on http://localhost:${PORT}`)
  console.log(`  mint     ${MINT || '(none — simulation)'}`)
  console.log(`  rpc      ${RPC}`)
  console.log(`  mode     ${SIMULATION ? 'SIMULATION, nothing is verified' : 'verifying every claim on chain'}`)
  console.log(`  origins  ${ORIGINS.length ? ORIGINS.join(', ') : 'ANY (set SPOT_ORIGINS before going public)'}`)

  if (!SIMULATION && /api\.(mainnet-beta|devnet)\.solana\.com/.test(RPC)) {
    console.log('')
    console.log('  !! You are on the free public Solana endpoint.')
    console.log('  !! It is rate limited and WILL start refusing requests as soon as')
    console.log('  !! more than a handful of people use the site at once. Purchases')
    console.log('  !! will fail. Get a free key from helius.dev or quicknode.com and')
    console.log('  !! set SPOT_RPC before you tell anybody the address.')
  }
  console.log(`\nPoint the site at it with VITE_SPOT_API=http://localhost:${PORT}\n`)
})
