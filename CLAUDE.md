# Skipper — working notes for agents

A toy/lifestyle project: an AI-narrated, GPS-triggered driving audio tour with a
Jungle-Cruise-skipper persona, played as phone audio (CarPlay later). **Optimize for charm, not scale.
The persona is the product.** When a choice trades polish-for-the-builder against
scale-for-a-market, pick polish.

**No users yet — break things freely (a STORAGE rule).** The app has ZERO real users, so
schema / storage changes need NO backward-compatibility and NO careful data migration:
prefer CLEAN, DESTRUCTIVE migrations (drop + recreate) over preserving legacy rows or
nullable-for-back-compat columns. The only thing still worth a founder OK is COST — a live
regen burns GCP credits. (Added 2026-06-08; the canonical-preview "demo" exception was
dropped 2026-06-11 — there is no special tour, every tour is treated the same.) **Scope (2026-06-09):** this licenses breaking
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

- **Commits on `main` must be surgical and explicit.** NEVER `git add -A` / `git add .`
  / `git commit -a`. Multiple agents share this one working tree, so the working set is
  almost always a MIX of your changes and other agents' (and pre-existing) uncommitted
  work. Stage by explicit path (`git add path/a path/b`), then `git diff --cached --stat`
  to confirm ONLY your intended files are staged before committing. A blanket add sweeps
  in someone else's half-finished work — the exact failure this repo's multi-agent setup
  invites.

- **Docs ride along with the change.** If your work ships, supersedes, or invalidates
  anything described in `docs/` (or in this file), update that doc's status line in the
  SAME commit — statuses flip in place; files never move on a state change. The structure
  is enforced: `bun run lint:docs` (root; also first in root `bun run check`, and auto-run
  by a project hook on docs edits) fails on loose/unknown docs locations, a missing
  **Status** line, `*-handoff.md` files, bare `docs/<file>.md` paths, and a CLAUDE.md
  size over its ceiling.

## Two principles that govern the architecture

1. **Assemble per request; fetch FACTS once per place, generate NARRATION per
   tour.** `pois` is the cache — a place's facts/coords, deduped by
   `(source, source_id)` and re-fetched on a TTL (`facts_fetched_at`); facts are
   SHARED by every tour that visits the place. **Narration is NOT cached — it's
   tour-owned:** a tour's `tour_stops` carry their own `script`/`audio`, so tour 1's
   Camp Richardson is ALWAYS a different telling from tour 2's, even though both point
   at the same `pois` row. Delivery belongs to the stop; facts belong to the place
   (the "persona lives in DELIVERY, never in FACTS" invariant, mapped onto storage).
   There is **no content cache and no cross-tour content reuse** — by design. When a
   re-fetch MATERIALLY changes a poi's facts (detected via `pois.facts_hash`), every
   `tour_stop` that grounded on them is stale and must regenerate. (Decided 2026-06-08,
   superseding the old `poi_content` cache — see `docs/decisions/tour-data-model-zero-reuse.md`.)
2. **The rails are the route; generation is everything inside the rails.** Routes
   are hand-curated + frozen, never derived. The failure mode to avoid is letting
   "curated" creep into the _contents_ — if the model just reads a fixed script,
   you've rebuilt Shaka Guide with extra steps.

## Hard invariants (enforced in code; don't regress them)

