import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

// The admin SPA. In dev, vite (5173) proxies the API to the Hono admin-api (8788). In prod
// the built dist is served BY the Hono server (one Cloud Run service behind IAP), so the SPA
// and /admin/* are same-origin and the IAP cookie/headers flow naturally.
// Tailwind v4 runs via its Vite plugin (no postcss.config / tailwind.config — config is in index.css).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // bun's isolated linker keeps multiple React copies in the monorepo (expo/mobile pulls
    // react@18.3.1; the admin is pinned to 19.2.7). After a node_modules re-link (e.g. a repo-wide
    // `bun install`), vite can resolve `react/jsx-dev-runtime` to a DIFFERENT copy than the app's
    // react — the "Cannot read properties of undefined (reading 'ReactCurrentDispatcher')"
    // dual-React crash. dedupe forces a single copy (the admin's 19.2.7) for every react specifier.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/admin': 'http://localhost:8788',
      '/health': 'http://localhost:8788',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Split heavy deps out of the app chunk (vite 8 / rolldown codeSplitting groups; groups match
    // in order, first wins). This is an internal IAP-gated tool that loads once, so the win is
    // modest — stable vendor caching across deploys + clearing the >500 kB advisory.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'maps', test: /@vis\.gl/ },
            { name: 'tanstack', test: /@tanstack/ },
            { name: 'react-vendor', test: /[\\/]react(-dom)?[@\\/]/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
})
