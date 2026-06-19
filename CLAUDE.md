# Skipper — working notes for agents

A toy/lifestyle project: an AI-narrated, GPS-triggered driving audio tour with a
Jungle-Cruise-skipper persona, played as phone audio (CarPlay later). **Optimize for charm, not scale.
The persona is the product.** When a choice trades polish-for-the-builder against
scale-for-a-market, pick polish.

## Posture & doctrine

**Correctness over cost — never let spend-anxiety pick a worse design.** Choose the right architecture and
let the model/tooling do the judgment even when a cheap heuristic would save a few dollars (don't keep an
arbitrary char-count pre-filter ahead of a paid `enrich` step — let the enricher decide). Triggering a paid run still needs a founder OK; that *spend* guardrail never licenses a cheaper-but-worse design.

**No users yet — break things freely (a STORAGE rule).** The app has ZERO real users, so
schema / storage changes need NO backward-compatibility and NO careful data migration:
prefer CLEAN, DESTRUCTIVE migrations (drop + recreate) over preserving legacy rows or
nullable-for-back-compat columns. The one founder-OK gate that survives is COST (the *spend*
guardrail above — a live regen burns GCP credits; the canonical-preview "demo" exception was
dropped 2026-06-11, every tour treated the same). **Scope (2026-06-09):** this licenses breaking
STORAGE, not the wire contract — once v1 is in the App Store, installed clients lag, so
the API/DTO surface (`@skipper/shared` + `apps/api` routes) stops being break-freely even
while the DB stays destructive-OK. Posture now SET (`docs/decisions/api-versioning-posture.md`):
**no URL versioning** — evolve the contract additively; the shipped server-`/version`
force-upgrade gate is the sole escape hatch for a hard break.

