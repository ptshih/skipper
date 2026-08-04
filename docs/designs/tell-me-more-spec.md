# "Tell me more" — the deeper-cut / B-side spec

> **Status: GENERATION BUILT (script-only, preview-by-default, NOTHING PERSISTED) 2026-08-03; the rest
> is SPEC ONLY.** A studio pipeline + player feature, fully offline. Decided 2026-06-09. Builds on
> [replay-last-stop-spec](replay-last-stop-spec.md) (the soft-clip player concept it shares) and
> [downtime-callouts-spec](downtime-callouts-spec.md); it's the pre-canned rung of the pull ladder
> formalized in [ask-the-skipper-spec](ask-the-skipper-spec.md) §4.6.
>
> **✅ The §8.5 ear check RAN and PASSED (founder go, 2026-08-03) — see §8.0.1.** A median stop and a
> rich stop both produced genuine b-sides; two thin stops correctly DECLINED rather than padding. The
> content risk is retired; storage is now DECIDED (§3 — a b-side gets its own table, NOT a relaxed
> `narrations_poi_uq`: [bside-gets-its-own-table](../decisions/bside-gets-its-own-table.md)). What
> remains is the half-the-corpus button
> question (§8.0), and one prompt tweak (§8.0.1).
>
> **⚠ MEASURED 2026-08-03 — a b-side is NOT a gap-filler, and nobody should promote it to one.** A
> separate pass asked whether b-sides could fill a drive's dead air (79% of a real drive). They
> cannot: on `Tahoe City → South Lake Tahoe` only **1 of 8** stops carries usable leftover material
> (Vikingsholm 861c; the rest 0–314c), so b-sides would add ~90 s to a 39-minute drive — coverage
> 23% → 26%. **This does not weaken the feature**, it confirms its own framing: corpus-wide the
> median live story leaves **446 chars** unspoken and **54% clear 400c**, which is §8.0's "half the
> corpus" estimate landing almost exactly. It is a PULL rung you tap, as specced — not a push.
> ⚠ Also tested and FALSE: the theory that selection starves it because `buildDrive`'s `better()`
> prefers the longest clip. Longer clips carry MORE leftover, not less (313c → 516c → 1133c by length
> band) — clip length tracks how much material a place HAS, not how much got spent. Numbers:
> [scenic-filler-and-the-empty-stretch §5c](../decisions/scenic-filler-and-the-empty-stretch.md).

> **⚠ §8's build order was deliberately INVERTED (founder, 2026-08-03) — read §8.0 before following it.**
> `narrateDeeperCut` (`pipeline/narrate.ts`) + `generate-bside-narrations.ts` exist and can print a
> b-side script for any live story stop. No schema change, no TTS, no DTO, no player, and **no
> persistence** — deliberately, since a second telling of one poi has nowhere to land until
> `narrations_poi_uq` is reconciled (§3), and writing first would decide that by accident.

