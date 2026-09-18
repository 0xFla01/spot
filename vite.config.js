import { defineConfig } from 'vite'

// @solana/web3.js and spl-token still reach for Node's Buffer and `global`.
// Nothing else in the project needs a polyfill, so shim just those two.
export default defineConfig({
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer/',
    },
  },
  build: {
    target: 'es2022',
  },
})
