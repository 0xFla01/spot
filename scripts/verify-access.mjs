// Tries to get something for nothing, the way somebody would if they skipped
// the website and talked to the server directly. Every one of these has to be
// refused when a real coin is configured.
//
//   node scripts/verify-access.mjs            (expects a server on 8787)
//   SPOT_API=http://host:port node scripts/verify-access.mjs

const API = process.env.SPOT_API || 'http://localhost:8787'

let failures = 0
const check = (label, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? '   ' + detail : ''}`)
  if (!pass) failures++
}

async function post(path, body, headers = {}) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

const state = await (await fetch(`${API}/state`)).json()
const simulating = state.simulation

console.log(`\nserver at ${API}`)
console.log(simulating ? 'mode: SIMULATION\n' : 'mode: verifying on chain\n')

const STRANGER = 'STRANGERxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const claimed = Object.keys(state.spots)[0]

// --- uploading without owning anything --------------------------------------
console.log('Uploading with no wallet and no spot')
{
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(64)], { type: 'image/png' }), 'x.png')
  const res = await fetch(`${API}/upload`, { method: 'POST', body: form })
  check('a bare upload is refused', res.status === 401 || res.status === 403, `got ${res.status}`)
}
{
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(64)], { type: 'image/png' }), 'x.png')
  const res = await fetch(`${API}/upload`, {
    method: 'POST',
    body: form,
    headers: { 'x-spot-id': 'PLT-02', 'x-spot-owner': STRANGER },
  })
  check(
    'uploading for a spot you do not own is refused',
    res.status === 401 || res.status === 403,
    `got ${res.status}`
  )
}

// --- claiming without paying ------------------------------------------------
console.log('\nClaiming')
{
  const r = await post('/claim', { spotId: 'PLT-04', buyer: STRANGER })
  if (simulating) {
    check('(simulation lets this through, as designed)', r.status === 200, `got ${r.status}`)
  } else {
    check('claiming with no transaction is refused', r.status !== 200, r.json.error ?? `got ${r.status}`)
  }
}
{
  const r = await post('/claim', {
    spotId: 'PLT-04',
    buyer: STRANGER,
    signature: '5'.repeat(88),
  })
  if (!simulating) {
    check('claiming with a made-up signature is refused', r.status !== 200, r.json.error ?? '')
  }
}

// --- editing somebody else's spot -------------------------------------------
console.log('\nEditing what is not yours')
if (claimed) {
  const r = await post('/media', {
    spotId: claimed,
    owner: STRANGER,
    media: { type: 'image', src: `${API}/uploads/whatever.webp` },
  })
  check("painting over someone else's spot is refused", r.status === 403, r.json.error ?? '')

  const real = state.spots[claimed].owner
  const r2 = await post('/media', {
    spotId: claimed,
    owner: real,
    media: { type: 'image', src: 'https://somewhere-else.example/evil.svg' },
  })
  check(
    'pointing a spot at a file hosted elsewhere is refused',
    r2.status !== 200,
    r2.json.error ?? ''
  )

  if (!simulating) {
    const r3 = await post('/media', {
      spotId: claimed,
      owner: real,
      media: { type: 'image', src: `${API}/uploads/x.webp` },
    })
    check('editing without a signature is refused', r3.status === 401, r3.json.error ?? '')
  }
} else {
  console.log('  (no claimed spot to test against, skipped)')
}

// --- taking a name that is not yours ----------------------------------------
console.log('\nNames')
{
  const r = await post('/name', { address: STRANGER, name: 'someone' })
  if (simulating) {
    check('(simulation lets this through, as designed)', r.status === 200)
  } else {
    check('setting a name without signing is refused', r.status === 401, r.json.error ?? '')
  }
}

// --- the admin lever --------------------------------------------------------
console.log('\nAdmin')
{
  const r = await post('/admin/clear', { spotId: claimed ?? 'PLT-02' })
  check('admin clear needs its token', r.status === 404 || r.status === 401, `got ${r.status}`)
}

if (simulating) {
  console.log(
    '\nNOTE: this server is in simulation, so claims and names are deliberately open.\n' +
      'Run it with SPOT_MINT set and everything above is enforced.\n'
  )
}
console.log(failures === 0 ? 'All checks passed.\n' : `${failures} CHECK(S) FAILED\n`)
process.exit(failures === 0 ? 0 : 1)
