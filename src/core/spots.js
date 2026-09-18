// ---------------------------------------------------------------------------
// The registry. One source of truth for every ownable inch of the page.
// Later this gets hydrated from chain state; the shape stays identical.
//
// Deliberately few. Scarcity is the whole engine: a spot nobody else wants is
// never taken, and a spot that is never taken never burns anything. Every one
// of these had to earn its place, so the filler squares are gone and what is
// left is either a strong silhouette or a piece of the page itself — the O in
// the headline, the full stop, the zero in a section number, the cursor.
// ---------------------------------------------------------------------------

// shape: rect | square | circle | pill | arch | diamond | slab
// lpos:  where the annotation hangs — top | bottom | left | right | vertical | inside

const S = (id, tier, shape, extra = {}) => ({
  id,
  tier,
  shape,
  owner: null,
  lastPrice: null,
  media: null, // { type: 'image'|'video', src, alt, focus } - no href, by design
  claimedAt: null,
  flips: 0,
  label: null,
  lpos: 'top',
  ...extra,
})

export const SPOTS = [
  // --- HERO ---------------------------------------------------------------
  S('MON-01', 'MONUMENT', 'slab', {
    section: 'hero',
    // Square on purpose. Anything people upload is either 16:9 from a screen
    // or 9:16 off a phone, and a square loses the same amount from each
    // rather than butchering one of them.
    pos: {
      right: '4vw',
      top: '14vh',
      width: 'min(30vw, 420px)',
      height: 'min(30vw, 420px)',
    },
    label: 'one of these exists',
    lpos: 'top',
  }),
  S('PIN-01', 'PIN', 'circle', {
    section: 'hero',
    inType: true,
    note: 'The O of FOR in the headline.',
  }),
  S('PIN-02', 'PIN', 'square', { section: 'hero' }),
  S('PLT-10', 'PLOT', 'rect', {
    section: 'hero',
    label: 'nobody reads margins. cheap.',
    lpos: 'vertical',
  }),

  // --- PROOF --------------------------------------------------------------
  S('PLT-01', 'PLOT', 'rect', { section: 'proof', label: 'you can own this', lpos: 'top' }),
  S('PAR-01', 'PARCEL', 'circle', { section: 'proof', label: 'also this', lpos: 'top' }),
  S('PAR-02', 'PARCEL', 'arch', { section: 'proof', label: 'and this', lpos: 'top' }),
  S('PIN-32', 'PIN', 'square', {
    section: 'proof',
    inType: true,
    label: 'that is a full stop, and it is for sale',
    note: 'The period after "This too."',
  }),

  // --- STRIP --------------------------------------------------------------
  S('PAR-20', 'PARCEL', 'arch', {
    section: 'strip',
    span: [3, 1],
    label: 'flip me',
    lpos: 'inside',
  }),
  S('PIN-21', 'PIN', 'circle', { section: 'strip', span: [2, 1] }),
  S('PAR-21', 'PARCEL', 'pill', {
    section: 'strip',
    span: [4, 1],
    label: 'peak visibility',
    lpos: 'inside',
  }),

  // --- HOW ----------------------------------------------------------------
  S('PAR-03', 'PARCEL', 'square', {
    section: 'how',
    step: 1,
    label: 'this one is still free',
    lpos: 'top',
  }),
  S('PAR-04', 'PARCEL', 'circle', { section: 'how', step: 2, label: 'for now', lpos: 'top' }),
  S('PAR-05', 'PARCEL', 'arch', {
    section: 'how',
    step: 3,
    label: 'someone will take it',
    lpos: 'top',
  }),

  // --- EDITORIAL (set inside the sentence) --------------------------------
  S('PIN-27', 'PIN', 'circle', { section: 'editorial', inType: true }),
  S('PIN-28', 'PIN', 'square', { section: 'editorial', inType: true }),
  S('PIN-29', 'PIN', 'pill', { section: 'editorial', inType: true }),
  S('PLT-07', 'PLOT', 'slab', {
    section: 'editorial',
    label: 'imagine your face here',
    lpos: 'top',
  }),

  // --- FEED ---------------------------------------------------------------
  S('PLT-08', 'PLOT', 'rect', {
    section: 'feed',
    label: 'advertise next to the receipts',
    lpos: 'top',
  }),
  S('PAR-27', 'PARCEL', 'rect', {
    section: 'feed',
    label: 'a sponsored line in the ledger',
    lpos: 'top',
    inLedger: true,
  }),
]

// --- TICKER (deeds riding the marquee) -------------------------------------
SPOTS.push(S('PIN-38', 'PIN', 'circle', { section: 'ticker', inType: true }))
SPOTS.push(S('PAR-28', 'PARCEL', 'diamond', { section: 'ticker', inType: true }))
SPOTS.push(S('PIN-39', 'PIN', 'pill', { section: 'ticker', inType: true }))

// --- THE WALL --------------------------------------------------------------
// Seven, not thirty-four. Each one big enough to be worth fighting over, and
// every one a different silhouette — no filler squares.
// Two bands that each add up to the full twelve columns and share a height,
// so nothing is left hanging under a short shape.
//   band 1 (3 rows):  5 + 3 + 4
//   band 2 (4 rows):  3 + 4 + 5, with the last five split into two stacked
const WALL = [
  ['PLT-02', 'PLOT', 'slab', [5, 3], 'the good corner'],
  ['PAR-07', 'PARCEL', 'circle', [3, 3], null],
  ['PLT-04', 'PLOT', 'rect', [4, 3], 'billboard energy'],

  ['PLT-03', 'PLOT', 'arch', [3, 4], null],
  ['PAR-10', 'PARCEL', 'diamond', [4, 4], 'rare shape'],
  ['PAR-13', 'PARCEL', 'pill', [5, 2], null],
  ['PIN-06', 'PIN', 'circle', [5, 2], 'nobody scrolls this far'],
]

for (const [id, tier, shape, span, label] of WALL) {
  SPOTS.push(S(id, tier, shape, { section: 'wall', span, label, lpos: 'inside' }))
}

// the zero in the wall's section number
SPOTS.push(
  S('PIN-33', 'PIN', 'circle', {
    section: 'wall',
    inType: true,
    note: 'The 0 of 03 in the section number.',
  })
)

// --- FOOTER ----------------------------------------------------------------
SPOTS.push(
  S('PLT-09', 'PLOT', 'circle', {
    section: 'footer',
    inType: true,
    note: 'The O of the giant SPOT wordmark.',
  })
)
SPOTS.push(S('PIN-19', 'PIN', 'square', { section: 'footer' }))
SPOTS.push(S('PAR-26', 'PARCEL', 'rect', { section: 'footer', label: 'last call', lpos: 'top' }))

// --- THE EASTER EGG --------------------------------------------------------
// Not placed in the layout at all. The cursor ring IS this deed.
SPOTS.push(
  S('CURSOR-01', 'PARCEL', 'circle', {
    section: 'easter',
    inType: true,
    label: 'the cursor itself',
    note: 'Claimed with the C key while reveal mode is on.',
  })
)

export const byId = new Map(SPOTS.map((s) => [s.id, s]))
export const bySection = (name) => SPOTS.filter((s) => s.section === name)
export const total = SPOTS.length
