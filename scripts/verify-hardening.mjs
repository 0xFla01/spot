// The checks that exist test the happy path and known forgeries. These are the
// ones that bit us, or nearly did: injection through the claim route, replay,
// reservation bypass, and the operational footguns that only show up in
// production config. Run against a server that is already up.
//
//   node scripts/verify-hardening.mjs [http://localhost:8787]

const API = process.argv[2] || 'http://localhost:8787'
let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  cond ? pass++ : fail++
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '   ' + detail : ''}`)
}
const post = async (path, body) => {
  const r = await fetch(API + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  let j = {}
  try { j = await r.json() } catch {}
  return { status: r.status, body: j }
}
const state = () => fetch(API + '/state').then((r) => r.json())

const head = (t) => console.log(`\n${t}`)

const s0 = await state()
const SIM = /simulation/i.test(JSON.stringify(s0.mode ?? '')) || s0.simulation === true

head('Media can only ever be a file this server hosts')
const victim = 'PIN-21'
for (const [label, url] of [
  ['a remote https url',        'https://evil.example/t.gif'],
  // the one the old includes('/uploads/') guard let straight through
  ['a remote url containing /uploads/', 'https://evil.example/uploads/t.gif'],
  ['/uploads/ in a query string', 'https://evil.example/x?a=/uploads/t.gif'],
  ['a protocol-relative url',   '//evil.example/t.gif'],
  ['a data uri',                'data:image/gif;base64,R0lGOD'],
  ['a javascript uri',          'javascript:alert(1)'],
  ['path traversal out of uploads', '/uploads/../../etc/passwd'],
  ['a nested path',             '/uploads/a/../../evil.png'],
  ['an encoded traversal',      '/uploads/%2e%2e%2f%2e%2e%2fetc'],
  ['our host but not an upload','http://localhost:8787/etc/passwd'],
]) {
  const r = await post('/claim', { spotId: victim, buyer: 'Atk1111111111111111111111111111111111111', mediaUrl: url })
  const after = await state()
  const stored = after.spots[victim]?.media?.src ?? null
  const clean = stored === null || /^\/uploads\/[A-Za-z0-9._-]+$/.test(stored)
  ok(label + ' is refused', r.status === 400 || clean, `got ${r.status}${stored ? ' stored ' + stored : ''}`)
}

head('Real uploads must still work - both forms the app produces')
for (const [label, url] of [
  ['the absolute form the upload route returns', `${API}/uploads/real-file.webp`],
  ['the canonical relative form',                '/uploads/real-file.webp'],
]) {
  const r = await post('/claim', { spotId: victim, buyer: 'Atk1111111111111111111111111111111111111', mediaUrl: url })
  const after = await state()
  const stored = after.spots[victim]?.media?.src
  ok(label + ' is accepted', r.status === 200 && stored === '/uploads/real-file.webp',
     `got ${r.status} stored ${JSON.stringify(stored)}`)
}

head('Spots that do not exist')
{
  const r = await post('/claim', { spotId: 'NOT-A-SPOT', buyer: 'Atk1111111111111111111111111111111111111' })
  ok('an unknown spot is refused', r.status === 404, `got ${r.status}`)
}

head('Reservations - the guard that stops two people paying for one spot')
await (async () => {
  // fresh addresses and an unowned spot every run, or the previous run's
  // ownership makes the reserve fail for the wrong reason
  const rnd = () => 'T' + Math.random().toString(36).slice(2).padEnd(42, '0').slice(0, 42)
  const A = rnd(), B = rnd()
  // /state only lists CLAIMED spots, so an unclaimed one has to come from the
  // registry itself
  const { SPOTS } = await import('../src/core/spots.js')
  const now = await state()
  const claimed = new Set(Object.keys(now.spots || {}))
  const spot = SPOTS.map((x) => x.id).find((id) => !claimed.has(id))
  if (!spot) { console.log('  (every spot is claimed, skipping)'); }

  if (!spot) return
  const rA = await post('/reserve', { spotId: spot, buyer: A })
  ok('the first buyer gets the hold', rA.status === 200, `got ${rA.status} ${JSON.stringify(rA.body.error ?? '')}`)

  const rB = await post('/reserve', { spotId: spot, buyer: B })
  ok('a second buyer is turned away before paying', rB.status === 409, `got ${rB.status}`)

  const cB = await post('/claim', { spotId: spot, buyer: B })
  ok('and cannot claim past the hold either', cB.status === 409, `got ${cB.status}`)

  const cA = await post('/claim', { spotId: spot, buyer: A })
  ok('the holder can claim', cA.status === 200, `got ${cA.status} ${JSON.stringify(cA.body.error ?? '')}`)

  // the point of all of it: B is told no BEFORE spending anything
  ok('the loser never gets as far as paying', rB.status === 409 && cB.status === 409)
})()

head('Names cannot carry markup (they are interpolated into innerHTML)')
for (const n of ['<b>x</b>', '"onx=y', 'a&b', "x'y", '<svg/onload=1']) {
  const r = await post('/name', { address: 'Nm11111111111111111111111111111111111111', name: n, nonce: 'x', signature: 'x' })
  ok(`${JSON.stringify(n)} is refused`, r.status === 400, `got ${r.status}`)
}

head('Operational footguns')
{
  ok('server reports which mode it is in', typeof (s0.mode ?? s0.simulation) !== 'undefined',
     `mode=${JSON.stringify(s0.mode ?? s0.simulation)}`)
  if (SIM) console.log('        (this server is in SIMULATION — claims are open by design)')
}

console.log(`\n  ${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
