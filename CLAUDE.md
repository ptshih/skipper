# Skipper — working notes for agents

A toy/lifestyle project: an AI-narrated, GPS-triggered driving audio tour with a
Jungle-Cruise-skipper persona, played as phone audio (CarPlay later). **Optimize for charm, not scale.
The persona is the product.** When a choice trades polish-for-the-builder against
scale-for-a-market, pick polish.

**No users yet — break things freely.** The app has ZERO real users, so schema / API /
storage changes need NO backward-compatibility and NO careful data migration: prefer
CLEAN, DESTRUCTIVE migrations (drop + recreate) over preserving legacy rows or
nullable-for-back-compat columns. The only things still worth a founder OK are COST and
the demo — a live regen burns GCP credits, and the canonical preview IS the demo (don't
silently break it). (Added 2026-06-08.)

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

## Git workflow

- **Never create or switch to a new branch without confirming with the human first.**
  Don't `git switch -c` / `git checkout -b` (or move onto a different branch) on your
  own — even when committing, and even though the generic "branch before committing on
  the default branch" habit says otherwise. This repo's default is to **commit directly
  to `main`**; if you think a branch is warranted, propose it and wait for an explicit
  yes. (Multiple agents share this one working tree, so unannounced branch switches are
  especially disruptive.)

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
   superseding the old `poi_content` cache — see `docs/tour-data-model-zero-reuse.md`.)
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
  attribution — Wikipedia is **CC BY-SA**, keep credit (the attribution snapshot is
  frozen on the `tour_stop` at narration time).
- **The Dad-Joke-O-Meter notch (`off`/`mild`/`dad`/`dadpocalypse`), persona, and
  voice are per-TOUR generation parameters** (`tours.joke_level`, `tours.persona`;
  voice derived from persona) — baked into the narration when the tour is generated,
  NOT live playback toggles and NOT a content cache key (there is no content cache;
  narration is tour-owned — see principle #1). Changing any of them = a different tour.
- **A tour may not be `ready` until every stop has non-null audio** (story, scenic,
  AND break — audio lives on the `tour_stop` now). Generator enforces; player also defends.
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
  excludes them (mobile has no `@types/bun`).

## Milestones

0. **Content + phone-player spike.** Skipper prompt; ~6–8 Tahoe tours (each a self-contained drive — no separate `corridors` table); stand
   up the **phone** audio player — that is the MVP target, and its build (Expo
   SDK 56 / RN 0.85 / new arch) decides the SDK pin. **CarPlay is no longer a
   hard gate** — it's deferred past the MVP (see Deferred). The MVP plays through
   the phone (in a mount / over Bluetooth), not CarPlay. You may file the
   `carplay-audio` Apple entitlement in the background since Apple review is slow,
   but nothing waits on it.
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
   facts TTL + hash-staleness, see `docs/tour-data-model-zero-reuse.md`.)

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

