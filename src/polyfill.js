// Must be the first import in the app.
//
// ES module imports are all evaluated before the importing module's body runs,
// so assigning window.Buffer inside main.js happens too late — @solana/web3.js
// has already been evaluated and blown up. Doing it in its own module means it
// runs at the point the import appears instead.

import { Buffer } from 'buffer'

if (!globalThis.Buffer) globalThis.Buffer = Buffer
if (!globalThis.global) globalThis.global = globalThis
