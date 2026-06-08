# Skipper — working notes for agents

A toy/lifestyle project: an AI-narrated, GPS-triggered driving audio tour with a
Jungle-Cruise-skipper persona, played as phone audio (CarPlay later). **Optimize for charm, not scale.
The persona is the product.** When a choice trades polish-for-the-builder against
scale-for-a-market, pick polish.

## Two principles that govern the architecture

1. **Assemble per request; generate content once per place.** `pois` +
   `poi_content` are a cache; `tours` + `tour_stops` are the assembly.
2. **The rails are the route; generation is everything inside the rails.** Routes
   are hand-curated + frozen, never derived. The failure mode to avoid is letting
   "curated" creep into the _contents_ — if the model just reads a fixed script,
   you've rebuilt Shaka Guide with extra steps.

## Hard invariants (enforced in code; don't regress them)

- **Tours stay anonymous/shareable — no `createdBy` on `tours`.** Auth now EXISTS
  (Better Auth, freemium: anonymous → free account → paid `user.tier`) but is
  layered AROUND tours, not on them. Signed-in users save via the `saved_tours`
  join, never ownership columns. Anonymous users get a shareable preview
  (`tours.isPreview`); full playback needs a free account. Audio is PRIVATE in R2;
  the API serves presigned URLs after the tier check (so the wall is real).
- **`pois` deduped by `(source, source_id)`.** Store `source`/`source_id` for
  attribution — Wikipedia is **CC BY-SA**, keep credit (attribution snapshot is
  frozen on `poi_content` at generation time).
- **`poi_content` cache key = `(poi_id, persona, voice, joke_level)`.** The
  Dad-Joke-O-Meter notch (`off`/`mild`/`dad`/`dadpocalypse`) is a
  GENERATION-time parameter and part of the key — not a live playback toggle.
- **A tour may not be `ready` until every story/scenic stop has non-null audio.**
  Generator enforces; player also defends.
- **Persona lives in DELIVERY, never in FACTS.** "Make it funny" never loosens
  accuracy. A POI with thin/no Wikipedia is downgraded to scenic/break — silence
  beats a hallucinated battle.
- **Break stops MAY name the place + category, but bake NO VOLATILE data**
  (hours, rating, "open till 9", popularity, features). The break's `name`/`kind`
  come from the curated Places anchor (a minimal non-volatile field mask) and are
  spoken in the clip like the region is; everything volatile is fetched fresh at
  tour-load (and "ask the skipper" later). Break audio is **mandatory** — every
  selected break gets a `poi_content` clip; the tour can't be `ready` without it.
  (NOTE: baking the Places name into a frozen R2 clip extends its lifetime past the
  DB anchor — mind Places ToS; `patch-clip` re-synths one clip if a place renames.)

## Stack notes

- **bun everywhere** (package manager + runtime). Internal packages export `.ts`
  source (no dist build); bun runs it, `tsc --noEmit` type-checks. No `tsx`, no
  `@hono/node-server`.
- Verified pins: TS 6.0.3, zod 4.4.3 (`z.enum`, top-level
  `z.uuid()`/`z.url()`), drizzle-orm 0.45.2 + drizzle-kit 0.31.10 (neon-http,
  stateless — no interactive transactions; use `db.batch`), hono 4.12.23,
  @anthropic-ai/sdk 0.102.0. **TTS = Google Cloud Text-to-Speech via REST** (no SDK
  — raw `fetch` to `texttospeech.googleapis.com/v1/text:synthesize` with a
  Gemini-TTS voice (`gemini-2.5-pro-tts`, "Algenib"); OAuth/ADC via
  `google-auth-library`, NO API key; returns LINEAR16 PCM → we wrap a playable WAV
  and derive exact duration from the byte length. Switched off ElevenLabs (commit
  `6af019e`) to bill GCP credits and dodge its quota + 2026-12-31 voice sunset).
  **R2 =
  Bun's native `S3Client`** (no `@aws-sdk`; `region: "auto"`); the generator
  tsconfig needs `types: ["node","bun"]` for it.
- **Auth = Better Auth** (`apps/api/auth.ts`). It needs interactive transactions,
  so it runs on its OWN `drizzle-orm/neon-serverless` Pool client (`auth-db.ts`)
  while the rest of the app stays on neon-http. Its tables live in
  `@skipper/db/auth-schema.ts` (CLI-generated: `bunx @better-auth/cli generate`,
  then `db:generate` + `db:migrate`). `user.tier` ('free'|'paid') is the manual
  freemium flag (no Stripe yet); `accessTier` ('anonymous'|'free'|'paid') is the
  derived per-request tier in `@skipper/shared`.
- **Secrets via dotenvx.** `.env.development` / `.env.production` are committed
  ENCRYPTED (public-key); the private keys live only in gitignored `.env.keys`.
  Root scripts wrap commands with `dotenvx run -f .env.development` — so `bun run
dev` and `bun run db:*` get decrypted vars; don't add a plaintext `.env`. Edit
  a value with `dotenvx set KEY "v" -f .env.development`; `.env.example` is the
  plaintext catalog of what exists. Deploy: set `DOTENV_PRIVATE_KEY_PRODUCTION`
  in the host env. Onboarding = get `.env.keys` from a teammate.
