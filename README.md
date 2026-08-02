# Skipper

An AI-narrated, GPS-triggered driving audio tour. Think _Shaka Guide, but the
narration is AI-generated_ — played by a charming Jungle-Cruise-skipper persona,
over a route you pick (any A→B), as phone audio (CarPlay later). First region:
**Lake Tahoe**.

> **Posture:** a toy / lifestyle side project. Optimize for _charm_ and for being
> a thing the founder actually wants to use — not for scale or defensibility.
> **The persona is the product.**

**Working in this repo?** `CLAUDE.md` is the operating truth — doctrine, hard invariants,
stack, and the (multi-agent) git workflow; read it before changing anything. Durable
decisions, specs, and ideas live in `docs/` (indexed in `docs/README.md`).

## The two principles

1. **Fetch FACTS once per place; the NARRATION is the shared atom; ASSEMBLE per drive.**
   `pois` is the facts cache — a place's grounded facts (TTL + hash), SHARED by every
   drive. Each place has ONE shared telling: a `narrations` row (1:1 per poi). ONE thing
   consumes that corpus: the user-owned **DRIVE**, which REUSES those narrations
   pre-ordered along its route. Content resolves LIVE via subject id, so a regenerated
   telling auto-improves every saved drive. (The anonymous front door is the PLANNER —
   plan/propose a route + one preview clip — not a second content mode.)
2. **The route is the rails; the generation is everything inside.**
   A drive's route is materialized from the rider's A→B (Google Routes) and frozen per
   drive — the LLM resolves ONLY the endpoints, and the SELECTION of which narrations ride
   the route is deterministic. Inside the rails the corpus does the work: which stories,
   the persona, pacing, the voice. _Hand-authored tours are deferred — the rider picks the
   road, the shared corpus narrates it._

## Stack

- **TypeScript 6** everywhere · **bun** (package manager + runtime + workspaces)
- **Backend:** Hono (served natively by bun) · **DB:** Neon + Drizzle · **Auth:** Better Auth (freemium) · **Audio:** Cloudflare R2 (private; presigned URLs) via `@skipper/storage`
- **Routing:** Google Routes (A→B route materialization) via `@skipper/routing`
- **AI:** Anthropic `claude-opus-4-8` (narration) · Google Cloud Text-to-Speech — Gemini-TTS voice "Charon" (OAuth/ADC, no API key; AAC-LC 48 kbps .m4a — LINEAR16 from TTS, then ffmpeg loudnorm + AAC encode)
- **Mobile (MVP = phone player):** Expo SDK 56, `expo-audio` + `expo-location`; CarPlay (`@g4rb4g3/react-native-carplay`) deferred past the MVP

## Layout

```
skipper/
├── apps/
│   ├── api/        @skipper/api       — Hono API: /drives (+ /drives/plan, /drives/propose), /regions, /sample, signed R2 URLs. Bun-native serve.
│   ├── admin/      @skipper/admin     — Vite + Hono ops console (cloud-run the studio CLIs) behind Google IAP.
│   ├── site/       @skipper/site      — Astro landing page (skipper.fm).
│   └── mobile/     @skipper/mobile    — Expo app. Phone player is the MVP (CarPlay later).
├── packages/
│   ├── shared/     @skipper/shared    — Zod schemas + types, imported everywhere.
│   ├── db/         @skipper/db        — Drizzle schema + Neon client.
│   ├── studio/     @skipper/studio    — server-side narration/corpus generation (discover → enrich → generate).
│   ├── routing/    @skipper/routing   — Google Routes client (A→B route materialization).
│   ├── storage/    @skipper/storage   — Cloudflare R2 / S3 client (audio upload + presign).
│   ├── engine/     @skipper/engine    — pure geo + trigger engine + drive sim (RN-safe; shared by sim & mobile).
│   └── sim/        @skipper/sim       — DB-backed drive-sim CLI (runs @skipper/engine against a real drive).
├── design-system/  — browsable HTML mirror of the "Trailhead 89" design system (open index.html). A specimen book; not a workspace. Canonical source = apps/mobile/DESIGN.md + src/theme + src/ui.
├── tsconfig.base.json · package.json (bun workspaces)
```

Internal packages export **TypeScript source** directly (no dist build) — bun
runs `.ts`, and `tsc --noEmit` type-checks. There is no `tsx`, no
`@hono/node-server`: bun covers both.

## Getting started

```bash
bun install
bun run dev          # the API on http://localhost:8787 (dotenvx decrypts .env.development, bun --watch)
bun run check        # lint:docs + lint:types + lint:enums + typecheck + test — run before committing
```

Other dev surfaces (the human keeps these running — use them, don't restart a live one):

- `bun run dev:admin` — the ops console (Vite client **:5173** → Hono admin-api **:8788**; cloud-runs the studio CLIs)
- `bun run dev:site` — the Astro landing page
- `bun --filter @skipper/mobile start` — the Expo phone player
- `bun run sim` — the DB-backed drive simulator (`packages/sim`)

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

