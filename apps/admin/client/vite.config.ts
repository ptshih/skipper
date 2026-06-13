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
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/admin': 'http://localhost:8788',
      '/health': 'http://localhost:8788',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
})
