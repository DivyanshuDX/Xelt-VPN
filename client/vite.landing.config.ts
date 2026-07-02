import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Standalone build for the marketing landing page ONLY.
//
// The main vite.config.ts bundles three entries (app + pay + landing), and the
// app/pay entries pull in `x402-casper` (a file: dep) whose transitive deps
// aren't installed when a static host only installs the `client/` folder.
// The landing page imports none of that, so this config builds just landing.html
// — no x402-casper, no casper-js-sdk, no node polyfills. Used for Vercel.
//
// Output is dist/landing.html; vercel.json rewrites "/" → "/landing.html".
export default defineConfig({
  plugins: [react()],
  define: { global: 'globalThis' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    rollupOptions: {
      input: resolve(__dirname, 'landing.html'),
    },
  },
});
