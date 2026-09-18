// ---------------------------------------------------------------------------
// Turning whatever someone drops on the page into something that fits a deed.
// Validate, downscale, crop to the frame's aspect, hand back a blob.
// ---------------------------------------------------------------------------

import { MEDIA, TIERS, allowsAnimation } from './config.js'

export function validate(file, tier) {
  const animated = allowsAnimation(tier)
  const isStill = MEDIA.imageTypes.includes(file.type)
  const isAnimated = MEDIA.animatedTypes.includes(file.type)
  const isVideo = file.type.startsWith('video/')

  if (!isStill && !isAnimated) {
    return { ok: false, error: 'PNG, JPG or WEBP' + (animated ? ', GIF, MP4 or WEBM' : ' only') }
  }
  if (isAnimated && !animated) {
    const label = TIERS[tier]?.label ?? 'This spot'
    return {
      ok: false,
      error: `${label} takes still images only. Only the Monument can move.`,
    }
  }
  const cap = isVideo ? MEDIA.maxVideoBytes : MEDIA.maxImageBytes
  if (file.size > cap) {
    return { ok: false, error: `Too large. Max ${Math.round(cap / 1024 / 1024)}MB` }
  }
  // a gif has to stay a gif or it stops moving, so it is passed through whole
  return { ok: true, type: isVideo ? 'video' : isAnimated ? 'animated' : 'image' }
}

export function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result)
    fr.onerror = () => reject(new Error('Could not read that file'))
    fr.readAsDataURL(file)
  })
}

/**
 * How long a video runs, and how big its picture is.
 *
 * `seconds` comes back null when the file simply does not say. Plenty of
 * perfectly good files are like that — anything recorded in a browser writes
 * no duration until playback reaches the end — and refusing those would turn
 * a missing header into a rejected upload.
 */
export function probeVideo(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.muted = true
    v.onerror = () => reject(new Error('That video would not open'))

    v.onloadedmetadata = () => {
      const size = { width: v.videoWidth, height: v.videoHeight }
      if (Number.isFinite(v.duration) && v.duration > 0) {
        return resolve({ seconds: v.duration, ...size })
      }

      // seeking past the end makes the browser work the length out for itself
      let settled = false
      const done = () => {
        if (settled) return
        settled = true
        v.ontimeupdate = null
        resolve({
          seconds: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null,
          ...size,
        })
      }
      v.ontimeupdate = () => {
        if (v.currentTime > 0) done()
      }
      setTimeout(done, 3000) // never leave someone waiting on a stubborn file
      try {
        v.currentTime = 1e101
      } catch {
        done()
      }
    }

    v.src = src
  })
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('That image would not decode'))
    img.src = src
  })
}

/**
 * The scale at which an image of imgW x imgH still covers a frameW x frameH
 * window after being rotated by `rot` degrees.
 *
 * Rotating the image is the same as rotating the frame the other way, so the
 * frame's rotated bounding box is what actually has to fit inside the image.
 * Without this, turning a picture leaves empty wedges in the corners.
 */
export function coverScale(imgW, imgH, frameW, frameH, rot = 0) {
  const r = (rot * Math.PI) / 180
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  const boxW = frameW * c + frameH * s
  const boxH = frameW * s + frameH * c
  return Math.max(boxW / imgW, boxH / imgH)
}

/** The bounding box a scaled, rotated image occupies. Used to limit panning. */
export function rotatedBox(w, h, rot = 0) {
  const r = (rot * Math.PI) / 180
  const c = Math.abs(Math.cos(r))
  const s = Math.abs(Math.sin(r))
  return { w: w * c + h * s, h: w * s + h * c }
}

/**
 * Render the visible part of the image, as framed in the studio, to a canvas.
 *
 * view = { scale, x, y, rot } where x/y are offsets in frame pixels, scale is
 * relative to the covering size, and rot is degrees clockwise.
 */
export function renderCrop(img, view, frameW, frameH) {
  const out = document.createElement('canvas')
  const edge = MEDIA.maxEdge
  const ratio = frameW / frameH

  // keep the frame's aspect, cap the long edge
  let w = frameW
  let h = frameH
  if (Math.max(w, h) > edge) {
    if (ratio >= 1) {
      w = edge
      h = Math.round(edge / ratio)
    } else {
      h = edge
      w = Math.round(edge * ratio)
    }
  }
  out.width = w
  out.height = h

  const ctx = out.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, w, h)

  const rot = view.rot || 0
  const k = w / frameW // frame pixels -> canvas pixels
  const cover = coverScale(img.width, img.height, frameW, frameH, rot)
  const drawW = img.width * cover * view.scale * k
  const drawH = img.height * cover * view.scale * k

  ctx.save()
  ctx.translate(w / 2 + view.x * k, h / 2 + view.y * k)
  ctx.rotate((rot * Math.PI) / 180)
  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH)
  ctx.restore()

  return out
}

export function canvasToBlob(canvas, type = 'image/webp', quality = 0.9) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Where a finished upload goes. With a backend configured it is posted there
 * and the returned URL is what gets stored on the deed. Without one the image
 * stays in the browser as a data URL, which is enough to design against but
 * will not survive a hard refresh on someone else's machine.
 */
const EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

export async function uploadMedia(blob, { spotId, owner, nonce, signature }) {
  const endpoint = import.meta.env?.VITE_SPOT_API
  if (!endpoint) {
    // no server: keep it in the browser, which is enough to design against
    return new Promise((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve({ url: fr.result, local: true })
      fr.readAsDataURL(blob)
    })
  }

  // the extension has to match what is actually inside, or the file is served
  // with the wrong type and a video quietly refuses to play
  const ext = EXT[blob.type] || 'bin'
  const form = new FormData()
  form.append('file', blob, `${spotId}.${ext}`)
  form.append('spotId', spotId)

  // the server checks these before it writes a single byte
  const res = await fetch(`${endpoint}/upload`, {
    method: 'POST',
    body: form,
    headers: {
      'x-spot-id': spotId,
      'x-spot-owner': owner ?? '',
      'x-spot-nonce': nonce ?? '',
      'x-spot-signature': signature ?? '',
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || 'Upload failed')
  }
  const json = await res.json()
  return { url: json.url, local: false }
}