- The **highest-leverage file** in the repo (once written) is the skipper
  narration system prompt. Iterate on it more than anything.

## Mobile UI — design system ("Trailhead 89")

`apps/mobile` has a real design system; **don't hand-roll styles or hardcode
values.** Source of truth: `src/theme/` (raw tokens → semantic light/dark color
ROLES → provider + font gate), `src/ui/` (primitives + a couple of "smart"
composites like `AccountGate`/`StateView`), and `apps/mobile/DESIGN.md` (the
language: WPA national-park aesthetic, **dark-mode-first** for night drives,
glanceable/in-car). Screens compose `@/ui` and reference semantic roles
(`color="ink"`) — NEVER a raw hex/rgba/`fontFamily`; colors live only in `src/theme`.

- **Enforced, not aspirational** (a review found doc↔code drift is the real failure
  mode): `bun run lint:tokens` fails on a raw color/font in `app/` or `src/ui/`; a
  contrast unit test (`bun test`) asserts every text role clears 4.5:1 on
  surface+raised in both themes (the DESIGN §4 guarantee). `bun run check` =
  lint:tokens + typecheck + test. Run them when touching mobile UI.
- **Icons are VECTOR** (`@expo/vector-icons` via `src/ui/Icon.tsx`, semantic names) —
  NOT emoji. This build has no color-emoji fallback, so emoji render as tofu (`?`).
- `*.test.ts` run under `bun test` (which provides `bun:test` types); the app `tsc`
  excludes them (mobile is outside the workspace, no `@types/bun`).

## Milestones

0. **Content + phone-player spike.** Skipper prompt; ~6–8 Tahoe corridors; stand
   up the **phone** audio player — that is the MVP target, and its build (Expo
   SDK 56 / RN 0.85 / new arch) decides the SDK pin. **CarPlay is no longer a
   hard gate** — it's deferred past the MVP (see Deferred). The MVP plays through
   the phone (in a mount / over Bluetooth), not CarPlay. You may file the
   `carplay-audio` Apple entitlement in the background since Apple review is slow,
   but nothing waits on it.
1. **Walking skeleton.** ONE corridor, ONE duration, `dadpocalypse` only.
   Generator → narration → TTS → R2 → Neon (no cache/dedup/feedback). Build the
   **drive simulator**. Player: download offline → simulated drive → correct
   speed-adaptive triggering + debounce → audio + lock-screen **Now Playing on
   the phone** (CarPlay deferred). Then drive it once for real. _This is the
   whole bet._
2. **`apps/api`:** list corridors, fetch tour, signed R2 URLs.
3. **Breadth:** more corridors, fixed durations, interest filtering, joke notches,
   live break-stop Places data.
4. **Earn the machinery:** the cache + `route_sig` dedup, human-review/feedback,
   then more regions (Yosemite → Moab; mind seasons).

## Deferred — DO NOT build these in v1

Segment trimming / arbitrary start points; the cache-variant + dedup machinery
(until M4); any automated groundedness gate (human ear instead); **CarPlay
entirely for v1** — both the audio **Now Playing** template
(`@g4rb4g3/react-native-carplay` + the `carplay-audio` entitlement) and the
**map** template (needs `carplay-maps`); the MVP ships phone audio (lock-screen
Now Playing), and CarPlay is revisited only after the phone player proves the
bet; Android Auto; multilingual; the live conversational agent + on-device
fallback (see **Future ideas → "Ask the Skipper"** for the concrete shape).

## Future ideas (post-MVP, not scheduled)

Captured so they aren't lost; NONE are v1. Each is gated behind the phone-player
bet being proven first.

- **"Ask the Skipper" — conversational follow-ups** (the concrete shape of the
  deferred "live conversational agent"). While a tour plays, the rider asks a
  spoken follow-up ("hey skipper, tell me more about that island") → **STT**
  (voice→text) → a **grounded, in-persona LLM** answer → **streaming TTS**
  (text→voice) back in the SAME skipper voice (Algenib), ducking the tour audio
  then resuming. Why it's hard / what it stresses:
  - **Inverts the core architecture.** Today we "generate once per place, assemble
    per request" as an OFFLINE batch; this is LIVE, per-utterance, and
    latency-critical (sub-second to feel conversational) — a different generation +
    TTS path (a streaming voice, not the batch LINEAR16→WAV we use now).
  - **Grounding is THE problem, amplified.** A live LLM answering open questions
    will hallucinate. Answers MUST be grounded in the stop's fact sheet / Wikipedia
    (RAG over the same facts the narration used) with a persona-true "that one's
    not in my logbook" fallback — deflection beats a hallucinated battle. This is
    the "Persona lives in DELIVERY, never in FACTS" invariant extended to live Q&A;
    do NOT let conversation become an ungrounded-fact backdoor.
  - **Hands-free + driving safety first.** Wake word or a single big push-to-talk
    target; barge-in (interrupt the tour); auto-duck then resume.
  - **Context window.** The LLM needs current stop + recent narration + route
    position so "tell me more about _that_" resolves to the right place.
  - **Connectivity + cost.** Live STT+LLM+TTS costs per turn AND needs a network —
    fails in Tahoe dead zones (hence the "on-device fallback" already noted); gate
    or queue it when offline.
  - **Sequencing:** a v2 delighter — gate behind the proven phone player (M1), and
    reuse the existing fact sheets + Algenib voice so the skipper sounds continuous.

