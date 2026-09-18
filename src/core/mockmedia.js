// ---------------------------------------------------------------------------
// Placeholder "ads" so the page can be judged in a half-claimed state.
// Pure SVG data-URIs, no network. Swap for real uploads later.
// ---------------------------------------------------------------------------

const PALETTES = [
  ['#FF5B23', '#1A0600', '#FFD9C7'],
  ['#C8FF2E', '#101500', '#E8FFB0'],
  ['#3D8BFF', '#00081A', '#CFE2FF'],
  ['#FF3DBE', '#1A0012', '#FFD1EF'],
  ['#00E5C4', '#001512', '#BFFFF5'],
  ['#F5E6C8', '#0C0A06', '#3A3226'],
  ['#8B5CF6', '#0A0517', '#E0D4FF'],
]

const WORDS = [
  'gm', 'WAGMI', 'BONK', 'degen', 'HODL', 'ser', 'moon', 'ngmi',
  'ape in', 'LFG', '$PEPE', 'based', 'wen', 'rekt', 'chad',
]

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return Math.abs(h)
}

export function mockImage(seed) {
  const h = hash(seed)
  const [fg, bg, tint] = PALETTES[h % PALETTES.length]
  const word = WORDS[(h >> 3) % WORDS.length]
  const variant = (h >> 7) % 3

  let art = ''
  if (variant === 0) {
    art = `<circle cx="200" cy="200" r="120" fill="${fg}" opacity="0.9"/>
           <circle cx="200" cy="200" r="60" fill="${bg}"/>`
  } else if (variant === 1) {
    art = `<rect x="40" y="40" width="320" height="320" fill="none" stroke="${fg}" stroke-width="14"/>
           <path d="M40 360 L360 40" stroke="${fg}" stroke-width="14"/>`
  } else {
    art = `<rect x="0" y="240" width="400" height="160" fill="${fg}" opacity="0.85"/>
           <circle cx="300" cy="110" r="70" fill="${tint}"/>`
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="${bg}"/>
    ${art}
    <text x="200" y="215" font-family="Archivo, Arial, sans-serif" font-size="64"
      font-weight="800" fill="${tint}" text-anchor="middle"
      letter-spacing="-2">${word}</text>
  </svg>`

  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(/\s+/g, ' '))
}

export function mockWallet(seed) {
  const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  let h = hash(seed)
  let out = ''
  for (let i = 0; i < 44; i++) {
    h = (h * 1103515245 + 12345) & 0x7fffffff
    out += chars[h % chars.length]
  }
  return out
}
