# "Tell me more" — the deeper-cut / B-side spec

**A pre-generated *deeper cut* per story stop, played on a "Tell me more" tap** — drawing on the
leftover fact-sheet material the tight ~2-min main clip didn't use. The **offline-safe, shippable
middle** of the pull ladder for dead air: `replay-last → tell-me-more → Ask the Skipper`. No live
LLM, no STT, no network — works in the dead zones where dead air is worst.

> **Status: SPEC ONLY — nothing built.** A generator + player feature, fully offline. Decided
> 2026-06-09. Builds on `docs/specs/replay-last-stop-spec.md` (the soft-clip player concept it shares) and
> `docs/specs/downtime-callouts-spec.md`; it's the pre-canned rung of the pull ladder formalized in
> `docs/specs/ask-the-skipper-spec.md` §4.6.

## 0. TL;DR

- After a stop, in the gap, a **"Tell me more"** button plays a **second, deeper telling** of that
  same stop — built from the leftover grounded material (`DEEP_EXTRACT_CHARS = 4000`) the main
  ~2-min clip (`TARGET_SECONDS.story = 120`) didn't spend.
- **It's pre-generated and tour-owned**, like the main clip — *not* live. So it's offline, cheap to
  play, and grounding-safe (same fact well, same attribution).
- **No new table:** it's nullable columns *on* `tour_stops` (1:1 with a story stop). **Not** in the
  ready-gate (optional, like callouts).
- **In the player it's `replay-last`'s sibling** — same gap surface, same soft-clip preemption rule.
- The point: it lets the curious **pull** depth without bloating the tight default *everyone* hears.

## 1. Why a separate clip (not just a longer main clip)

It resolves a contradiction sitting in the competitor reviews (`docs/research/competitor-ux-studies.md`):
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

A deeper cut is a **second, non-redundant telling** of the same stop:
- **Source:** the same `pois.facts` well the main clip used — specifically the **leftover** the main
  ~2-min telling skipped (the deep extract is 4000 chars; a tight clip spends a fraction).
