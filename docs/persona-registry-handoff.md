# Persona registry handoff — the generation-side per-region host

**For:** an agent building the GENERATION-side persona/host registry (the one piece of the
directional-tours/intro-outro arc left after Phase 2). **From:** the session that landed the zero-reuse
migration (2026-06-08).

> ✅ **BUILT 2026-06-08 (commit `687c885`).** The mechanical decoupling (§1–§6) is done: `persona/types.ts`
> (`PersonaDef`/`KitBeat`), `persona/skipper.ts` (`SKIPPER` def), `persona/index.ts` (`personaForRegion`),
> the kit pulled out of `generate.ts`/`lint.ts` into `PersonaDef.kit`, prompts/voice/style/kit threaded
> through generate/narrate/tts/lint, the tools (resynth/patch-clip) resolving voice by region, and a
> `persona.test.ts` (resolution + fallback + the prose↔regex sync guard). Behavior-preserving at one region;
> generator 102 tests + all 7 packages typecheck green. **Still DEFERRED (intentionally — §4/§7):** the
> prompt **base/overlay split** (do it when a 2nd region's prompt exists to diff against) and the `GET /regions`
> "meet your skipper" feed. So this doc now reads as the record of the refactor + the region-#2 checklist.

> ⚠ **RE-GROUND BEFORE TOUCHING CODE** if extending — line numbers/snippets below are 2026-06-08 and will
> shift. Verify with `git log --oneline -15` and re-read each file.

## 0. Read first
- This doc. Then `docs/tour-structure-handoff.md` §3 Phase 3 (the one-paragraph outline this expands) and the
  decided-architecture memory `region-skipper-data-architecture` (the *why*; note it predates the migration —
  the `regions` table and region-keyed `host.ts` it lists as "not built" ARE now built).
- CLAUDE.md invariants: **"Persona lives in DELIVERY, never in FACTS"**, and the kit/host notes.

## 1. What this is (and is NOT)
A **pure, behavior-preserving refactor** that collapses the scattered generation-side persona data into one
per-region `PersonaDef`, threads it by the tour's region, and **pulls the personal-kit regexes out of
`generate.ts`/`lint.ts` into the def** so they stop being hardcoded to one host. At ONE region (Tahoe/Skipper)
it changes NO output — the Skipper def is today's prompts + voice + kit verbatim. Its whole value is making a
**2nd region** a backend-deploy + a content batch, never an app update and never a six-site regex edit.

It is NOT: new regions today (there's one), a prompt rewrite, or any schema/API/mobile change (the
PRESENTATION half — `regions` table, `host.ts` keyed by region slug, host-over-the-wire — already shipped).

## 2. Invariants (do not regress)
- **Every region's host is named "Skipper."** Founder rule: per-region differentiation is voice + backstory +
  regional flavor, NEVER name. `PersonaDef.hostName` is the constant `'Skipper'` everywhere; the API's
  presentation `host.name` is already this. Do not template region names into host microcopy.
- **The kit lives in the INTRO bracket, BANNED from stops.** `SKIPPER_SYSTEM_PROMPT` bans it; the lint
  enforces zero-in-stops; `SKIPPER_BRACKET_PROMPT` houses it. The registry must keep this — the kit is
  per-persona DATA, the *rule* (intro-only) is house-style.
- **Backstory/overlay is DELIVERY, never FACTS.** A per-region overlay colors voice/jokes/idiom; it must
  NEVER assert regional history the fact sheet didn't supply (no ungrounded-fact backdoor past the sheet).
- **Voice is ear-judged per region** (a Gemini-TTS voice name); not a request knob.
- **Behavior-unchanged at one region** is the acceptance bar: the Skipper def must be byte-identical prompts +
  the same kit regexes + the same voice, so a regen produces the same character (modulo model nondeterminism).

## 3. The coupling to fix (scattered today — exact sites)
Persona data is spread across four files and the kit is **duplicated as regexes** in two of them:
- `packages/generator/src/persona/skipper.ts` — `SKIPPER_SYSTEM_PROMPT`, `SKIPPER_BRACKET_PROMPT` (kit prose
  lives in these), `SKIPPER_DEFAULTS` (`{ voice, jokeLevel }`).
- `packages/generator/src/models.ts` — `PERSONA_VOICE = { skipper: SKIPPER_VOICE_ID }`, `SKIPPER_TTS_STYLE_PROMPT`.
- `packages/generator/src/pipeline/generate.ts` — **`KIT_BEATS: [RegExp, string][]`** (`/mechanic/`, `/\bRay\b/`,
  `/\btruck\b/`, `/\bcoffee\b/` → labels) + `kitBeatsOf()`; resolves nothing by region (uses `SKIPPER_DEFAULTS`).
- `packages/generator/src/pipeline/lint.ts` — **`const KIT = [/mechanic/i, /\bRay\b/, /\btruck\b/i, /\bcoffee\b/i]`**
  (`:54`) + `DROP_KIT` (names "cousin Ray, the mechanic, the truck, or coffee"). A comment even says "mirror
  generate.ts KIT_BEATS" — that mirror is the desync hazard a 2nd kit would trip.
- `packages/generator/src/pipeline/narrate.ts` — imports `SKIPPER_SYSTEM_PROMPT`/`SKIPPER_BRACKET_PROMPT`
  directly; threads `recentKitBeats` (the beats come from `generate.ts` today).

**Stays HOUSE-STYLE (persona-agnostic — do NOT move into the persona def):** `lint.ts`'s `BANNED` reveal-wind-up/
AI-tic guards, `STOCK_PHRASES`, `TIDY_BOW`, `LIST_MARKER`, and `generate.ts`'s `MOTIF_BEATS` (the post-office/
name-change/"was nothing" frames) — these are anti-AI-slop guards every skipper shares. Also `config.ts`
`GEOLOGY_ICONIC_STOPS` (keyed by tour slug, per-route not per-persona). Only the **personal KIT** is per-persona.

