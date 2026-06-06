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
- **AI:** Anthropic `claude-opus-4-8` (narration) · OpenAI `gpt-4o-mini-tts` (TTS)
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
cp .env.example .env        # fill in keys (Neon, Anthropic, OpenAI, Google, R2)
bun run typecheck           # turbo -> tsc --noEmit across all packages
bun run dev                 # turbo -> bun --watch the api (http://localhost:8787/health)
```

### Database

```bash
bun --env-file=.env --filter @skipper/db db:push     # apply schema to Neon
bun --env-file=.env --filter @skipper/db db:studio    # browse
```

## Status

**Milestone: monorepo scaffold.** Skeleton + shared schema + Drizzle data model +
runnable bun-native API health route + AI model constants. The generator pipeline,
API routes, and the mobile/CarPlay app are stubs/deferred. See `CLAUDE.md` for the
milestone plan and the explicit v1 non-goals.