- **Tours stay anonymous/shareable — no `createdBy` on `tours`.** Auth now EXISTS
  (Better Auth, freemium: anonymous → free account → paid `user.tier`) but is
  layered AROUND tours, not on them. Signed-in users save via the `saved_tours`
  join, never ownership columns. **EVERY tour is previewable anonymously** (hard
  product requirement): a `?preview=1` fetch/sign is OPEN for any ready tour — the
  couch preview is the funnel, so the audio is intentionally NOT a server wall
  (anyone can stream any tour's clips). The wall **moved to the LIVE DRIVE +
  OFFLINE download**: a request WITHOUT `?preview=1` needs a free account (the
  existing 401 → `AccountGate`), so the in-car drive + offline stay gated — for
  EVERY tour now (no anonymous-drivable demo). The `tours.isPreview` column is
  GONE (dropped 2026-06-09): it was vestigial once preview opened, and the drive
  gate no longer has a per-tour exception. NOTE: because preview streams the same
  presigned bytes, the drive/offline wall is server-enforced only on the
  *unflagged* path — a real byte-level wall would have to gate offline download
  specifically (future hardening). Audio is still PRIVATE in R2 (presigned, short
  TTL). (Changed 2026-06-09: "every tour previewable", wall → the drive, isPreview dropped.)
- **`pois` deduped by `(source, source_id)`.** Store `source`/`source_id` for
  attribution — Wikipedia is **CC BY-SA**, keep credit (the attribution snapshot is
  frozen on the `tour_stop` at narration time).
- **The Dad-Joke-O-Meter notch (`off`/`mild`/`dad`/`dadpocalypse`), persona, and
  voice are GENERATION parameters, baked into the narration — never live playback
  toggles and never a content-cache key** (there is no content cache; narration is
  tour-owned — see principle #1). Changing any of them = a different telling. None of
  them is a stored `tours` column: **persona** resolves from the region slug
  (`PersonaDef`), **voice** derives from the persona, and the **notch** is a
  generation-time INPUT only (`GenerateOptions.jokeLevel` / `run.ts --joke-level`,
  default `dadpocalypse`) — it is NOT persisted, because M1 is dadpocalypse-only so a
  stored notch carries no information. When the 1-N notch ships (M3) the column lands on
  the NARRATION (`tour_stops`), never on `tours`: a notch describes a telling, not a
  route. The `jokeLevel` Zod enum in `@skipper/shared` stays as the narration vocabulary.
- **A tour may not be `ready` until every stop has non-null audio** (story, scenic,
  AND break — audio lives on the `tour_stop`). Generator enforces; player also defends.
- **Persona lives in DELIVERY, never in FACTS.** "Make it funny" never loosens
  accuracy. A POI with thin/no Wikipedia is downgraded to scenic/break — silence
  beats a hallucinated battle.
- **Break stops MAY name the place + category, but bake NO VOLATILE data**
  (hours, rating, "open till 9", popularity, features). The break's `name`/`kind`
  come from the curated Places anchor (a minimal non-volatile field mask) and are
  spoken in the clip like the region is; everything volatile is fetched fresh at
  tour-load (and "ask the skipper" later). Break audio is **mandatory** — every
  selected break gets narration + audio on its `tour_stop`; the tour can't be `ready`
  without it. (NOTE: baking the Places name into a frozen R2 clip extends its lifetime
  past the DB anchor — mind Places ToS; `patch-clip` re-synths one stop's clip if a
  place renames.)

## Stack notes

- **bun everywhere** (package manager + runtime). Internal packages export `.ts`
  source (no dist build); bun runs it, `tsc --noEmit` type-checks. No `tsx`, no
  `@hono/node-server`.
- Verified pins: TS 6.0.3, zod 4.4.3 (`z.enum`, top-level
  `z.uuid()`/`z.url()`), drizzle-orm 0.45.2 + drizzle-kit 0.31.10 (neon-http,
  stateless — no interactive transactions; use `db.batch`), hono 4.12.23,
  @anthropic-ai/sdk 0.102.0.
- **TTS = Google Cloud Text-to-Speech via REST** (no SDK — raw `fetch` to
  `texttospeech.googleapis.com/v1/text:synthesize`), model `gemini-3.1-flash-tts-preview`
  with Gemini-TTS voice "Charon" (`TTS_MODEL` / `SKIPPER_VOICE_ID` in `models.ts`);
  OAuth/ADC via `google-auth-library`, NO API key. Output is **MP3 32 kbps**
  (`TTS_AUDIO_ENCODING = 'MP3'`; exact duration via the frame-sum parser in
  `pipeline/mp3.ts`; `wav.ts` is the retained LINEAR16 fallback — see
  `docs/decisions/audio-compression-spike.md`). Switched off ElevenLabs (commit
  `6af019e`) to bill GCP credits and dodge its quota + 2026-12-31 voice sunset.
- **R2 = Bun's native `S3Client`** (no `@aws-sdk`; `region: "auto"`); the generator
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
  excludes them (mobile has no `@types/bun`).

## Milestones

0. **Content + phone-player spike.** Skipper prompt; ~6–8 Tahoe tours (each a
   self-contained drive — no separate `corridors` table); stand up the **phone**
   audio player — that is the MVP target, and its build (Expo SDK 56 / RN 0.85 /
   new arch) decides the SDK pin. **CarPlay is no longer a hard gate** — it's
   deferred past the MVP (see Deferred). The MVP plays through the phone (in a
   mount / over Bluetooth), not CarPlay. You may file the `carplay-audio` Apple
   entitlement in the background since Apple review is slow, but nothing waits on it.
1. **Walking skeleton.** ONE tour (one route), `dadpocalypse` only.
   Generator → narration → TTS → R2 → Neon (no cache/dedup/feedback). Build the
   **drive simulator**. Player: download offline → simulated drive → correct
   speed-adaptive triggering + debounce → audio + lock-screen **Now Playing on
   the phone** (CarPlay deferred). Then drive it once for real. _This is the
   whole bet._
2. **`apps/api`:** list tours, fetch tour, signed R2 URLs.
3. **Breadth:** more tours, joke notches as a per-tour setting (notch = 1-N off a tour),
   live break-stop Places data. (Duration = skip-stops, interests = a stop filter — both
   deferred, NOT variant tours.)
4. **Earn the machinery:** `route_sig` tour-dedup, human-review/feedback, then more
   regions (Yosemite → Moab; mind seasons). (The old `poi_content` *content* cache is
   cancelled under zero-reuse — narration is tour-owned; the only "cache" is the `pois`
   facts TTL + hash-staleness, see `docs/decisions/tour-data-model-zero-reuse.md`.)

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

Captured so they aren't lost; NONE are v1, all gated behind the phone-player bet being
proven first. Full write-ups live in `docs/ideas/` (pre-spec) and `docs/specs/`
(build-ready) — see the index in `docs/README.md`.

- **"Ask the Skipper"** — live, grounded, in-persona voice Q&A mid-drive (the north-star
  delighter). Build-ready spec: `docs/specs/ask-the-skipper-spec.md`.
- **The drive-complete payoff as a designed moment** — the climax beat done in motion +
  sound; the stage the tip jar + passport stamps plug into. `docs/ideas/drive-complete-moment.md`.
- **"Tip the skipper"** — end-of-tour tip jar (Apple IAP; delight, not extraction; never a
  toll). `docs/ideas/tip-the-skipper.md`.
- **Sponsor read in the intro bracket** — in-character host-read ad; the riskiest
  monetization idea vs the toy lens; only if it stays charming. `docs/ideas/sponsor-read.md`.
- **Region-specific skipper identities** — a named host per region on the `PersonaDef`
  registry (M4). `docs/ideas/region-skippers.md`.
- **Passport + logbook** — souvenir stamps + the skipper reading your cumulative stats
  back in character. `docs/ideas/passport-logbook.md`.
- Also specced-but-unbuilt in `docs/specs/`: downtime callouts, "tell me more" B-sides,
  replay-last-stop, skipper opinions, scenic stops.

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

- **Type-name collisions (enforced: `bun run lint:types`).** `@skipper/shared` (Zod
  boundary types) and `@skipper/db/schema` (Drizzle `$inferSelect` row types) both export
  `Poi`, `Tour`, `TourStop`, `TourBracket`, `Region` — DIFFERENT shapes (Zod = read DTOs:
  nullish, omit internal cols like `facts`/`meta`). Use Zod types from `@skipper/shared` at
  boundaries; import a DB ROW type only from the `@skipper/db/schema` subpath, ALIASED
  (`import type { Poi as PoiRow }`). NEVER `export * from` both in one barrel. (`Polyline`
  collides by name too but is the SAME shape, so the guard ignores it.) The guard derives the
  set from the schema each run; the `@skipper/db` client deliberately does NOT re-export the schema.
- **`@skipper/db` import is side-effect-free.** The client is lazy (`getDb()` /
  the `db` proxy build on first query) so importing it never forces
  `DATABASE_URL` to exist — env-free routes like `GET /health` keep booting.
- **`voice` is a fixed function of persona in v1** (each `PersonaDef.voice` in
  `packages/generator/src/persona/`, resolved per-tour by `personaForRegion(slug)`:
  skipper → the Google Cloud Gemini-TTS voice name "Charon"; `SKIPPER_VOICE_ID` in
  `models.ts` is the source constant the def references). Not a request knob until M3
  (no `tours.voice` / `tourRequest.voice` yet). (Gemini-TTS voice names are stable
  identifiers — no ElevenLabs-style sunset to mind.)
- **The generator MUST populate `tour_stops.attribution`** for every
  wikipedia-sourced clip (CC BY-SA is legal, not optional) — put it on the
  generation invariant checklist + the human-review gate.
- **scenic ≠ break.** A scenic stop is delivery-only ambient audio (no facts); a
  break stop names the curated Places anchor (name + kind only). Both — and story —
  carry non-null `audioUrl` on the `tour_stop`: **every** stop type carries audio and
  the ready-gate requires it on all of them (no stop type is silent). Only fact-grounded
  (story) stops carry a `facts_hash`; scenic/break carry none and are never fact-stale.
- **M1 ready-gate is atomic via `db.batch([...])`** — neon-http has no
  interactive transactions, but co-committing the `status='ready'` flip with the
  final stop writes in one batch suffices (no neon-serverless Pool needed).
- Three further scaffold guardrails about the old `poi_content` content cache
  (DB-enforced cache-key dimensions, M4 cache invalidation, the `stopType`-not-in-key
  precondition) were **SUPERSEDED by zero-reuse (2026-06-08)** — narration is tour-owned,
  so those hazards can't occur; the surviving concern is FACTS staleness via
  `pois.facts_hash` (principle #1). History: `docs/decisions/tour-data-model-zero-reuse.md`.
