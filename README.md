# Skipper

An AI-narrated, GPS-triggered driving audio tour. Think _Shaka Guide, but the
narration is AI-generated_ — played by a charming Jungle-Cruise-skipper persona,
over hand-curated driving routes, as phone audio (CarPlay later). First region:
**Lake Tahoe**.

> **Posture:** a toy / lifestyle side project. Optimize for _charm_ and for being
> a thing the founder actually wants to use — not for scale or defensibility.
> **The persona is the product.**

## The two principles

1. **Assemble tours per request. Generate content once per place.**
   `pois` + `poi_content` are a cache (grounded facts → in-character script →
   audio). `tours` + `tour_stops` are the assembly (a curated route + ordered
   stops pointing at cached content).
2. **The rails are the route; the generation is everything inside the rails.**
   Routes are hand-curated and frozen. Inside the rails the model does
   everything: which stops, what story, pacing, interest filtering, voice.
   _Human picks the road; the model narrates the drive._

## Stack

- **TypeScript 6** everywhere · **bun** (package manager + runtime + workspaces)
- **Backend:** Hono (served natively by bun) · **DB:** Neon + Drizzle · **Auth:** Better Auth (freemium) · **Audio:** Cloudflare R2 (private; presigned URLs)
- **AI:** Anthropic `claude-opus-4-8` (narration) · Google Cloud Text-to-Speech — Gemini-TTS voice "Sulafat" (OAuth/ADC, no API key; LINEAR16 → WAV)
- **Mobile (MVP = phone player):** Expo SDK 56, `expo-audio` + `expo-location`; CarPlay (`@g4rb4g3/react-native-carplay`) deferred past the MVP

## Layout

```
skipper/
├── apps/
│   ├── api/        @skipper/api       — Hono API (M2). Bun-native serve.
│   └── mobile/     @skipper/mobile    — Expo app. Phone player is the MVP (CarPlay later).
├── packages/
│   ├── shared/     @skipper/shared    — Zod schemas + types, imported everywhere.
│   ├── db/         @skipper/db        — Drizzle schema + Neon client.
│   ├── generator/  @skipper/generator — server-side tour generation (M1).
│   └── sim/        @skipper/sim       — drive simulator + speed-adaptive trigger core.
├── tsconfig.base.json · package.json (bun workspaces)
```

Internal packages export **TypeScript source** directly (no dist build) — bun
runs `.ts`, and `tsc --noEmit` type-checks. There is no `tsx`, no
`@hono/node-server`: bun covers both.

## Getting started

```bash
bun install
bun run dev                 # dotenvx decrypts .env.development, then bun --watch the api (http://localhost:8787/health)
bun run typecheck           # bun --filter -> tsc --noEmit across all packages
```

### Environment & secrets

Secrets are managed with [dotenvx](https://dotenvx.com). `.env.development` and
`.env.production` are committed **encrypted** (public-key); the private decryption
keys live only in `.env.keys`, which is gitignored — **never commit it**.

- **Onboarding:** get `.env.keys` from a teammate (1Password / Signal / AirDrop),
  then `bun run dev`. No `.env` copying.
- **Set a value:** `dotenvx set DATABASE_URL "postgres://…" -f .env.development`
  (repeat with `-f .env.production` for prod), then commit the encrypted file.
- `.env.example` is the plaintext catalog of which vars exist.
- **Deploy:** set `DOTENV_PRIVATE_KEY_PRODUCTION` in the host env; dotenvx
  decrypts at start.

### Database

```bash
bun run db:push      # apply schema to Neon (dev)
bun run db:studio    # browse
bun run db:migrate   # run migrations (db:migrate:prod targets .env.production)
```

## Status

The frontier is **M1 — the live on-device phone player** (the MVP bet). What exists today:

- **M1 generator (`@skipper/generator`) — built.** Wikipedia (grounded facts, CC BY-SA
  attribution) → Claude narration → Google Cloud TTS → R2 → Neon, with grounding/diversity
  lint + a judge pass. A first Tahoe corridor ("Emerald Bay") is generated and live as a
  shareable preview.
- **M2 API (`@skipper/api`) — done.** `GET /corridors`, `GET /corridors/:id/tours`,
  `GET /tours/:id`, `POST /tours/:id/assets/sign` (presigned R2), behind Better Auth
  freemium gating (anonymous → preview only; free account → full; paid tier later).
- **Drive simulator (`@skipper/sim`) — built.** Speed-adaptive trigger core + a headless
  drive sim + the compressed "preview drive" timeline engine.
- **Mobile (`@skipper/mobile`) — scaffolded + wired.** The Expo app browses corridors, signs
  in, and plays the map-less **simulated-drive preview**. The **live phone player** (offline
  download → GPS triggering → lock-screen Now Playing) is the open M1 work.

Deferred past the MVP: CarPlay, Android Auto, multilingual, the cache/dedup machinery (M4).
See `CLAUDE.md` for the full milestone plan and the explicit v1 non-goals.
