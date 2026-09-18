// ---------------------------------------------------------------------------
// The studio. Where an owner puts something in their frame: drop a file,
// drag it into place, zoom, save. The preview is the real shape of the deed,
// so what you see is what the page will show.
// ---------------------------------------------------------------------------

import gsap from 'gsap'
import { TIERS, acceptAttr, allowsAnimation, MEDIA } from './config.js'
import {
  validate,
  readAsDataUrl,
  loadImage,
  renderCrop,
  canvasToBlob,
  uploadMedia,
  coverScale,
  rotatedBox,
  probeVideo,
} from './upload.js'

let els = null
let state = null

function q(sel) {
  return els.root.querySelector(sel)
}

function setRotateEnabled(on) {
  q('[data-st="rotate"]').disabled = !on
  els.root.querySelectorAll('[data-st-turn]').forEach((b) => (b.disabled = !on))
}

function setRotation(deg) {
  if (!state?.img) return
  // normalise into (-180, 180] so two right turns read as 180, not -180
  let d = ((deg % 360) + 360) % 360
  if (d > 180) d -= 360
  state.view.rot = d
  q('[data-st="rotate"]').value = String(d)
  q('[data-st="rotdeg"]').textContent = Math.round(d) + '°'
  clampPan()
  applyView()
}

function setStatus(msg, kind = '') {
  const el = q('[data-st="status"]')
  el.textContent = msg || ''
  el.dataset.kind = kind
}

function layerSize() {
  const { frameW, frameH, view } = state
  const iw = state.img.naturalWidth
  const ih = state.img.naturalHeight
  const cover = coverScale(iw, ih, frameW, frameH, view.rot)
  return { w: iw * cover * view.scale, h: ih * cover * view.scale }
}

function applyView() {
  if (!state?.img) return
  const { w, h } = layerSize()
  gsap.set(els.layer, {
    width: w,
    height: h,
    xPercent: -50,
    yPercent: -50,
    x: state.view.x,
    y: state.view.y,
    rotation: state.view.rot,
    transformOrigin: '50% 50%',
  })
}

function clampPan() {
  const { frameW, frameH, view } = state
  const { w, h } = layerSize()
  // the rotated picture's bounding box is what has to stay over the frame
  const box = rotatedBox(w, h, view.rot)
  const maxX = Math.max(0, (box.w - frameW) / 2)
  const maxY = Math.max(0, (box.h - frameH) / 2)
  view.x = gsap.utils.clamp(-maxX, maxX, view.x)
  view.y = gsap.utils.clamp(-maxY, maxY, view.y)
}

async function useFile(file) {
  // a file can arrive when nothing is open (a stray drop, a stale input event)
  if (!state?.spot) return
  const check = validate(file, state.spot.tier)
  if (!check.ok) {
    setStatus(check.error, 'bad')
    return
  }

  setStatus('Reading…')
  try {
    const src = await readAsDataUrl(file)

    if (check.type === 'video') {
      // a two minute clip in a small silent loop is nobody's advert
      const meta = await probeVideo(src)
      // only refuse when the file actually says it is too long
      if (Number.isFinite(meta.seconds) && meta.seconds > MEDIA.maxVideoSeconds + 0.5) {
        setStatus(
          `That is ${Math.round(meta.seconds)}s. Keep it under ${MEDIA.maxVideoSeconds}s.`,
          'bad'
        )
        return
      }
      state.videoMeta = meta
    }

    if (check.type === 'video' || check.type === 'animated') {
      // anything that moves is placed whole. Running a gif through a canvas
      // would flatten it to the first frame, so it is never re-encoded.
      state.type = check.type
      state.rawSrc = src
      state.rawFile = file // the original bytes, for uploading unchanged
      els.layer.innerHTML = ''

      const node = document.createElement(check.type === 'video' ? 'video' : 'img')
      if (check.type === 'video') {
        Object.assign(node, { src, autoplay: true, loop: true, muted: true, playsInline: true })
      } else {
        node.src = src
      }
      node.className = 'studio__media'
      els.layer.append(node)

      gsap.set(els.layer, {
        width: state.frameW,
        height: state.frameH,
        xPercent: -50,
        yPercent: -50,
        x: 0,
        y: 0,
        rotation: 0,
      })
      q('[data-st="zoom"]').disabled = true
      setRotateEnabled(false)

      // Moving video cannot be cropped without re-encoding it, but the part
      // that shows can still be chosen: object-position does it for free, so
      // dragging works even though there is nothing to redraw.
      state.focus = { x: 50, y: 50 }
      node.style.objectPosition = '50% 50%'

      const ratio = state.videoMeta
        ? (state.videoMeta.width / state.videoMeta.height).toFixed(2)
        : null
      const length = Number.isFinite(state.videoMeta?.seconds)
        ? `${Math.round(state.videoMeta.seconds)}s`
        : 'Video ready'
      const offSquare = ratio && Math.abs(ratio - 1) > 0.15
      setStatus(
        check.type === 'video'
          ? `${length}${offSquare ? ' · drag to choose what shows' : ''}`
          : 'GIF ready',
        'ok'
      )
    } else {
      const img = await loadImage(src)
      state.type = 'image'
      state.img = img
      state.view = { scale: 1, x: 0, y: 0, rot: 0 }
      els.layer.innerHTML = ''
      const el = document.createElement('img')
      el.src = src
      el.className = 'studio__media'
      els.layer.append(el)
      q('[data-st="zoom"]').disabled = false
      q('[data-st="zoom"]').value = '1'
      setRotateEnabled(true)
      q('[data-st="rotate"]').value = '0'
      applyView()
      setStatus('Drag to reposition', 'ok')
    }

    els.root.classList.add('has-media')
    q('[data-st="save"]').disabled = false
  } catch (err) {
    setStatus(err.message, 'bad')
  }
}

