# Skipper — working notes for agents

A toy/lifestyle project: an AI-narrated, GPS-triggered driving audio tour with a
Jungle-Cruise-skipper persona and CarPlay output. **Optimize for charm, not scale.
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

- **No auth, no users table, no `createdBy`.** Tours are anonymous/shareable.
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
- **Break stops bake NO volatile data** (hours, "open till 9"). Narrate
  generically; live name/rating/hours are fetched fresh at tour-load.

## Stack notes

- **bun everywhere** (package manager + runtime). Internal packages export `.ts`
  source (no dist build); bun runs it, `tsc --noEmit` type-checks. No `tsx`, no
  `@hono/node-server`.
- Verified pins: TS 6.0.3, turbo 2.9.16, zod 4.4.3 (`z.enum`, top-level
  `z.uuid()`/`z.url()`), drizzle-orm 0.45.2 + drizzle-kit 0.31.10 (neon-http,
  stateless — no interactive transactions; use `db.batch`), hono 4.12.23,
  @anthropic-ai/sdk 0.102.0, openai 6.42.0.
- The **highest-leverage file** in the repo (once written) is the skipper
  narration system prompt. Iterate on it more than anything.

## Milestones

0. **Content + entitlement + CarPlay spike.** Skipper prompt; ~6–8 Tahoe
   corridors; file the `carplay-audio` Apple entitlement (long pole); run the
   day-1 CarPlay gate (does the fork build a Now Playing template on SDK 56 / RN
   0.85 / new arch?) — it decides the SDK pin.
1. **Walking skeleton.** ONE corridor, ONE duration, `dadpocalypse` only.
   Generator → narration → TTS → R2 → Neon (no cache/dedup/feedback). Build the
   **drive simulator**. Player: download offline → simulated drive → correct
   speed-adaptive triggering + debounce → audio + CarPlay Now Playing. Then
   drive it once for real. _This is the whole bet._
2. **`apps/api`:** list corridors, fetch tour, signed R2 URLs.
3. **Breadth:** more corridors, fixed durations, interest filtering, joke notches,
   live break-stop Places data.
4. **Earn the machinery:** the cache + `route_sig` dedup, human-review/feedback,
   then more regions (Yosemite → Moab; mind seasons).

## Deferred — DO NOT build these in v1

Segment trimming / arbitrary start points; the cache-variant + dedup machinery
(until M4); any automated groundedness gate (human ear instead); the CarPlay
**map** template (needs `carplay-maps`); Android Auto; multilingual; the live
conversational agent + on-device fallback.

## In-car player landmines (when you get there)

- **Triggering:** do NOT rely on fixed-radius background polling — the OS
  throttles background GPS and a car sails through a 350 m geofence at 60 mph.
  Use a continuous high-rate foreground service + speed-adaptive lead time;
  `trigger_radius_m` is a floor, not the rule. Heading gate only above ~5 mph.
- **Audio:** `expo-audio` (NOT `expo-av`, removed in SDK 55); background playback
  via config plugin. Duck (don't stop) the user's music at a trigger.
- **Offline-first:** download a complete tour before driving (Tahoe dead zones).
