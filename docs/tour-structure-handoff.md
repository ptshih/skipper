# Build handoff — directional tours, intro/outro, region-keyed host

**For:** a fresh agent executing the build designed in `docs/tour-structure-spec.md`.
**From:** a long design session (2026-06-08). The spec is the **design** source of truth; this is
the **execution** guide + the prompt assets that live only in that session's chat.

> ⚠ **RE-GROUND BEFORE TOUCHING CODE.** Main moves constantly (multiple parallel streams). Read the
> current files; any line numbers/snippets here are 2026-06-08 and will have shifted. Verify with
> `git log --oneline -15` and re-read each file before editing.

> ⚠ **Two destructive checkpoints need explicit founder OK** (the permission classifier will also
> block them): the **DB schema migration** against the live Neon DB, and the **live regen** of the
> canonical preview. Do everything else first; pause at those.

---

## 0. Read these first
- `docs/tour-structure-spec.md` — the full design (directionality, intro/outro, naming, catalog,
  discovery, region-keyed host, AI-gen fit). **All decisions are LOCKED there.**
- `docs/scenic-stops-spec.md` — a **concurrent** design that is **BLOCKED on this build landing**,
  on the *same* `select.ts`/`generate.ts` seams. Coordinate: land this, then scenic stops. Note the
  shared pattern — scenic stops and our intro/outro are both "curated WHERE + generated WHAT,
  delivery-only + region/corridor framing, no named place-facts."
- `CLAUDE.md` invariants (grounding, cache key, ready-gate, break-stop framing).

## 1. Current state (regrounded 2026-06-08) — what's built vs. yours

**Already built (do NOT redo):**
- **Voice/codec:** `gemini-3.1-flash-tts-preview` + 32k MP3 + Algenib, in `models.ts`. Duration via
  `pipeline/mp3.ts`. The `resynth-tour.ts` tool re-synths a tour's clips from stored scripts.
- **Host-agnostic PRESENTATION layer:** `apps/api/src/host.ts` = `Record<Persona, HostIdentity>`
  (name/tagline/backstory/portrait/voice-sample), served by the API; `HostIdentity` DTO in
  `@skipper/shared`. The "meet your skipper" data already exists. **This is the pattern your region
  registry mirrors.**
- **Multi-source facts:** Wikidata (CC0) + Macrostrat geology (CC BY) enrichment; `attribution` is
  now an **array** (`AttributionSnapshot[]`); `/sources` catalog; `/sign` returns `contentType`.
- **GPS Phase 2 player** (simulated fix source).

**Yours to build (none of this exists yet):**
- Quality-gated narration prompt + intro/outro narration modes.
- Region-keyed host **registry** (generation side) — replaces the `persona` enum + `PERSONA_VOICE`
  + hardcoded kit regexes; mirrors `host.ts`'s `Record<>` pattern.
- Schema: `region` pgEnum (was free text, replacing `persona` as the cache-key dim), `headline` +
  end-anchors on the drive/family, `start`/`finish` stop-types.
- Per-direction **independent** drive generation + the regenerate tool.
- API/DTO + mobile catalog (one card per direction, related-drives) + the bracket segments.

## 2. Validated decisions — carry these, do NOT re-derive

These were settled by ear / research this session:
- **Delivery = the "warmer" prompt** (Appendix A) — replaces the current `SKIPPER_TTS_STYLE_PROMPT`
  in `models.ts`. Founder picked it over "tightened"/"drier"/"bigger-beat".