- **Generation:** a second `narrate.ts` call (sibling to `narrateStop`/`narrateIntro`/`narrateOutro`),
  **conditioned on the main script**: *"Here is what was already said about this place; go DEEPER or
  ELSEWHERE in these facts — never repeat the main telling. If the facts are exhausted, return
  nothing."* This reuses the within-tour conditioning machinery the generator already runs for
  diversity (`generate.ts`'s `priorStops`/`recentMotifs` threading), pointed *within* a stop.
- **Eligibility is automatic (the exhaustion gate).** "Return nothing if the facts are exhausted" is
  the same *silence-beats-padding* discipline already enforced (thin articles stay short). A
  fact-rich stop gets a deeper cut; a thin one doesn't — its "Tell me more" is simply absent. No
  separate eligibility heuristic needed.
- **Story-only.** Scenic has no facts; break carries name+kind only — nothing to go deeper *on*.
- **Grounded, same invariant.** Same well → carries the stop's `attribution` and is governed by the
  same `facts_hash`. "Persona in DELIVERY, never FACTS" applies unchanged.
- **Charm freebie:** because the deeper cut is *new* narration (not a verbatim replay), it can open
  in-character — *"Since you asked—"* / *"Alright, you want the real story—"*. It's literally
  answering the tap. Costs nothing (it's generated anyway) and sells the "alive" feeling.

## 3. Data model — no new table

A deeper cut is strictly **1:1 with a story stop**, so it's nullable columns *on* `tour_stops`
(contrast callouts/brackets, which are placeless / 1-to-many and earned their own tables):
```
tour_stops += deeper_cut_script        text   null
              deeper_cut_audio_url      text   null   -- tour-scoped R2 key
              deeper_cut_audio_duration_ms int null
```
- **Shares** the stop's `attribution` (`AttributionSnapshot[]`) and `facts_hash` — same facts, same
  staleness, so it **regenerates with the stop** when the well changes. It's just more tour-owned
  narration on the same row.
- **NOT in the ready-gate.** A tour is `ready` with zero deeper cuts (optional enhancement, like
  callouts) — they can be generated in a **separate pass after `ready`**, and re-authored via the
  `resynth-tour.ts` regen path.

## 4. API / DTO + offline

- `@skipper/shared`: the stop DTO grows an optional `deeperCut: { audio, durationMs } | null`.
- `apps/api`: `/sign` serves the deeper-cut clip (tour-scoped R2 key), same presign path as stops.
- **Offline (`offline.ts`):** the download manifest includes each deeper-cut clip so "Tell me more"
  works fully offline (the whole point). *(Note: this bundles pre-generated AUDIO — distinct from the
  raw fact-well bundling that on-device Ask (§4.6) needs. Shared *pattern* — extending the manifest
  with per-stop extras — not the same payload.)*

## 5. Player — `replay-last`'s sibling

Same surface, same moment, same mechanics as `docs/specs/replay-last-stop-spec.md`:
- **Affordance:** in the between-stops quiet, alongside **"Replay"**, a **"Tell me more"** button —
  shown only when the **last completed story stop has a deeper cut** (`canTellMore = activeSeq ===
  null && lastCompletedStoryStop?.deeperCut != null`). One big in-car-safe tap target.
- **Playback:** enqueue the deeper-cut clip → it loads and plays through the existing clip path
  (ducks/replaces the soundtrack like a normal story clip — it *is* one; not a callout-style
  duck-overlay).
- **Preemption (the shared rule):** a live GPS trigger **preempts** the deeper cut — it's *soft*
  pull content, and a live geo-stop is time-sensitive. This is the same **soft-clip vs hard-clip**
  concept replay-last introduces: replay, tell-me-more, and callouts are all **soft** (optional,
  preemptible); stops and brackets are **hard** (the spine, never preempted). Reuse the one
  `replayingSeq`-style "soft clip currently playing" flag for all three.

## 6. The pull ladder + the Ask relationship

The family of dead-air *pull* answers (`docs/specs/ask-the-skipper-spec.md` §4.6):
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

1. **Generation.** `narrate.ts`: a `narrateDeeperCut` (conditioned on the main script, exhaustion-
   gated). Wire into `generate.ts` as a post-narration pass; persist onto `tour_stops`; tour-scoped
   R2 write; **not** added to `finalizeTourReady`. Add a regen path to `resynth-tour.ts`.
2. **Schema + migration** (CHECKPOINT — live DB): the three nullable `deeper_cut_*` columns on
   `tour_stops`. Clean/destructive (no users).
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

- Surfaced from the dead-air thread (`docs/research/competitor-ux-studies.md`: the too-little/too-much
  contradiction) and the pull-ladder framing (`docs/specs/ask-the-skipper-spec.md` §4.6).
- Generator seams: `packages/studio/src/pipeline/narrate.ts` (the new `narrateDeeperCut`),
  `generate.ts` (within-tour conditioning: `priorStops`/`recentMotifs`), `config.ts`
  (`DEEP_EXTRACT_CHARS=4000`, `TARGET_SECONDS.story=120`), `persist.ts`, the `finalizeTourReady`
  ready-gate (deliberately NOT included), `resynth-tour.ts`.
- Schema: `tour_stops` (zero-reuse narration columns — `script`/`audio_url`/`audio_duration_ms`/
  `attribution`/`facts_hash` — that the `deeper_cut_*` columns mirror).
- Player: `apps/mobile/src/lib/useDrive.ts` + `offline.ts`; the soft-clip concept + preemption from
  `docs/specs/replay-last-stop-spec.md`.

**Decisions locked:** pre-generated (not live); a second non-redundant telling from the leftover
well, exhaustion-gated for eligibility; story-only; nullable columns on `tour_stops` (no new table),
shares attribution + `facts_hash`, not ready-gated; played as a soft clip (preemptible by live
triggers), `replay-last`'s sibling on the gap surface; v1 = one cut, last story stop, live drive;
the de-risking floor of the Ask pull ladder.