## 4. Target design
A `PersonaDef` owns everything generation-side; a registry resolves one by **region slug** (mirrors `host.ts`),
with the Skipper as the default so a freshly-seeded region is never persona-less.

```ts
// packages/generator/src/persona/types.ts
export interface KitBeat { match: RegExp; label: string } // detector + the spent-beat label fed to narration
export interface PersonaDef {
  hostName: string          // ALWAYS 'Skipper' (founder rule) — what narrateIntro says ("YOUR NAME")
  voice: GeminiVoice        // ear-judged Gemini-TTS voice (subsumes PERSONA_VOICE)
  ttsStyle: string          // the input.prompt delivery directive (was SKIPPER_TTS_STYLE_PROMPT)
  systemPrompt: string      // stop narration system prompt (was SKIPPER_SYSTEM_PROMPT)
  bracketPrompt: string     // intro/outro system prompt (was SKIPPER_BRACKET_PROMPT)
  kit: {
    beats: KitBeat[]        // the kit detector — single source for generate.ts kitBeatsOf AND lint.ts KIT
    dropNote: string        // the lint regen instruction naming THIS kit's terms (was DROP_KIT)
  }
}
```

```ts
// packages/generator/src/persona/skipper.ts — the Tahoe skipper, today's content verbatim
export const SKIPPER: PersonaDef = { hostName: 'Skipper', voice: SKIPPER_VOICE_ID, ttsStyle: …, systemPrompt: …, bracketPrompt: …, kit: { beats: [ {match:/mechanic/i,label:'the mechanic ("getting to it Tuesday")'}, {match:/\bRay\b/,label:'cousin Ray'}, {match:/\btruck\b/i,label:'the truck'}, {match:/\bcoffee\b/i,label:'his coffee opinions'} ], dropNote: 'Do NOT mention the personal kit (cousin Ray, the mechanic, the truck, or coffee) anywhere in this stop — the kit lives in the intro now; close on the place itself.' } }

// packages/generator/src/persona/index.ts (the registry — mirrors apps/api/src/host.ts)
const PERSONAS: Record<string, PersonaDef> = { 'lake-tahoe': SKIPPER }
export const personaForRegion = (regionSlug: string): PersonaDef => PERSONAS[regionSlug] ?? SKIPPER
```

**Prompt base/overlay split is DEFERRED to region #2 (§7).** For cut 1 keep each persona's full prompts in its
def as-is — the refactor stays provably behavior-preserving. When you write the 2nd region's prompt you'll
*see* what's shared (house style + grounding rules — keep single-sourced) vs per-region (kit prose, regional
idiom, backstory), and factor a base + overlay then, so grounding rules can't diverge per region.

## 5. Build steps (file-by-file)
1. **`persona/types.ts`** — `PersonaDef` + `KitBeat` (above).
2. **`persona/skipper.ts`** — wrap the existing prompts/voice/style + the kit beats + dropNote into the
   exported `SKIPPER: PersonaDef`. Keep `SKIPPER_SYSTEM_PROMPT`/`SKIPPER_BRACKET_PROMPT` as the prompt strings
   the def points at. Drop `SKIPPER_DEFAULTS` (jokeLevel is a tour param, voice moves to the def).