- **Narration = quality-gated** (Appendix B): 1–2 best groaners scaled to material, dumb-over-clever,
  story-first, NO pun-chains, **kit banned from stops** (the kit's only home is the intro), no-bow,
  no-mini-recap, grounding ironclad. Two leak-fixes: oblique kit ("before my first cup") + mini-recap.
- **Intro/outro** (Appendix C): the kit lives in the intro; the sentimental bow lives in the outro.
- **Model:** discrete per-direction drives (not mechanical reverse); corridor → "drive family";
  one card per direction + related-drives; region-keyed host (1:1); "Skipper" name kept *for now*
  (display name decoupled from the `lake-tahoe` region key — renaming later is migration-free).
- Everything else: see the spec.

## 3. Build phases (file-level)

**Phase 1 — Narration prompt + intro/outro modes (generator-only, safest, fully validated).**
- `packages/generator/src/persona/skipper.ts`: fold Appendix B in — recalibrate the DADPOCALYPSE
  rung to quality-gated (1–2 best, NOT "3–4 groaners"); ban the kit from stops (move it to the intro);
  strengthen no-bow to also forbid mini-recaps; reconcile the *other* density-endorsing spots that
  will now contradict the cap (the "rattle off a CHAIN" line, the Sand Harbor pun-chain calibration
  example, the "drop a quick dad joke between facts" line) — make them coherent with the cap.
- `packages/generator/src/pipeline/narrate.ts`: add `narrateIntro` + `narrateOutro` (Appendix C),
  persona-only, no fact sheet; notch-parameterized.
- `packages/generator/src/models.ts`: replace `SKIPPER_TTS_STYLE_PROMPT` with Appendix A (warmer).
- Verify: `cd packages/generator && bunx tsc --noEmit && bun test`. Commit.

**Phase 2 — Schema + migration** (CHECKPOINT — live DB).
- `packages/db/src/schema.ts` + `@skipper/shared/enums.ts`:
  - `region` → a `pgEnum` (e.g. `lake-tahoe`), becomes the `poi_content` cache-key dim **replacing**
    `persona`. (`persona` axis dropped — see §4a of the spec.)
  - `stopType` += `start`, `finish` (the intro/outro brackets).
  - Drive/family: `headline` + two end-anchors `{name, lat, lng}` (start/end). Decide drive-as-
    primary vs corridor-as-family per spec §1 — corridor reframes to the family grouping.
- `bunx @better-auth/cli`? No — use the project's `db:generate` + `db:migrate` (dotenvx). The
  `region`/`persona` rekey + `start`/`finish` enum values are the migration.

**Phase 3 — Generator: registry + per-direction generation + regen tool.**
- New **region/host registry** (generation side): `Record<Region, { host, voice, promptOverlay, kit,
  opener }>`; `Region` type = registry keys; make the kit-overuse lint/`generate.ts` guards read kit
  terms FROM it (not hardcoded). Mirror `host.ts`. Co-locate with or alongside `persona/`.
- Per-direction **independent** generation: generate each direction as its own discrete drive (run
  the generator twice over the frozen route); assign both to the same family. drive-core needs NO
  traversal change (each drive is self-contained + forward).
- `narrateIntro`/`narrateOutro` wired into `generate.ts`; the intro/outro become `start`/`finish`
  stops with audio (ready-gate requires it). Attribution = array shape.
- Extend `resynth-tour.ts` (or a new tool) to regenerate the canonical preview's *scripts* (not just
  re-synth audio) at the new prompt + add the brackets.

**Phase 4 — Shared DTO + API.**
- `@skipper/shared/schemas.ts`: tour detail carries the directional name, the family/related set,
  the bracket stops; `region` replaces `persona` where surfaced.