## In-car player landmines (when you get there)

- **Triggering:** do NOT rely on fixed-radius background polling — the OS
  throttles background GPS and a car sails through a 350 m geofence at 60 mph.
  Use a continuous high-rate foreground service + speed-adaptive lead time;
  `trigger_radius_m` is a floor, not the rule. Heading gate only above ~5 mph.
- **Audio:** `expo-audio` (NOT `expo-av`, removed in SDK 55); background playback
  via config plugin. Duck (don't stop) the user's music at a trigger.
- **Offline-first:** download a complete tour before driving (Tahoe dead zones).

## Scaffold review notes (carry into M1/M2)

From an adversarial review of the scaffold. Verdict: sound foundation. Guardrails:

- **Type-name collisions.** `@skipper/shared` (Zod boundary types) and
  `@skipper/db/schema` (Drizzle `$inferSelect` row types) both export `Poi`,
  `Tour`, `PoiContent`, `Corridor`, `TourStop`, `Polyline` — DIFFERENT shapes
  (Zod = read DTOs: nullish, omit internal cols like `facts`/`meta`). Use Zod
  types from `@skipper/shared` at boundaries; import DB row types only from the
  `@skipper/db/schema` subpath, aliased (`import type { Poi as PoiRow }`). NEVER
  `export * from` both in one barrel. The `@skipper/db` client deliberately does
  NOT re-export the schema.
- **`@skipper/db` import is side-effect-free.** The client is lazy (`getDb()` /
  the `db` proxy build on first query) so importing it never forces
  `DATABASE_URL` to exist — env-free routes like `GET /health` keep booting.
- **Cache-key dimensions are DB-enforced.** `poi_content` uniqueness is
  `(poi_id, persona, voice, joke_level)`; `persona`, `joke_level`, and
  `duration_bucket` are all pgEnums, so the dedup key can't fragment on a typo.
- **`voice` is a fixed function of persona in v1** (`PERSONA_VOICE` in
  `packages/generator/src/models.ts`: skipper → the Google Cloud Gemini-TTS voice
  name "Algenib", stored verbatim as the cache-key `voice`). Not a request knob
  until M3 (no `tours.voice` / `tourRequest.voice` yet). (Gemini-TTS voice names
  are stable identifiers — no ElevenLabs-style default-voice sunset to mind.)
- **M1 generator MUST populate `poi_content.attribution`** for every
  wikipedia-sourced clip (CC BY-SA is legal, not optional) — put it on the
  generation invariant checklist + the human-review gate.
- **scenic ≠ break.** A scenic stop is delivery-only ambient audio (no facts); a
  break stop names the curated Places anchor (name + kind only). Both — and story —
  now need a `poi_content` row with non-null `audioUrl`: as of break-narration,
  **every** stop type carries audio and the ready-gate requires it on all of them
  (no stop type is silent anymore).
- **M1 ready-gate is atomic via `db.batch([...])`** — neon-http has no
  interactive transactions, but co-committing the `status='ready'` flip with the
  final stop writes in one batch suffices (no neon-serverless Pool needed).
- **M4 cache invalidation.** Deleting a `poi_content` row `SET NULL`s a stop's
  content pointer without demoting `tours.status` from `ready` — pair content
  deletes with tour re-validation when the cache/dedup machinery lands.
- **M4 cache precondition — `stopType` is NOT in the `poi_content` key.** The key
  is `(poi_id, persona, voice, joke_level)`, but whether a Wikipedia POI is
  narrated as `story` vs `scenic` is decided by extract length at generation time
  (`STORY_MIN_FACT_CHARS`). When the cache is reused across tours (M4), a
  classification flip on regen (a Wikipedia lead-section edit, or tuning
  `EXTRACT_CHARS`/`STORY_MIN_FACT_CHARS`) makes `upsertPoiContent` overwrite the
  shared row — a still-`ready` tour could then serve scenic audio for a `story`
  stop (or a story clip, which NAMES the place, for a `scenic` stop) and lose its
  attribution. M1 is safe (generate-and-use-the-new-tour, no reuse). Before M4
  reuse: either fold `stopType` into the key (widens this invariant — a
  deliberate decision) or store `stopType` on `poi_content` and reject/re-validate
  cross-type conflicts, paired with tour re-validation.
