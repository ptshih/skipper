# Automated grounding gate — the founder reverses "human ear instead"

> **Status:** DECIDED + BUILT 2026-06-19. The eval panel is wired into `generate-narrations.ts` as an
> automated, fail-closed gate; the `eval_runs`/`eval_scores` tables are redesigned for V2 and written
> on every run. Migration (eval-table redesign) generated separately + applied with the 0016–0020
> backlog. Supersedes the Deferred-list entry "any automated groundedness gate (human ear instead)"
> (CLAUDE.md) and the parked staging in `docs/ideas/eval-panel-rewire.md`.

## The decision

The founder removed the per-clip human ear from the ship loop: **"I don't want to have to manually
sign-off on clips, I would rather it all be automated."** That reverses the long-standing deferral
("any automated groundedness gate — human ear instead") and the V2-alpha cut ("founder-eared instead").
Grounding now BLOCKS shipping; it no longer merely informs.

## What got built

The eval panel (`packages/studio/src/eval/*`) — built but unwired since the V2 collapse — is now wired
into the per-clip generation loop. Per clip, before any TTS spend:

1. **Narrate** the draft (`narrateStop`).
2. **Score** the panel: GROUNDING (Opus, the cardinal-invariant gate) + LATERALITY (free, a grounding
   backstop — naming a side of the road in roam is an ungrounded place-claim) + TTS-cleanliness (free
   gate) + DIVERSITY (free, advisory — kit ban + within-clip tics).
3. **Auto-retake** via the built `optimize()` flywheel (accept-only-if-not-worse, Pareto gate-guard,
   thrash guard), bounded by `GROUNDING_REGEN_MAX_ROUNDS`.
4. **Fail-closed**: a clip whose GATE dimension (grounding/tts) stays dirty after the retakes is
   **WITHHELD** — never synthesized, never persisted — and recorded in `eval_scores` with
   `withheld=true`. The fail-closed FALLBACK is flag-and-withhold (founder's choice): no auto-downgrade
   to scenic, no ship-with-flag. "Silence beats a bad telling," automated.

This **replaces** the two old cheap inline guards (kit ban + no-laterality): one loop, one gate, one
scorecard — a net simplification, not a second quality system.

## The honest boundary

Automation cleanly covers what is OBJECTIVE — **grounding** (claim-traces-to-sheet) and **tts**. It
does NOT auto-gate the SUBJECTIVE — **charm** (taste) and **veracity** (is the sheet true about the
*world*; the judge only checks traceability, not truth) — there is no trustworthy auto-judge for those,
so they stay advisory / un-gated. Net: the gate guarantees **"never ships a hallucination," not "always
charming."** A discovered "verbatim-but-misleading enrich span" is a veracity problem, invisible to the
grounding gate, and stays advisory.

## Observability — the eval tables, redesigned for V2

The founder OK'd simplifying the V1 eval schema. `eval_runs`/`eval_scores` were redesigned (clean
destructive migration, zero-users license):

- **`eval_runs`** — keyed by `region` (not a tour slug), with run tallies (`total`/`shipped`/`withheld`)
  and the three dims the gate runs (grounding/tts/diversity). Dropped: the ~100 KB `artifact` blob, the
  redundant `scorecard` jsonb, and the `charm`/`veracity` columns the gate never runs.
- **`eval_scores`** — keyed by `poiId` + `qid` (the V2 atom) with a denormalized `name` + a `withheld`
  flag, so "show me the held-back places and why" is a flat filter. Dropped the `poiSource`/
  `poiSourceId`/`seq` triple.

Written on every run (a dry `--scripts-only` run records too, persisting no narration — observability,
never product state). The admin surfaces them: `GET /admin/runs` (the timeline, now carrying `withheld`)
and `GET /admin/runs/:id/scores` (the per-(poi × dimension) report, worst-first).

## Hot-path hardening (required before a paid run)

- Per-clip `try/catch` around narrate + eval → a transient Opus failure on ONE clip withholds that clip
  and is recorded, never aborts the paid run (the narrate phase wasn't fault-isolated before).
- A runtime spend guard: abort BEFORE the dominant TTS spend if narrate+grounding already blew
  `--max-cost` (the pre-flight estimate is no longer the only ceiling).
- `SKIPPER_GROUNDING_EVAL=off` skips the Opus pass (the escape hatch); the free gates still run.

## Cost

~1 extra Opus grounding call per clip (~$0.04) + the odd bounded retake → ~$0.15/clip of LLM spend with
the gate on (vs ~$0.10 narration-only). On the ~459-clip Tahoe corpus that is single-digit-dollars more,
gated behind the existing founder-OK-to-`--apply` + `--max-cost` ceiling.

## Why this is the right call

The panel design panel (2026-06-19) showed an advisory instrument scored highest on doctrine-fit but
lowest on quality (a report has no shipped-quality delta without manual follow-through — exactly the
per-clip work the founder is rejecting). Automating the gate converts detection into prevention with no
human in the per-clip loop, and grounding is the LEAST thrash-prone case for auto-retake (a binary
zero-ungrounded target). The brainstorm lineage: `docs/ideas/eval-panel-rewire.md`.