- `apps/api`: `host.ts` `Record<Persona>` → `Record<Region>`; serve the brackets via `/sign`
  (they're stops now); the related-drives (same-family siblings) on the tour/corridor endpoints.

**Phase 5 — Mobile.**
- `apps/mobile/app/preview/[id].tsx` + `@skipper/drive-core`: prepend `start`, append `finish`
  segments (intro plays first regardless of position; outro at end). drive-core: **no traversal
  param** (discrete drives are forward).
- Catalog: one card per direction; "related drives" (variations) link on the detail; the family
  "X — 2 ways" cluster. (Nearby/proximity recommender = deferred to the location-filter near-me v2.)
- Pre-drive UI: where-to-start guidance + onboarding (NOT in the skipper's voice).

**Phase 6 — Live regen** (CHECKPOINT — needs explicit founder OK; costs GCP + mutates live R2/DB).
- Regenerate the canonical preview end-to-end: new scripts (quality-gated) + intro/outro + warmer
  delivery + the `persona skipper → region lake-tahoe` rekey (cache-key value + R2 path
  `clips/skipper/…`→`clips/lake-tahoe/…`) — **all in one regen pass** (a standalone rekey orphans
  the live clips). Verify end-to-end through the presign path (as `resynth-tour` did: ffprobe a
  clip, durations match, plays). Founder re-validates warmer+quality-gated by ear on the full tour.

## 4. Gotchas
- **dotenvx + relative SA key:** run generator scripts from the **repo root** (`GOOGLE_APPLICATION_
  CREDENTIALS` is a relative path). `dotenvx run -f .env.development -- bun packages/generator/...`.
- **Module resolution:** generator scripts that import the package must live **inside**
  `packages/generator/` (transitive deps like `google-logging-utils` fail from outside the workspace).
- **Persona/kit terms are load-bearing in `lint.ts`/`generate.ts` regexes** — the registry move must
  keep those guards working (read terms from the registry).
- **Cache key is forward-only at M1** (generate-and-use, no reuse), so the `persona→region` content-
  key change is safe now; the `direction`-in-key question is deferred to M4 (spec §8 #7).

---

## Appendix A — Warmer delivery prompt (→ `SKIPPER_TTS_STYLE_PROMPT`)

> Read this as a warm road-trip tour guide letting friends in on jokes you all secretly enjoy —
> genuinely glad they came, a man who has told these corny jokes a thousand times and quietly loves
> every one. Keep the narration moving at a natural, easy talking pace, like a man telling you about
> the view out the window — relaxed but never sleepy, never dragging. Save the slow-down for the
> jokes: deliver them deadpan and fully committed, but with a confiding warmth, as if you and the
> riders both know it is corny and that is exactly why it is good. Never laugh at your own setup,
> never sing-song the punchline; land each one flat and matter-of-fact. Put a small pause right
> before the pun and a beat right after for the groan, then roll on. Let the sincere lines breathe,
> but keep everything else moving. Talking WITH friends, not at a crowd.

## Appendix B — Quality-gated narration (fold into the DADPOCALYPSE rung in `skipper.ts`)

QUALITY OVER QUANTITY: land your ONE best groaner per stop — funniest/dumbest/most eye-rolling pun
off the real material — and a SECOND only when the facts genuinely hand you another that lands as
hard. Never a third, never a stacked pun-chain on one word ("pure bliss, marital bliss, bliss
point"), never a forced joke. Dumb over clever (if a line is witty, make it dumber until it groans).
STORY-FIRST: a warm telling with the groaner(s) woven through, flowing spoken sentences (no choppy
"A rock. Balancing." fragments), real sincere beats carrying the rest. Thin stop → 0–1; rich stop →
2. **Kit banned from stops** (Ray/mechanic/truck/coffee live in the intro now — including oblique
refs like "before my first cup", "balance a checkbook"). **No bow / no mini-recap** close (end on a
concrete thing mid-stride; don't re-list what you just covered). Grounding ironclad: every joke
rides a real fact or is a fact-free groaner off road/water/weather; the fact survives the joke being
deleted; ZERO invented specifics. (Validated on the Olympics + D.L. Bliss stops by ear.)

## Appendix C — Intro / outro

**Intro** (persona-only, no fact sheet; fires on tour-START, not geofenced; position-agnostic):
welcome aboard + the trip's shape in REGION + drive framing by **destination + direction** (name the
endpoints descriptively, NEVER "you are now at Tahoe City") + **ONE big standalone personal KIT
joke** (the one joke freed from grounding — cousin Ray, the "Tuesday" mechanic, the cranky truck,
coffee). Doubles as "meet your host". Notch-scaled (off = sincere, no big joke). End pointing down
the road; no bow. *(Validated: the Ray "just keep the wet part on your left" opener.)*

**Outro** (fires on end-anchor OR tour-end): arrive + name the end-anchor + the **warm sign-off**
(the bow we ban everywhere else lives here) + a **notch-scaled closing groaner** + an optional
**intro callback** (bookend) + a **reserved tip-jar slot** (deferred). Notch-scaled.