> **Schema-names note (updated 2026-06-19 for the V2 roam-first model):** the V1 authored-tour
> storage this spec assumed is GONE (migration 0009 — `tour_stops`, `segments`, `tracks`). In V2 the
> deeper cut is a **`bside` `narrationForm`** — the live `narrationFormEnum`/Zod `narrationForm`
> already reserves `'bside'` as "a deferred 'tell me more' alternate telling." So the original §3
> decision ("nullable `deeper_cut_*` columns on `tour_stops`, no new table") is SUPERSEDED — see the
> rewritten §3 for the V2 framing and the one real open question (the `narrations_poi_uq` 1:1
> constraint). Other renames below: `pois.facts` well → `pois.fact_sheet`; `DEEP_EXTRACT_CHARS=4000`
> → `NARRATION_FALLBACK_CHARS=4000` (+ the enricher's read bound `ENRICHER_INPUT_CHARS=12000`);
> `resynth-tour.ts` → `resynth-narration.ts`; `finalizeTourReady` is gone (readiness derives from
> non-null `audio_url`). **⚠ `narrateIntro`/`narrateOutro` no longer exist** — §4 calls the b-side
> generator "a sibling to `narrateStop`/`narrateIntro`/`narrateOutro`", but the intro/outro frame and
> the persona kit were deleted 2026-06-19
> ([cut-intro-frame-and-persona-kit](../decisions/cut-intro-frame-and-persona-kit.md)); `narrateStop`
> is the only sibling left, which if anything makes §4's "a second `narrate.ts` call" simpler than
> written. §7's note that framing would be a **hard** (never-preempted) clip class stays correct as a
> v3 conditional — there is just nothing placeless to preempt today.

**A pre-generated *deeper cut* per story stop, played on a "Tell me more" tap** — drawing on the
leftover fact-sheet material the tight ~2-min main clip didn't use. The **offline-safe, shippable
middle** of the pull ladder for dead air: `replay-last → tell-me-more → Ask the Skipper`. No live
LLM, no STT, no network — works in the dead zones where dead air is worst.

## 0. TL;DR

- After a stop, in the gap, a **"Tell me more"** button plays a **second, deeper telling** of that
  same place — built from the leftover grounded material (the curated `pois.fact_sheet`, or the
  un-enriched fallback head capped to `NARRATION_FALLBACK_CHARS = 4000`) the main ~2-min clip
  (`TARGET_SECONDS.story = 120`) didn't spend.
- **It's pre-generated and place-owned**, like the main clip — *not* live. So it's offline, cheap to
  play, and grounding-safe (same fact sheet, same attribution).
- **A `bside` narration form** (V2) — a second telling of the same poi, shared like the main one;
  reconcile with the `narrations_poi_uq` 1:1 constraint per §3. **Not** in the ready-gate (optional,
  like callouts).
- **In the player it's `replay-last`'s sibling** — same gap surface, same soft-clip preemption rule.
- The point: it lets the curious **pull** depth without bloating the tight default *everyone* hears.

## 1. Why a separate clip (not just a longer main clip)

It resolves a contradiction sitting in the competitor reviews
([competitor-ux-studies](../research/competitor-ux-studies.md)):
users complain about **both** *"dead air, too little"* **and** *"repetitive / too long / just
driving"* (GuideAlong's Hana review, Autio's "museum tour"). A longer main clip fixes the first and
*worsens* the second. The deeper cut is the only move that resolves both:

> **Keep the main clip tight (the right default for *everyone*); let the curious *pull* more.
> Decouple "the right default length" from "available depth."**

Two concrete reasons it must be a separate, opt-in clip:
- **Pacing.** The main clip is calibrated to the drive's `QUEUE_LAG` constraint — it has to fit the
  gap before the next stop fires. The deeper cut is *pull*, so it's **freed from that constraint**:
  the rider opts in during a long gap *they* chose to fill.
- **Taste.** Most riders don't want 4 minutes on *every* stop — that's the exact "too long /
  repetitive" complaint. Tight default + opt-in depth serves the curious without taxing the rest.

## 2. Content & generation

A deeper cut is a **second, non-redundant telling** of the same place:
- **Source:** the same grounding the main clip used — the curated `pois.fact_sheet` (or, for an
  un-enriched poi, the positional head of `pois.facts.extract` capped to `NARRATION_FALLBACK_CHARS`
  = 4000) — specifically the **leftover** the main ~2-min telling skipped (a tight clip spends a
  fraction of the available material; the enricher's read bound is `ENRICHER_INPUT_CHARS` = 12000).
- **Generation:** a second `narrate.ts` call (sibling to `narrateStop`/`narrateIntro`/`narrateOutro`),
  **conditioned on the main script**: *"Here is what was already said about this place; go DEEPER or
  ELSEWHERE in these facts — never repeat the main telling. If the facts are exhausted, return
  nothing."* This reuses the conditioning machinery the studio pipeline already runs for diversity
  (`generate-narrations.ts`'s prior-stop / recent-motif threading), pointed *within* a place.
- **Eligibility is automatic (the exhaustion gate).** "Return nothing if the facts are exhausted" is
  the same *silence-beats-padding* discipline already enforced (thin articles stay short). A
  fact-rich place gets a deeper cut; a thin one doesn't — its "Tell me more" is simply absent. No
  separate eligibility heuristic needed.
- **Story-only.** Scenic has no facts; break carries name+kind only — nothing to go deeper *on*.
- **Grounded, same invariant.** Same grounding → carries the narration's `attribution` and is
  governed by the same `facts_hash`. "Persona in DELIVERY, never FACTS" applies unchanged.
- **Charm freebie:** because the deeper cut is *new* narration (not a verbatim replay), it can open
  in-character — *"Since you asked—"* / *"Alright, you want the real story—"*. It's literally
  answering the tap. Costs nothing (it's generated anyway) and sells the "alive" feeling.

## 3. Data model — the `bside` narration form (V2)

V2 already anticipates this feature: the live `narrationFormEnum` (and its Zod mirror
`narrationForm`) reserves **`'bside'`** as "a deferred 'tell me more' alternate telling." So a deeper
cut is a SECOND `narrations` row for the same poi, `form='bside'` — sharing the place, the
`attribution` (`AttributionSnapshot[]`), and the `facts_hash` of the main `story` telling, so it
**regenerates when the fact sheet changes** (it grounds on the same sheet). The deeper cut is
**place-owned** (`narrations`), reused by every drive that visits the poi — the same shared-atom
posture as the main telling — not per-tour storage (there is no `tours` table in V2).

> **The one real open question (decide at build time):** today `narrations` carries a
> `narrations_poi_uq` UNIQUE(poi_id) constraint — the strict 1:1 "one telling per place" invariant.
> A `bside` is a SECOND telling of the same poi, so it can't land as another `narrations` row without
> reconciling that constraint. Two clean options:
> 1. **Relax the uniqueness to `UNIQUE(poi_id, form)`** — a poi may hold one row per form (its
>    `story`/`scenic`/`break` telling + its `bside`; `wave` came off the live list in the 1.1 sweep and
>    survives only as reserved enum vocabulary). Most schema-faithful; the `form` column already
>    exists. The drive joins must then select the right form explicitly.
> 2. **Keep the 1:1 narration and hang the bside off it** — nullable `bside_*` columns on the main
>    `narrations` row (the spirit of the original "no new table" decision, transposed from `tour_stops`
>    onto `narrations`). Simpler, but mixes two tellings on one row.
> ✅ **RESOLVED 2026-08-03 — and NEITHER option was taken. A b-side gets its OWN TABLE**, anchored to a
> poi XOR a cluster like `narrations` is (not to a `narrations.id`), and `narrations_poi_uq` is left
> alone. The recommendation above ("Option 1 … pick it unless the join cost bites") weighed the wrong
> cost: relaxing the uniqueness is not a schema change but an audit of every reader that resolves "the
> telling for this place" — including the loader that resolves a rider's frozen selection — and the
> failure mode is a rider hearing the deep cut instead of the introduction. The `detours` precedent
> (break audio is not a `narrations` row either, and anchors to `place_id` directly) settles the shape.
> Full reasoning, what the table must carry, and the two things still owed:
> [bside-gets-its-own-table](../decisions/bside-gets-its-own-table.md).

- **NOT in the ready-gate.** A drive is playable with zero deeper cuts (optional enhancement, like
  callouts) — readiness derives from non-null `audio_url` on the SELECTED items, so an absent `bside`
  never blocks anything. Generated in a **separate pass** and re-authored via the
  `resynth-narration.ts` regen path.

## 4. API / DTO + offline

- `@skipper/shared`: the stop DTO grows an optional `deeperCut: { audio, durationMs } | null`.
- `apps/api`: `/sign` serves the deeper-cut clip (place-scoped R2 key), same presign path as the
  main narration.
- **Offline (`offline.ts`):** the download manifest includes each deeper-cut clip so "Tell me more"
  works fully offline (the whole point). *(Note: this bundles pre-generated AUDIO — distinct from the
  raw fact-well bundling that on-device Ask (§4.6) needs. Shared *pattern* — extending the manifest
  with per-stop extras — not the same payload.)*

## 5. Player — `replay-last`'s sibling

Same surface, same moment, same mechanics as [replay-last-stop-spec](replay-last-stop-spec.md):
- **Affordance:** in the between-stops quiet, alongside **"Replay"**, a **"Tell me more"** button —
  shown only when the **last completed story stop has a deeper cut** (`canTellMore = activeSeq ===
  null && lastCompletedStoryStop?.deeperCut != null`). One big in-car-safe tap target.
- **Playback:** enqueue the deeper-cut clip → it loads and plays through the existing clip path
  (ducks/replaces the soundtrack like a normal story clip — it *is* one; not a callout-style
  duck-overlay).
- **Preemption (the shared rule):** a live GPS trigger **preempts** the deeper cut — it's *soft*
  pull content, and a live geo-stop is time-sensitive. This is the same **soft-clip vs hard-clip**
  concept replay-last introduces: replay, tell-me-more, and callouts are all **soft** (optional,
  preemptible); stops are **hard** (the spine, never preempted — and so are the intro/outro frames if
  and when they return: that placeless framing was deleted with the `asides` table in migration 0019
  and is v3-deferred, see [geometry-first-regions](../decisions/geometry-first-regions.md)). Reuse the
  one `replayingSeq`-style "soft clip currently playing" flag for all three.

## 6. The pull ladder + the Ask relationship

The family of dead-air *pull* answers ([ask-the-skipper-spec](ask-the-skipper-spec.md) §4.6):
- **replay-last** — *hear that again* (no new content).
- **tell-me-more** (this) — *a deeper cut on the same stop*, pre-canned, offline.
- **on-device Ask** — *answers YOUR question*, live, offline, degraded.
- **cloud Ask** — *answers YOUR question*, live, best, online.

**How it de-risks Ask:** tell-me-more proves the **pull UX** and the **soft-clip player mechanics**
(the gap affordance + preemption) with **zero live infrastructure**, and exercises the
**offline-manifest-extension pattern** Ask will reuse. It does **not** itself bundle the raw fact
wells (it ships pre-baked audio) — that's a distinct on-device-Ask prerequisite. If tell-me-more
lands, Ask is the natural upgrade: swap the *fixed* B-side for a *responsive* grounded answer.

## 7. Tradeoffs (honest)

- **Cost.** Roughly **doubles narration + TTS + storage + offline-download bytes** per *eligible*
  story stop. Real GCP/bytes — but incremental and optional (generate after `ready`; eligible stops
  only; the exhaustion gate self-limits). `log` which stops got a deeper cut so the added download
  weight is visible, not silent.
- **It's one fixed B-side, not responsive to *your* question** — less magical than Ask. That's the
  deliberate trade for offline + ships-now.

## 8. Build phases (file-level)

### 8.0 The order below is INVERTED — ear-tune came first (2026-08-03)

As written, phases 1–4 build generation, a live-DB migration, API/DTO and the player, and only then
(phase 5) ask by ear whether a deeper cut *is a genuine B-side or a leftover-scraps dump*. That puts
the one question capable of killing the feature after every irreversible step. So phase 5 was pulled
to the front and answered on its own:

- **Built:** `narrateDeeperCut` (`packages/studio/src/pipeline/narrate.ts`) — the same
  `NarrationRequest` that produced the main telling, plus a B-SIDE block naming the main script as
  material already spent. ⚠ It resolves to `null` on exhaustion via an **in-band sentinel**
  (`DEEPER_CUT_NONE`), because §2's "return nothing" is not available: `runNarration` THROWS on empty
  output, a quality invariant for the main telling that a b-side must not weaken since both share the
  call.
- **Built:** `packages/studio/src/generate-bside-narrations.ts` — ranks live story stops by unspoken
  sheet material and prints the b-side. **Preview-by-default; `--apply` makes the model calls.** ⚠ The
  flag means something different here than in the other studio CLIs: on a script-only run the CALL is
  the spend, so `--apply` does not mean "write to the DB". It still persists nothing.
- **Measured (read-only, no spend):** across 421 live story tellings, ~52% of curated `fact_sheet`
  facts are never spoken by the shipped clip (median 4/poi). Eligibility, if the exhaustion gate is
  proxied by material: **92%** of stops hold ≥1 unspoken fact, **64%** hold ≥300 chars, **47%** ≥500,
  **32%** ≥900. So the button would be present on roughly HALF the corpus at a "real telling"
  threshold, not nearly all of it — §10's "thin stop → button absent" is the common case, not the
  edge case, and the player should be designed for a button that comes and goes.
- **⚠ One correction to §2:** it sources the b-side from the curated sheet **or** the extract
  fallback. It should be **both** — there are ~277 median chars in `facts.extract` beyond the sheet on
  373/421 pois, and a b-side has no two-minute budget forcing it to choose. Widening the source is
  free and it raises the eligible pool. (Same argument as
  [ask-the-skipper-spec](ask-the-skipper-spec.md) §0.1.)
### 8.0.1 The ear check RAN (founder go, 2026-08-03) — §8.5 is ANSWERED: it's a B-side, not scraps

Four stops sampled ACROSS the material range via `--spread`, not the top of it. That selection is the
point: skimming the richest N would have tested only the ceiling and never fired the exhaustion gate,
and "green on rich proves nothing about thin."

| Stop | Unspoken | Result |
|---|---|---|
| Riverside Hotel (Reno) | 2,978 chars | b-side, 212 words (~85s) — did NOT sprawl |
| Reese–Johnson–Virgin House | **446 chars (the corpus median)** | b-side, 149 words (~60s) |
| Station Casino Reno | 82 chars | **declined** |
| Pope Estate | 0 chars | **declined** |

`generated=2 exhausted=2 failed=0`, 4 calls, $0.13, prompt cache reading (13.7k).

**The three things it proves.** (1) The MEDIAN stop works — the case most likely to sink the feature.
Its b-side found that the Pink House was listed on the National Register *twice*, once inside the 1975
Genoa Historic District and once on its own in 2004, a distinction the main telling passed straight
over: *"once for keeping good company, and once all by itself."* That is a genuine deeper cut, not
leftovers. (2) A fact-rich stop goes deeper without turning into a lecture — the Riverside cut lands
*"one fellow designed the building where you got your divorce and the building where you slept it off.
Full service."* and gets out at 85 seconds. (3) **The exhaustion gate fires rather than pads** — the
two thin stops returned `DEEPER_CUT_NONE` instead of stretching one leftover fact, which was the
failure mode that would have quietly filled the corpus with scraps.

⚠ **One prompt tweak owed before a corpus run:** the Riverside cut opens *"Since you're curious about
the man who drew all this"* — an acknowledgment open the b-side block explicitly asks it to avoid.
Harmless once, grating at 200 clips (this is the repo's structural-monotony trap: a low-input form
converges on one shape). Tighten the "do not open by acknowledging the request" line, or drop it and
let §2's "since you asked" charm freebie be deliberate rather than accidental — but pick one.

**Where this leaves the numbered phases.** The content risk is retired; what remains is the
`narrations_poi_uq` reconciliation (§3), and the player question §8.0 raised — the button is present on
roughly half the corpus, so a design that assumes it is usually there will be wrong. Neither is a
content question any more.

Resume the numbered phases below now that the ear check has passed.

1. **Generation.** ✅ `narrateDeeperCut` is BUILT (§8.0). What remains is wiring it into
   `generate-narrations.ts` as a post-narration pass; persist a row in the **b-side's own table** (see
   phase 2); place-scoped R2 write; **not** gating readiness. Add a regen path to
   `resynth-narration.ts`.
2. **Schema + migration** (CHECKPOINT — live DB). ⚠ **SUPERSEDED — do NOT follow the two options this
   phase used to list.** Relaxing `narrations_poi_uq` to `UNIQUE(poi_id, form)` and hanging nullable
   `bside_*` columns off `narrations` were BOTH rejected (founder, 2026-08-03):
   [bside-gets-its-own-table](../decisions/bside-gets-its-own-table.md). The b-side gets its **own
   table**, anchored to a poi XOR a cluster, carrying `attribution` / `facts_hash` / `released_at` /
   the XOR CHECK — and it is created in the same change that first WRITES to it, with the test pinning
   both tables' XOR shipping alongside. ADDITIVE, so it does not trip the destructive-change gate.
3. **API/DTO + offline.** `deeperCut` on the stop DTO; `/sign` for the clip; manifest entry in
   `offline.ts`.
4. **Player.** `useDrive` + drive screen: the "Tell me more" affordance + `canTellMore`, riding the
   shared soft-clip path (built with / after replay-last).
5. **Ear-tune.** Does the deeper cut feel like a genuine B-side or a leftover-scraps dump? Tune the
   "go deeper / never repeat" prompt and the exhaustion threshold by ear (the founder gate).

## 9. Forks / scope

- **One deeper cut, or a chain ("tell me even more")?** → **one for v1.** A chain is where Ask should
  take over (open-ended depth is the live model's job, not N pre-baked B-sides).
- **All eligible stops, or cap for download size?** → **all eligible** (the exhaustion gate already
  self-limits to fact-rich stops); just surface the count/weight in generation logs.
- **v1:** last completed *story* stop, live drive, one deeper cut. **Later:** tell-me-more on the
  currently-playing stop; tap-any-passed-row (shared with replay-last's v2); the chain → Ask.

## 10. Edge cases

- **Thin stop / no deeper cut** → `canTellMore` false, button absent (the exhaustion gate).
- **Scenic / break** → no deeper cut (no facts).
- **Facts change → stop regenerates** → the deeper cut regenerates too (shared `facts_hash`).
- **Live trigger mid-deeper-cut** → preempt (soft clip), §5.
- **Pause/resume, replay-during** → same as any clip.

## 11. Provenance

- Surfaced from the dead-air thread ([competitor-ux-studies](../research/competitor-ux-studies.md):
  the too-little/too-much contradiction) and the pull-ladder framing
  ([ask-the-skipper-spec](ask-the-skipper-spec.md) §4.6).
- Studio seams: `packages/studio/src/pipeline/narrate.ts` (the new `narrateDeeperCut`),
  `generate-narrations.ts` (conditioning: prior-stop / recent-motif threading), `config.ts`
  (`NARRATION_FALLBACK_CHARS=4000` / `ENRICHER_INPUT_CHARS=12000`, `TARGET_SECONDS.story=120`),
  `persist.ts`, `resynth-narration.ts`. Readiness now derives from non-null `audio_url` per item
  (the V1 `finalizeTourReady` gate is gone).
- Schema: `narrations` (the shared place-owned telling — `script`/`audio_url`/`audio_duration_ms`/
  `attribution`/`facts_hash`/`form`), where the `bside` form (or the bside columns) lives — §3.
- Player: `apps/mobile/src/lib/useDrive.ts` + `offline.ts`; the soft-clip concept + preemption from
  [replay-last-stop-spec](replay-last-stop-spec.md).

**Decisions locked:** pre-generated (not live); a second non-redundant telling from the leftover
fact sheet, exhaustion-gated for eligibility; story-only; a `bside` narration form sharing
attribution + `facts_hash`, not ready-gated (the V2 reconciliation of the original "no new table" on
`tour_stops` — §3); played as a soft clip (preemptible by live triggers), `replay-last`'s sibling on
the gap surface; v1 = one cut, last story stop, live drive; the de-risking floor of the Ask pull
ladder.