**Ground tooling/dependency/version decisions in authoritative docs, not memory.**
The stack moves fast (bun, Expo/RN, drizzle, the SDKs) and a model's training data
goes stale — when a build/resolution/config question comes up (e.g. "should this
workspace be hoisted or isolated?"), pull the actual current docs (official docs,
changelogs, the package's own pages) and decide from what they SAY, not from
assumption. The failure mode this prevents: a plausible-sounding fix that papers over
the recommended path (a real case: forcing `linker = "hoisted"` worked, but the
docs showed SDK 56 + bun both default to and support **isolated** — and the errors it
"fixed" were isolated correctly flagging an undeclared `expo-font` import). Cite what
you found so the next agent can re-check it.

## Where truth lives

- **This file = operating truth.** Doctrine, hard invariants, stack, workflow — only what an
  agent must know to avoid breaking something or burning money. When something here is
  superseded, DELETE it and record the history in the relevant `docs/decisions/` record —
  no strikethrough graveyards.
- **`TODO.md` = the engineering backlog.** Actionable near-term items with enough context to
  act on; delete items when done (git history is the archive).
- **`docs/` = durable records**, foldered by KIND with a dated status line per doc for STATE:
  `decisions/` (why things are this way — append-only), `specs/` (build-ready future),
  `ideas/` (pre-spec future), `research/`, `guides/`. Conventions + index: `docs/README.md`.
- **Code = the rest of current truth.** A doc that disagrees with the code is wrong — fix
  the doc. Handoff docs are ephemeral: written for one baton pass, deleted once consumed.

## Git workflow

- **Never create or switch to a new branch without confirming with the human first.**
  Don't `git switch -c` / `git checkout -b` (or move onto a different branch) on your
  own — even when committing, and even though the generic "branch before committing on
  the default branch" habit says otherwise. This repo's default is to **commit directly
  to `main`**; if you think a branch is warranted, propose it and wait for an explicit
  yes. (Multiple agents share this one working tree, so unannounced branch switches are
  especially disruptive.)

- **Commits on `main` must be surgical, explicit, and atomic — never leave changes STAGED.**
  Multiple agents share this one working tree AND its single git index, so the working set is
  almost always a MIX of your changes and other agents' (and pre-existing) uncommitted work —
  and anything you `git add` sits in a SHARED staging area another agent's commit can then sweep
  in. So NEVER `git add -A` / `git add .` / `git commit -a`, and never `git add` early or to
  "checkpoint" progress. Stage + commit in ONE step at the very end: `git commit path/a path/b`
  (it stages exactly those paths and commits, leaving the index clean); confirm first with
  `git diff --stat path/a path/b`. A blanket or premature add sweeps in someone else's
  half-finished work — the exact failure this repo's multi-agent setup invites.

- **The working tree + index are SHARED — never run a command that touches another agent's work.**
  NO destructive or whole-tree git: `git stash` / `reset --hard` / `checkout -- .` / `restore .` /
  `clean` / `rebase` each hit the WHOLE shared tree/index and silently eat others' uncommitted work
  (one `git stash` pockets everyone's) — use path-scoped variants only. Re-check a file is still
  SOLELY yours right before committing (`git diff --stat path/a path/b`); if it now carries another
  agent's hunk, leave it UNCOMMITTED for its owner — never sweep or clobber. No repo-wide auto-fixers
  (`prettier --write .`, `eslint --fix`, codemods) — scope formatters to your own files.

- **Docs ride along with the change.** If your work ships, supersedes, or invalidates
  anything described in `docs/` (or in this file), update that doc's status line in the
  SAME commit — statuses flip in place; files never move on a state change. The structure
  is enforced: `bun run lint:docs` (root; also first in root `bun run check`, and auto-run
  by a project hook on docs edits) fails on loose/unknown docs locations, a missing
  **Status** line, `*-handoff.md` files, bare `docs/<file>.md` paths, and a CLAUDE.md
  size over its ceiling.

## Two principles that govern the architecture

1. **Fetch FACTS once per place; the NARRATION is the shared atom; ASSEMBLE per drive.**
   `pois` is the facts cache — a place's facts/coords, deduped by Wikidata **QID** (`pois_qid_uq`;
   `(source, source_id)` is a secondary guard, not the arbiter) and re-fetched on a TTL
   (`facts_fetched_at` is the staleness clock; refresh is operator-run via `refetch_facts`/re-sweep).
   Each place has ONE shared telling: a `narrations` row (1:1 with its poi — audio/persona
   baked). **ROAM plays narrations by proximity; a DRIVE REUSES
   them, pre-ordered along its route** — content resolves LIVE via `poi_id`, so a regenerated telling
   auto-improves every saved drive. Delivery belongs to the narration; facts belong to the place (the
   "persona lives in DELIVERY, never in FACTS" invariant, mapped onto storage). When a re-fetch
   MATERIALLY changes a poi's facts (via `pois.facts_hash`), every narration that grounded on them is
   stale and must regenerate. (V2 2026-06-18: V1's per-tour `segments`+`tracks` collapsed into the 1:1
   `narrations` atom; zero-reuse now governs only the DEFERRED authored-tour rung — see
   `docs/decisions/tour-data-model-zero-reuse.md` + `create-a-drive-architecture.md`.) **The corpus
   pipeline is `discover` → `enrich` → `generate` (2026-06-15):** a free sweep populates `pois` for a
   region's bbox ONCE (`discover-pois.ts`); a PAID `enrich` (`enrich-pois.ts`) scouts each story
   poi ONCE into a curated **verbatim fact sheet** (its own typed `pois.fact_sheet` column +
   `enriched_at`; `facts_hash` keys on it), and roam + drives SELECT from that one shared corpus +
   ground on the fact sheet. A STORY telling REQUIRES a sheet (#1, 2026-06-16) — an un-enriched POI is
   downgraded to scenic, NEVER narrated from the raw extract ("silence beats a bad telling"). Drives
   are user-created at runtime (`POST /drives` → `buildDrive`); hand-authored tours are DEFERRED. See
   `docs/decisions/region-corpus-discovery.md` + `corpus-enrichment.md`.
2. **The route is the rails; generation is everything inside.** A drive's route is materialized
   from the rider's A→B (Google Routes), frozen per drive — the LLM resolves ONLY the endpoints; the
   SELECTION of which narrations ride the route is deterministic (`buildDrive`). The failure mode to
   avoid is letting "curated" creep into the _contents_ — if the model just reads a fixed script,
   you've rebuilt Shaka Guide with extra steps.

## Hard invariants (enforced in code; don't regress them)

- **Hand-authored tours are DEFERRED; the first-day artifacts are ROAM + user-owned DRIVES.**
  Auth EXISTS (Better Auth, freemium: anonymous → free account → paid `user.tier`). ROAM is the
  anonymous front door (open, no account). A **DRIVE is user-OWNED** — ownership lives on
  `drives.user_id` (a user-side table), NEVER on a shared content table. **Anonymous = roam only;
  creating a drive needs a free account** (the create-action wall — the whole `/drives*` sub-app is
  behind `requireAccount`). Free-tier credits are an append-only `credit_entries` ledger (a lazy
  `FREE_DRIVE_CAP`=10 grant, −1 consumed at `POST /drives`); beyond → a purchased pack (provider-
  agnostic IAP source, deferred). See `docs/decisions/credit-ledger.md`. A drive is NOT
  anonymous-shareable (it's owned), so
  `/t/:id` serves GENERIC Open Graph. Audio is PRIVATE in R2 (presigned, short TTL, after the tier
  check). (V2 2026-06-18: the V1 "every tour previewable / wall on the drive" funnel is gone with
  authored tours.)
- **Region is a BBOX, never a stored FK (geometry-first, 2026-06-19).** A POI's region = point-in-bbox; a DRIVE stores its route bbox (stale-proof) + derives region by intersect — NO `region_id` FK anywhere (`docs/decisions/geometry-first-regions.md`).
- **`pois` deduped by Wikidata QID (`pois_qid_uq`)** — every poi is Wikidata-discovered (`source`
  ∈ {wikipedia, wikidata}); `(source, source_id)` is a secondary guard, not the arbiter (it survives
  a scenic↔story tier flip). Keep `source`/`source_id` for attribution — Wikipedia is **CC BY-SA**,
  keep credit (frozen on the `narration` at generation). Google break anchors are NOT pois — they're
  the `places` table (`google_places` = attribution-only).
- **The Dad-Joke-O-Meter notch (`off`/`mild`/`dad`/`dadpocalypse`), persona, and
  voice are GENERATION parameters, baked into the narration — never live playback
  toggles** (see principle #1). Changing any of them = a different telling. The
  **persona** is resolved in CODE at generation (`personaFromKey`, default `'skipper'`, one host per
  region in v2 → `PersonaDef`) and baked into the narration's AUDIO/delivery — there is NO persona
  column on `narrations` (one host needs none; a per-narration key returns with region-skippers, M4).
  The host DEFINITION lives in the `PersonaDef` registry in code (the `personas` table was dropped in
  migration 0014); v2 playback shows a fixed `'Skipper'`. **Voice** (no column) derives from the persona, and the
  **notch** is a generation-time INPUT only, hardcoded to `dadpocalypse` in `generate-narrations.ts`
  (no CLI joke-level flag yet) — NOT persisted (M1 is dadpocalypse-only). The `jokeLevel` Zod enum in
  `@skipper/shared` stays as the narration vocabulary.
- **A narration is only live once it has non-null audio** (story + scenic — `audio_url` is NOT NULL
  on `narrations` at the DB boundary; break audio is the deferred `detours` table, also `audio_url`
  NOT NULL). The studio pipeline enforces; the player also defends. A drive can't be `ready` until
  every selected stop resolves to audio.
- **Persona lives in DELIVERY, never in FACTS.** "Make it funny" never loosens
  accuracy. A POI with thin/no Wikipedia is downgraded to scenic/break — silence
  beats a hallucinated battle.
- **Break stops MAY name the place + category, but bake NO VOLATILE data**
  (hours, rating, "open till 9", popularity, features). A break anchor lives in the `places` table
  (Google `place_id`, NOT a poi); its `name`/`primary_type` are a minimal non-volatile mask, spoken
  in the clip like the region is; everything volatile is fetched fresh at drive-load (and "ask the
  skipper" later). Break AUDIO is the `detours` table (1:1 per place, `audio_url` NOT NULL, so a
  silent break never rides a drive) — **DEFERRED/stubbed today** (nothing writes it yet). (NOTE: a
  baked Places name in a frozen R2 clip outlives the DB anchor — mind Places ToS.)

## Stack notes

- **bun everywhere** (package manager + runtime). Internal packages export `.ts`
  source (no dist build); bun runs it, `tsc --noEmit` type-checks. No `tsx`, no
  `@hono/node-server`.
- Verified pins: TS 6.0.3, zod 4.4.3 (`z.enum`, top-level
  `z.uuid()`/`z.url()`), drizzle-orm 0.45.2 + drizzle-kit 0.31.10 (neon-http,
  stateless — no interactive transactions; use `db.batch`), hono 4.12.25,
  @anthropic-ai/sdk 0.104.1.
- **TTS = Google Cloud Text-to-Speech via REST** (no SDK — raw `fetch` to
  `texttospeech.googleapis.com/v1/text:synthesize`), model `gemini-3.1-flash-tts-preview`
  with Gemini-TTS voice "Charon" (`TTS_MODEL` / `SKIPPER_VOICE_ID` in `models.ts`);
  OAuth/ADC via `google-auth-library`, NO API key. Output is **AAC-LC 48 kbps `.m4a`**:
  TTS returns LINEAR16 (lossless), then ONE ffmpeg pass in `pipeline/loudnorm.ts`
  (`normalizeAndEncode`) does loudnorm + the single AAC encode; exact duration from the
  PCM byte length (`pipeline/wav.ts`). **ffmpeg is REQUIRED on ship paths** (it's the
  encoder, not just QA — throws if absent; Cloud Run carries it). The 2026-06-14 switch
  off MP3-direct dropped a double-encode — see `docs/decisions/audio-compression-spike.md`.
  Switched off ElevenLabs (commit `6af019e`) to bill GCP credits and dodge its quota +
  2026-12-31 voice sunset.
- **R2 = Bun's native `S3Client`** (no `@aws-sdk`; `region: "auto"`); the studio pipeline
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
- **Local dev servers stay UP — don't boot/restart them.** The human keeps the dev
  processes running continuously; assume they're already listening and just use them
  (check with `lsof -nP -iTCP:<port> -sTCP:LISTEN`). Ports: API `bun run dev`; admin
  `bun run dev:admin` = vite client on **:5173** proxying `/admin`+`/health` → Hono
  admin-api on **:8788** (`ADMIN_DEV_BYPASS=1` skips IAP locally); site `bun run dev:site`.
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
  excludes them (mobile has no `@types/bun`).

## Milestones

(V2 reframing 2026-06-18: the ladder is now ROAM + user-owned DRIVES, not hand-authored
tours — those are DEFERRED. The phone-player bet itself is unchanged; the content artifact
is a region's shared `narrations` corpus, and a drive REUSES it pre-ordered along an A→B route.)

0. **Content + phone-player spike.** Skipper prompt; a Tahoe **roam corpus** (shared
   `narrations`, one telling per place); stand up the **phone** audio player — that is the
   MVP target, and its build (Expo SDK 56 / RN 0.85 / new arch) decides the SDK pin.
   **CarPlay is deferred** past the MVP (see Deferred) — the MVP plays through the phone
   (mount / Bluetooth). The `carplay-audio` entitlement can be filed in the background (Apple
   review is slow), but nothing waits on it.
1. **Walking skeleton.** ROAM as the anonymous front door + ONE user-created **drive**
   (A→B → route → reuse roam narrations pre-ordered), `dadpocalypse` only.
   discover → enrich → generate → TTS → R2 → Neon. Build the **drive simulator**. Player:
   download offline → simulated drive → correct speed-adaptive triggering + debounce →
   audio + lock-screen **Now Playing on the phone** (CarPlay deferred). Then drive it once
   for real. _This is the whole bet._
2. **`apps/api`:** `/roam` (anonymous), `/drives*` (account-gated create + list + fetch),
   `/regions`, signed R2 URLs.
3. **Breadth:** more regions' corpora, joke notches as a per-drive setting (notch = 1-N off
   a drive), live break-stop Places data. (Duration = skip-stops, interests = a stop filter
   — both deferred, NOT variant drives.)
4. **Earn the machinery:** `route_sig`/`drive_demand` drive-dedup + caching,
   human-review/feedback, then more regions (Yosemite → Moab; mind seasons). (No content
   cache under zero-reuse — the only "cache" is the `pois` facts TTL + hash-staleness, see
   `docs/decisions/tour-data-model-zero-reuse.md`; hand-authored tours stay DEFERRED.)

## Deferred — DO NOT build these in v1

Segment trimming / arbitrary start points; the cache-variant + dedup machinery
(until M4); any automated groundedness gate (human ear instead); **CarPlay
entirely for v1** — both the audio **Now Playing** template
(`@g4rb4g3/react-native-carplay` + the `carplay-audio` entitlement) and the
**map** template (needs `carplay-maps`); the MVP ships phone audio (lock-screen
Now Playing), and CarPlay is revisited only after the phone player proves the
bet; Android Auto; multilingual; the live conversational agent + on-device
fallback (build-ready spec: `docs/specs/ask-the-skipper-spec.md`).

## Future ideas (post-MVP, not scheduled)

Captured so they aren't lost; NONE are v1, all gated behind the phone-player bet being proven
first. Full write-ups + index live in `docs/ideas/` (pre-spec) and `docs/specs/` (build-ready) —
see `docs/README.md`. The north-star delighter is **"Ask the Skipper"** (live, grounded,
in-persona voice Q&A mid-drive — `docs/specs/ask-the-skipper-spec.md`).

## In-car player landmines (when you get there)

- **Triggering:** do NOT rely on fixed-radius background polling — the OS
  throttles background GPS and a car sails through a 350 m geofence at 60 mph.
  Use a continuous high-rate foreground service + speed-adaptive lead time;
  `trigger_radius_m` is a floor, not the rule. Heading gate only above ~5 mph.
- **Audio:** `expo-audio` (NOT `expo-av`, removed in SDK 55); background playback
  via config plugin. Duck (don't stop) the user's music at a trigger.
- **Offline-first:** download a complete tour before driving (Tahoe dead zones).

## Engineering guardrails

- **Type-name collisions (enforced: `bun run lint:types`).** `@skipper/shared` (Zod
  boundary types) and `@skipper/db/schema` (Drizzle `$inferSelect` row types) can export the same
  NAME at DIFFERENT shapes (Zod = read DTOs: nullish, omit internal cols like `facts`) — today the
  only live collision is `Region` (`Poi` only if/when re-added as a shared DTO). Use Zod types from
  `@skipper/shared` at boundaries; import a DB ROW type only from the `@skipper/db/schema` subpath, ALIASED
  (`import type { Region as RegionRow }`). NEVER `export * from` both in one barrel. (`Polyline`
  collides by name too but is the SAME shape, so the guard ignores it.) The guard derives the
  set from the schema each run; the `@skipper/db` client deliberately does NOT re-export the schema.
- **`@skipper/db` import is side-effect-free.** The client is lazy (`getDb()` /
  the `db` proxy build on first query) so importing it never forces
  `DATABASE_URL` to exist — env-free routes like `GET /health` keep booting.
- **`voice` is a fixed function of persona** (each `PersonaDef.voice` in
  `packages/studio/src/persona/`, resolved in code by `personaFromKey('skipper')` — one host in v2 —
  and baked onto the `narrations` row at generation:
  skipper → the Google Cloud Gemini-TTS voice name "Charon"; `SKIPPER_VOICE_ID` in
  `models.ts` is the source constant the def references). Not a per-request knob (deferred to
  region-skippers, M4). (Gemini-TTS voice names are stable
  identifiers — no ElevenLabs-style sunset to mind.)
- **The studio pipeline MUST populate `narrations.attribution`** for every
  wikipedia-sourced clip (CC BY-SA is legal, not optional) — put it on the
  generation invariant checklist + the human-review gate.
- **scenic ≠ break.** A scenic stop is delivery-only ambient audio (no facts); a
  break stop names the curated Places anchor (name + kind only). Both — and story —
  carry non-null `audio_url` on the `narrations` row: **every** stop type carries audio and
  the ready-gate requires it on all of them (no stop type is silent). Only fact-grounded
  (story) narrations carry a `facts_hash`; scenic/break carry none and are never fact-stale.
