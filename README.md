# Skipper

An AI-narrated, GPS-triggered driving audio tour. Think _Shaka Guide, but the
narration is AI-generated_ — played by a charming Jungle-Cruise-skipper persona,
over hand-curated driving routes, with CarPlay output. First region: **Lake Tahoe**.

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

- **TypeScript 6** everywhere · **bun** (package manager + runtime) · **Turborepo**
- **Backend:** Hono (served natively by bun) · **DB:** Neon + Drizzle · **Audio:** Cloudflare R2
- **AI:** Anthropic `claude-opus-4-8` (narration) · ElevenLabs `eleven_multilingual_v2` (TTS)
- **Mobile (deferred):** Expo SDK 56, CarPlay via `@g4rb4g3/react-native-carplay`

## Layout

```
skipper/
├── apps/
│   ├── api/        @skipper/api       — Hono API (M2). Bun-native serve.
│   └── mobile/     @skipper/mobile    — Expo app. DEFERRED until the CarPlay gate.
├── packages/
│   ├── shared/     @skipper/shared    — Zod schemas + types, imported everywhere.
│   ├── db/         @skipper/db        — Drizzle schema + Neon client.
│   └── generator/  @skipper/generator — server-side tour generation (M1).
├── tsconfig.base.json · turbo.json · package.json (bun workspaces)
```

Internal packages export **TypeScript source** directly (no dist build) — bun
runs `.ts`, and `tsc --noEmit` type-checks. There is no `tsx`, no
`@hono/node-server`: bun covers both.

## Getting started

```bash
bun install
bun run dev                 # dotenvx decrypts .env.development, then turbo -> bun --watch the api (http://localhost:8787/health)
bun run typecheck           # turbo -> tsc --noEmit across all packages
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

**Milestone: monorepo scaffold.** Skeleton + shared schema + Drizzle data model +
runnable bun-native API health route + AI model constants. The generator pipeline,
API routes, and the mobile/CarPlay app are stubs/deferred. See `CLAUDE.md` for the
milestone plan and the explicit v1 non-goals.