- **The drive-complete payoff as a designed _moment_, not a screen.** Today
  `voice.driveComplete` is one string on a plain screen; this beat is the emotional
  climax of the whole drive (the road's-end exhale), and the design language is
  mature on static visuals but bare on the two axes a _moment_ lives in — **motion
  and sound**. Design it as a beat: the trip total ticking up on the odometer (Space
  Mono is already the "stamped clock"), the stops you passed collected and **inked as
  passport stamps** (`StopRow` already models the `passed` state; the §9 stamp
  animation lands here first), an **engine-off sigh** + soft haptic to close the
  loop, optionally a shareable **postcard** of the route. What it stresses:
  - **It's the stage, not a feature.** It's the container several deferred ideas plug
    into — the **tip jar** rides on TOP of it (after the payoff, never before/blocking;
    see below), the region skipper's sign-off lands here, the §9 passport-stamp earns
    its first home. Build the moment; then hang the others on it.
  - **Earns the under-built axes.** This is the highest-value place to spend the first
    real **sound + haptic** design and a JS-driven `Animated` flourish — one signature
    move (the stamps inking, or the odometer rolling), per DESIGN §2, not six.
  - **Celebration, never a wall.** Fully skippable, glanceable, no gate — it's a
    thank-you, not a toll. Respect the half-second glance rule even at the climax.
  - **Voice stays DELIVERY, never FACTS.** A warm in-character send-off + the _actual_
    stops passed — never an invented "remember when we saw…" the drive didn't include.
  - **Sequencing:** post-MVP, gated behind the proven phone player; build BEFORE the
    tip jar and the §9 passport-stamp animation (both want this surface) — reuses
    `StopRow` `passed`, the Space Mono numerals, and the existing `voice.driveComplete`
    copy, so it's mostly motion + sound on pieces that already exist.

- **"Tip the skipper" — an end-of-tour tip jar.** At the drive-complete beat (the
  `voice.driveComplete` screen, AFTER the payoff — never before, never blocking), an
  optional, low-pressure "tip your skipper," in character, because a corny tour guide
  works for tips. Charm-forward monetization (delight, not extraction) — the toy-lens +
  competitive read both point to voluntary/one-time over subscription. What it stresses:
  - **Payment rails we don't have yet.** `user.tier` is a manual flag (no Stripe/IAP). On
    iOS a tip for digital content MUST go through Apple IAP (≈30% cut) — it can't route to
    Stripe; model it as a consumable IAP "tip" product. Lands WITH the same billing
    integration the paid tier needs, not before.
  - **A tip is not a toll.** Never gate content behind it — the freemium wall is the
    playback `AccountGate`; tipping rides on TOP of a tour already enjoyed, fully skippable.
    Ask warm, ask once.
  - **Charm hook (optional).** A tip can ink a passport-stamp / postcard, or unlock one
    bonus aside ("since you're feeling generous, one more for the road…") — reward the
    gesture; don't make it the point.
  - **Sequencing:** post-MVP, gated behind the proven phone player; pairs with the
    Stripe/IAP work.

- **"This tour is sponsored by…" — an AI-voiced sponsor read in the intro.** The
  podcast/YouTube host-read ad, in the skipper's voice: a short, in-character sponsor
  spot baked into the **intro bracket** (the `tour_brackets` drive-frame, where the
  skipper introduces the drive — see [[bracket-architecture-decision]]), never mid-stop.
  The charm bet is that a corny tour guide doing a corny sponsor read is *part of the
  bit*, not an interruption — same instinct as the tip jar (a corny guide works for
  tips; a corny guide can also do a wink-wink ad read). What it stresses:
  - **Ads are EXTRACTION; the tip jar is DELIGHT — opposite ends of the toy-lens.** The
    whole project optimizes for charm over scale ("the persona is the product"), so this
    is the riskiest monetization idea here: an ad that reads as a toll poisons the charm.
    It only works if it stays warm, short, in-persona, skippable, and front-loaded into
    the intro (never gating or interrupting the drive). If it can't be charming, don't ship it.
  - **Sponsor copy is DELIVERY, never FACTS.** The skipper voices the read in-character,
    but the sponsor's claims are NOT grounded narration — they must never leak into or
    contaminate the fact-grounded story stops. Keep the ad isolated to the bracket; the
    "persona lives in DELIVERY, never in FACTS" wall applies (a sponsor read is pure delivery).
  - **A new generation input + a per-tour bracket variant.** Like persona/joke-level, a
    sponsor is a per-tour generation parameter (an intro-bracket overlay), not a cache key
    — narration is tour-owned, so a sponsored intro is just a different bracket generation.
    Needs sponsor name + a short brief the skipper riffs on (in the persona's idiom), then
    re-synth that one bracket clip (cf. `patch-clip`).
  - **Voice continuity + the same TTS path.** Reuses the existing Algenib voice and the
    batch LINEAR16→MP3 synthesis — the ad is one more bracket clip, so the skipper sounds
    continuous from sponsor read into the drive.
  - **Sequencing:** post-MVP, needs the intro-bracket infra built first
    ([[bracket-architecture-decision]]) AND a real sponsor; pairs with — but is distinct
    from — the tip-jar/billing work. Lowest-priority of the monetization ideas precisely
    because it's the one most in tension with the toy-lens; explore only if the charm read works.

- **Region-specific skipper identities — a different host per region.** The Tahoe skipper
  is not the Yosemite skipper: each region gets a named guide with its own persona,
  backstory, and (optionally) voice — variations on the deadpan pun-machine DNA, not a
  different species (keep the founder's road-trip-guide heart). The payoff to the new
  region browse axis: picking "Yosemite" in the "Where to?" picker introduces you to the
  Yosemite skipper. "The persona is the product," applied per region — a charm multiplier.
  What it stresses:
  - **Region is a per-tour generation parameter, not a cache key.** Since narration is
    tour-owned (no content cache), a per-region persona/voice/prompt-overlay is just a
    different generation input per tour — each region generates its own content, no schema fight.
  - **A region skipper can SOUND different.** `voice` is today a fixed function of persona
    (`PERSONA_VOICE` in `packages/generator/src/models.ts`: skipper → Algenib), but the key
    already carries `voice` — so the Yosemite skipper can wear its own Gemini-TTS voice.
    Tune + ear-judge per region (the voice gate becomes per-region).
  - **The system prompt becomes region-parameterized.** The highest-leverage file (the
    narration prompt) gets a base skipper layer + a per-region overlay (backstory, regional
    idioms, what they riff on). The persona KIT terms are load-bearing in
    `lint.ts`/`generate.ts` regexes — per-persona kits must sync with those guards.
  - **Backstory is DELIVERY, never FACTS.** An ex-ski-bum-mechanic Tahoe skipper vs. a
    grizzled-climber Yosemite skipper colors the jokes and asides — it must NEVER invent
    regional history. Same rule as "Ask the Skipper": don't let "backstory" become an
    ungrounded-fact backdoor.
  - **A "meet your skipper" surface.** Name, rig, one-line backstory — pairs with the
    deferred enamel-badge / passport ornament and the region picker (the location filter).
  - **Sequencing:** needs breadth to matter (M4, multiple regions) — pairs with the region
    expansion; each new region = persona tuning + a voice judged by ear (that per-region
    content cost IS the charm-per-region multiplier).

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
  `Tour`, `TourStop`, `TourBracket`, `Region`, `Polyline` — DIFFERENT shapes
  (Zod = read DTOs: nullish, omit internal cols like `facts`/`meta`). Use Zod
  types from `@skipper/shared` at boundaries; import DB row types only from the
  `@skipper/db/schema` subpath, aliased (`import type { Poi as PoiRow }`). NEVER
  `export * from` both in one barrel. The `@skipper/db` client deliberately does
  NOT re-export the schema.
- **`@skipper/db` import is side-effect-free.** The client is lazy (`getDb()` /
  the `db` proxy build on first query) so importing it never forces
  `DATABASE_URL` to exist — env-free routes like `GET /health` keep booting.
- **~~Cache-key dimensions are DB-enforced.~~ SUPERSEDED (zero-reuse + simplified model, 2026-06-08):**
  the `poi_content` content cache is dropped; narration is tour-owned. `joke_level` remains a pgEnum
  (typo-safe) as a per-tour generation param on `tours`; `persona` → a `regions` TABLE, `duration_bucket`
  dropped (no variant matrix). See `docs/tour-data-model-zero-reuse.md`.
- **`voice` is a fixed function of persona in v1** (`PERSONA_VOICE` in
  `packages/generator/src/models.ts`: skipper → the Google Cloud Gemini-TTS voice
  name "Algenib", recorded as a per-tour generation param — there is no content cache
  key). Not a request knob until M3 (no `tours.voice` / `tourRequest.voice` yet).
  (Gemini-TTS voice names are stable identifiers — no ElevenLabs-style sunset to mind.)
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
- **~~M4 cache invalidation.~~ SUPERSEDED (zero-reuse, 2026-06-08):** no shared
  `poi_content` rows to invalidate — narration lives on the `tour_stop` (cascade-deleted
  with its tour). The surviving invalidation concern is FACTS staleness: a poi re-fetch
  that changes `pois.facts_hash` makes dependent story stops stale (regenerate them);
  see `docs/tour-data-model-zero-reuse.md`.
- **~~M4 cache precondition — `stopType` is NOT in the `poi_content` key.~~
  SUPERSEDED (zero-reuse, 2026-06-08):** the cross-tour content-reuse hazard this
  guarded against can't occur — narration is tour-owned, so a `story`-vs-`scenic`
  classification flip on one tour never overwrites another tour's stop. (The
  classification is still decided by extract length at generation time; it just stays
  local to its tour.) See `docs/tour-data-model-zero-reuse.md`.
