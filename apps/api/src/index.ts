import { Hono } from 'hono'

const app = new Hono()

// Health check — used by infra / local smoke tests.
app.get('/health', (c) => c.json({ ok: true }))

// TODO(M2): real API surface
//   GET  /corridors                 -> list corridors
//   GET  /tours/:tourId             -> fetch a single tour (+ ordered stops)
//   POST /tours/:tourId/assets/sign -> issue signed Cloudflare R2 URLs
// Pulls from @skipper/db; shares types/validation via @skipper/shared.

const port = Number(process.env.PORT ?? 8787)

// Bun serves a default export of the shape { port, fetch }.
export default { port, fetch: app.fetch }
