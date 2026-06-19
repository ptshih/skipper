# Skipper

An AI-narrated, GPS-triggered driving audio tour. Think _Shaka Guide, but the
narration is AI-generated_ — played by a charming Jungle-Cruise-skipper persona,
over hand-curated driving routes, as phone audio (CarPlay later). First region:
**Lake Tahoe**.

> **Posture:** a toy / lifestyle side project. Optimize for _charm_ and for being
> a thing the founder actually wants to use — not for scale or defensibility.
> **The persona is the product.**

## The two principles

1. **Assemble per drive; fetch FACTS once per place, the NARRATION is the shared atom.**
   `pois` is the facts cache — a place's grounded facts (TTL + hash), SHARED by every
   drive. Each place has ONE shared telling: a `narrations` row (1:1 per poi). The
   assembly is the user-owned `drives` (an ordered selection of those narrations along a
   route) and anonymous ROAM (the same narrations, played by proximity) — content
   resolves LIVE via `poi_id`, so a regenerated telling auto-improves every saved drive.
2. **The rails are the route; the generation is everything inside the rails.**
   Routes are hand-curated and frozen. Inside the rails the model does
   everything: which stops, what story, pacing, interest filtering, voice.
   _Human picks the road; the model narrates the drive._

## Stack

- **TypeScript 6** everywhere · **bun** (package manager + runtime + workspaces)
- **Backend:** Hono (served natively by bun) · **DB:** Neon + Drizzle · **Auth:** Better Auth (freemium) · **Audio:** Cloudflare R2 (private; presigned URLs)
- **AI:** Anthropic `claude-opus-4-8` (narration) · Google Cloud Text-to-Speech — Gemini-TTS voice "Charon" (OAuth/ADC, no API key; AAC-LC 48 kbps .m4a — LINEAR16 from TTS, then ffmpeg loudnorm + AAC encode)
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
│   ├── generator/  @skipper/studio — server-side narration/corpus generation (discover → enrich → generate).
│   ├── engine/ @skipper/engine — pure geo + trigger engine + drive sim + preview timeline (RN-safe; shared by sim & mobile).
│   └── sim/        @skipper/sim       — DB-backed drive-sim CLI (runs @skipper/engine against a real tour).
├── design-system/  — browsable HTML mirror of the "Trailhead 89" design system (open index.html). A specimen book; not a workspace. Canonical source = apps/mobile/DESIGN.md + src/theme + src/ui.
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