export function initStudio() {
  const root = document.getElementById('studio')
  if (!root) return { open: () => {} }

  els = {
    root,
    frame: root.querySelector('[data-st="frame"]'),
    layer: root.querySelector('[data-st="layer"]'),
    input: root.querySelector('[data-st="file"]'),
  }

  function close() {
    root.classList.remove('is-open')
    state = null
  }

  root.querySelectorAll('[data-st-close]').forEach((b) => b.addEventListener('click', close))
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.classList.contains('is-open')) close()
  })

  // --- file pickers -------------------------------------------------------
  els.input.addEventListener('change', (e) => {
    const f = e.target.files?.[0]
    if (f) useFile(f)
    e.target.value = ''
  })
  q('[data-st="pick"]').addEventListener('click', () => els.input.click())
  els.frame.addEventListener('click', () => {
    if (!state?.img && !state?.rawSrc) els.input.click()
  })

  // --- drag and drop ------------------------------------------------------
  ;['dragenter', 'dragover'].forEach((ev) =>
    els.frame.addEventListener(ev, (e) => {
      e.preventDefault()
      els.frame.classList.add('is-dropping')
    })
  )
  ;['dragleave', 'drop'].forEach((ev) =>
    els.frame.addEventListener(ev, (e) => {
      e.preventDefault()
      els.frame.classList.remove('is-dropping')
    })
  )
  els.frame.addEventListener('drop', (e) => {
    const f = e.dataTransfer?.files?.[0]
    if (f) useFile(f)
  })

  // --- pan ----------------------------------------------------------------
  let dragging = false
  let last = { x: 0, y: 0 }
  els.frame.addEventListener('pointerdown', (e) => {
    if (!state?.img && !state?.focus) return
    dragging = true
    last = { x: e.clientX, y: e.clientY }
    els.frame.setPointerCapture(e.pointerId)
  })
  els.frame.addEventListener('pointermove', (e) => {
    if (!dragging) return

    if (state?.focus) {
      // moving media: slide which part of the frame is shown
      const media = els.layer.querySelector('.studio__media')
      state.focus.x = gsap.utils.clamp(0, 100, state.focus.x - (e.clientX - last.x) * 0.25)
      state.focus.y = gsap.utils.clamp(0, 100, state.focus.y - (e.clientY - last.y) * 0.25)
      if (media) media.style.objectPosition = `${state.focus.x}% ${state.focus.y}%`
      last = { x: e.clientX, y: e.clientY }
      return
    }

    if (!state?.img) return
    state.view.x += e.clientX - last.x
    state.view.y += e.clientY - last.y
    last = { x: e.clientX, y: e.clientY }
    clampPan()
    applyView()
  })
  ;['pointerup', 'pointercancel'].forEach((ev) =>
    els.frame.addEventListener(ev, () => {
      dragging = false
    })
  )

  // --- zoom ---------------------------------------------------------------
  q('[data-st="zoom"]').addEventListener('input', (e) => {
    if (!state?.img) return
    state.view.scale = Number(e.target.value)
    clampPan()
    applyView()
  })

  // --- rotate -------------------------------------------------------------
  q('[data-st="rotate"]').addEventListener('input', (e) => {
    setRotation(Number(e.target.value))
  })
  els.root.querySelectorAll('[data-st-turn]').forEach((btn) => {
    btn.addEventListener('click', () => {
      setRotation((state?.view.rot || 0) + Number(btn.dataset.stTurn))
    })
  })
  q('[data-st="rotreset"]').addEventListener('click', () => setRotation(0))
  els.frame.addEventListener(
    'wheel',
    (e) => {
      if (!state?.img) return
      e.preventDefault()
      const next = gsap.utils.clamp(1, 3, state.view.scale - e.deltaY * 0.0015)
      state.view.scale = next
      q('[data-st="zoom"]').value = String(next)
      clampPan()
      applyView()
    },
    { passive: false }
  )

  // --- save ---------------------------------------------------------------
  q('[data-st="save"]').addEventListener('click', async () => {
    if (!state) return
    const btn = q('[data-st="save"]')
    btn.disabled = true
    setStatus('Saving…')

    try {
      // One signature covers uploading the file and attaching it, so the
      // owner is asked to sign once rather than twice for the same action.
      const { signAction } = await import('../chain/wallet.js')
      const auth = await signAction(`media:${state.spot.id}`)
      const creds = { spotId: state.spot.id, owner: state.spot.owner, ...auth }

      let media
      if (state.type === 'video' || state.type === 'animated') {
        // uploaded byte for byte: re-encoding a gif or a video here would
        // either flatten it to one frame or wreck the quality
        const { url } = await uploadMedia(state.rawFile, creds)
        media =
          state.type === 'video'
            ? { type: 'video', src: url, focus: state.focus }
            : { type: 'image', src: url, animated: true, focus: state.focus }
      } else {
        const canvas = renderCrop(state.img, state.view, state.frameW, state.frameH)
        const blob = await canvasToBlob(canvas)
        const { url } = await uploadMedia(blob, creds)
        media = { type: 'image', src: url }
      }

      media.alt = state.spot.id

      state.onSave?.(media, auth)
      setStatus('Saved', 'ok')
      setTimeout(close, 420)
    } catch (err) {
      setStatus(err.message, 'bad')
      btn.disabled = false
    }
  })

  // --- open ---------------------------------------------------------------
  function open(spot, { onSave, frameRatio, pxW, pxH } = {}) {
    const tier = TIERS[spot.tier]

    // The preview keeps the deed's real proportions, but not every deed is a
    // sane shape: PAR-27 is a 24:1 strip across the ledger, and sizing from a
    // fixed 360px width made its frame 15px tall — too small to see the crop,
    // never mind drag it. So size from the SHORT side up and let the card
    // widen to hold the result. Ordinary deeds are unaffected.
    const ratio = frameRatio || 1
    const BASE = 360        // what a squarish deed gets, as before
    const TARGET_SHORT = 96 // what a wide deed's preview aims to be, tall-ways
    const roomW = Math.max(BASE, Math.min(1180, Math.round(window.innerWidth * 0.92) - 96))
    const roomH = Math.max(200, Math.min(420, Math.round(window.innerHeight * 0.52)))

    let frameW, frameH
    if (ratio >= 1) {
      frameW = Math.min(roomW, Math.max(BASE, Math.round(TARGET_SHORT * ratio)))
      frameH = Math.round(frameW / ratio)
    } else {
      frameH = Math.min(roomH, Math.max(BASE, Math.round(TARGET_SHORT / ratio)))
      frameW = Math.round(frameH * ratio)
    }

    state = {
      spot,
      onSave,
      type: 'image',
      img: null,
      rawSrc: null,
      rawFile: null,
      focus: null,
      videoMeta: null,
      view: { scale: 1, x: 0, y: 0, rot: 0 },
      frameW,
      frameH,
    }

    q('[data-st="id"]').textContent = spot.id
    q('[data-st="tier"]').textContent = `${tier.label} — ${tier.media.join(' / ')}`
    // the file picker only offers what this tier is actually allowed to hold
    els.input.accept = acceptAttr(spot.tier)
    q('[data-st="hint"]').textContent = allowsAnimation(spot.tier)
      ? 'Image, GIF or video. Up to 12MB. This is the only spot that moves.'
      : 'PNG, JPG or WEBP. Up to 4MB. Still images only.'
    q('[data-st="save"]').disabled = true
    q('[data-st="rotate"]').value = '0'
    q('[data-st="rotdeg"]').textContent = '0°'
    setRotateEnabled(false)

    els.frame.style.width = frameW + 'px'
    els.frame.style.height = frameH + 'px'
    els.frame.dataset.shape = spot.shape
    // a wide deed needs a wide card, otherwise the stage clips the frame
    root.querySelector('.studio__card')?.style.setProperty('--card-w', Math.max(520, frameW + 96) + 'px')
    // tell the buyer it really is a thin strip, so a 48px preview does not
    // read as something broken
    const dims = q('[data-st="dims"]')
    if (dims) dims.textContent = pxW && pxH ? `${pxW} × ${pxH} on the page` : ''
    els.layer.innerHTML = ''
    root.classList.remove('has-media')
    setStatus('')

    root.classList.add('is-open')
  }

  return { open, close }
}