3. **`persona/index.ts`** — `personaForRegion(regionSlug)` registry, default SKIPPER.
4. **`generate.ts`** — resolve `const persona = personaForRegion(shell.regionSlug)` once (loadTour already
   returns `regionSlug`). Replace inline `KIT_BEATS` with `persona.kit.beats` (rewrite `kitBeatsOf` to map over
   them); pass `persona.systemPrompt`/`persona.bracketPrompt` into the narrate calls; use `persona.voice` for
   synthesis; pass `persona.hostName` to `narrateIntro`. Keep `MOTIF_BEATS` where it is (house-style).
5. **`lint.ts`** — `lintScripts(stops, kit: PersonaDef['kit'])` (or pass the whole persona): use `kit.beats`
   for the kit-in-stops check and `kit.dropNote` for the regen note; delete the module-level `KIT`/`DROP_KIT`.
   Leave `BANNED`/`STOCK_PHRASES`/`TIDY_BOW`/`LIST_MARKER` untouched. Update `generate.ts`'s `lintScripts(...)`
   call sites (incl. the closer-judge path) to pass the kit.
6. **`narrate.ts`** — `narrateStop`/`narrateIntro`/`narrateOutro` take the system/bracket prompt as an argument
   (resolved by `generate.ts` from the persona) instead of importing `SKIPPER_*` directly. `recentKitBeats`
   threading is unchanged (the beats now originate from `persona.kit`).
7. **`models.ts`** — keep `GEMINI_VOICES`/`SKIPPER_VOICE_ID`/`SKIPPER_TTS_STYLE_PROMPT` as the source constants
   the SKIPPER def references; remove the `PERSONA_VOICE` map (subsumed by the registry).
8. **Tools — `resynth-tour.ts` + `patch-clip.ts`** — they hardcode `SKIPPER_VOICE_ID`. Resolve the voice from
   the tour's region: join the tour → `regions.slug` → `personaForRegion(slug).voice`. Same value at one
   region, but correct per-region (a re-synth must use that region's voice).

## 6. Validation
- `cd packages/generator && bunx tsc --noEmit && bun test`; `@skipper/shared`/`apps/api` unaffected (no DTO
  change); mobile unaffected.
- **Behavior-preserving check:** a `--dry-run` generate of `emerald-bay-run` must produce the same persona/kit
  prompts it does today (diff the prompts the registry yields against the old `SKIPPER_*` constants — they must
  be identical strings). No live regen needed (no output contract changed).
- Add a unit test: `personaForRegion('lake-tahoe') === SKIPPER` and an unknown slug falls back to SKIPPER; the
  Skipper kit beats match the prose in its `systemPrompt`/`bracketPrompt` (a guard against prose↔regex desync).

## 7. The payoff — adding region #2 (the checklist this unblocks)
1. Seed the `regions` row + author the route specs (`tour-specs.ts`) — already cheap post-migration.
2. Write the 2nd `PersonaDef` (prompt overlay/idiom + its own kit beats + an **ear-judged** voice) and add it to
   the registry under the new slug. THIS is where you factor base + overlay (§4) so the shared grounding/house
   rules stay single-sourced.
3. Add the region's presentation row to `apps/api/src/host.ts` (tagline/backstory/portrait-URL/voice-sample-URL;
   `name` stays "Skipper"). Portrait/sample are R2 URLs, never bundled.
4. Generate its tours; verify by ear. **Zero app-store release** (the bundle is host-agnostic).

## 8. Gotchas
- **Kit prose ↔ regex desync is the whole reason this exists** — keep both in the one `PersonaDef` and review
  them together; the §6 prose↔regex test guards it.
- **Backstory-never-facts:** the overlay must not leak regional facts past the sheet (same rule as "Ask the
  Skipper"). The grounding rules belong in the shared base, not a per-region overlay that could weaken them.
- **Don't move house-style into the persona** (§3 list) — only the personal kit is per-persona. Over-moving
  makes every region re-tune the anti-slop guards.
- **One persona today ⇒ this is invisible to users.** Don't gold-plate; ship the mechanical decoupling, defer
  the base/overlay split to when a real 2nd prompt exists to diff against.
- **`jokeLevel` is a TOUR param, not persona** — it stays on the tour/request; the def owns voice/style/prompts/
  kit only.
