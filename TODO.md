# TODO — engineering backlog

Carry-forward **engineering** items (the near-term layer of the truth system — see
`docs/README.md`; product ideas live in `docs/ideas/`, build-ready designs in `docs/specs/`).
Each item has enough context to action without re-deriving the reasoning. **Delete items
when done** — git history is the archive.

## Generation resumability — SHELVED 2026-06-10 (low ROI)

The cost *guardrail* shipped 2026-06-09 (`pipeline/spend.ts` usage tally + the `--max-cost`
pre-TTS abort + the hard-capped regen loop). The remaining ROBUSTNESS half — resuming a
crashed run instead of re-paying narration + TTS — was evaluated 2026-06-10 and **shelved as
low ROI**: the pipeline already retries transients (`pipeline/http.ts` 4× backoff on every
external call incl. TTS; the eval loop is budgeted + `allSettled` + never-gates; per-stop
failures are non-fatal), so only ~5% of failures are hard crashes, each wasting only
~$0.20–0.35 (narration ~$0.04–0.15, TTS ~$0.20–0.30). A durable checkpoint (DB table +
journal + resume branches in the demo-sensitive `generate.ts`) plus its correctness landmines
(stale-narration, truncated-clip reuse) isn't worth that. **Revisit ONLY if** crash/stage
logging later shows hard crashes are common.

Refs: 2026-06-10 ROI validation (this session); `pipeline/generate.ts` (all in-memory until
the atomic ready-gate), `pipeline/http.ts` (the retry that already covers most failures).

## TTS audio QA: tail-collapse retake + clip loudness normalization

Measured 2026-06-10 (ffmpeg volumedetect over all 30 live clips, founder-ear-confirmed):
Gemini-TTS takes are non-deterministic in LEVEL, two distinct defects —

1. **Tail collapse (the "mumble"):** 8/30 clips have a ≥3 dB tail-vs-body drop; the worst
   (emerald seq 13, Lake Tahoe Dam) ends with its final sentence at near-silence
   (−22.5 dB drop — silencedetect shows the closing words barely register). Fresh takes of
   the same scripts come out clean → take variance, NOT the voice and NOT the style prompt.
   - [ ] In the TTS phase: after each synthesize, measure tail(12s)-vs-body mean volume
         (ffmpeg read-only on the MP3 — no re-encode; graceful skip if ffmpeg absent) and
         RE-SYNTH once when drop ≥3 dB; keep the better take; record on the tts eval dim.
         Should land BEFORE the next regen so a Dam-class take can never ship again.

2. **Clip-to-clip level spread:** body mean volume ranges −26.7 → −19.5 dB across the 30
   clips (7.2 dB) — audible volume jumps stop-to-stop. Fix = per-clip loudness
   normalization (speech target, e.g. −16 LUFS; drive music is already matched at −13).
   Needs a small encode-path spike: loudnorm requires decode→re-encode, so either accept a
   32k→32k MP3 re-encode or request LINEAR16 and encode MP3 ourselves post-normalize.

Refs: `packages/generator/src/pipeline/tts.ts`, `pipeline/mp3.ts`,
`docs/decisions/audio-compression-spike.md` (the encode-path options),
`eval/tts.ts` (where the tail verdict should record).

## Offline downloads: full re-pull only (no per-clip diff)

DONE (2026-06-10): a re-cut clip (patch-clip / resynth-tour / a regen) is now DETECTABLE +
recoverable on-device. Each stop/bracket carries a `revisedAt` content token (the DB
`updated_at`, which every re-synth path already bumps, surfaced on the tour-detail DTO); the
offline manifest embeds the detail, and the tour screen compares a fresh fetch against the
saved copy (`isDownloadStale`, zero extra network) → a "Fresh cut ready" chip + a "Pull the
fresh copy" ⋯ action. NEVER forced; offline play keeps using the saved bytes until the rider
re-pulls. Manifest bumped to v2 (a v1 download lacks tokens → re-downloads).

REMAINING (post-MVP): the re-pull re-downloads EVERY clip, not just the changed ones. A
per-clip diff (download only the stale clips, merge into the existing manifest) is the
optimization — only matters once tours are large or strangers hold many offline tours.

Refs: `apps/mobile/src/lib/offline.ts` (manifest + `isDownloadStale`),
`apps/mobile/app/tours/[id]/index.tsx` (chip + ⋯ action), `packages/shared/src/schemas.ts`
(`tourStopView`/`tourBracketView` `revisedAt`), `apps/api/src/index.ts` (detail route).

## Upstream-contribution drafts for the active poi_overrides (agent drafts, human submits)

The fact-overrides loop's "contribute back" half is designed but UNBUILT: we correct upstream
source errors locally (`poi_overrides`), and the right thing is to also fix the SOURCE. Posture
(from the decision doc): **agent drafts, human submits** — Wikipedia's bot policy (WP:BOT) + COI
norms rule out autonomous editing, so an agent reads the `not_filed` rows (each already carries the
correction + an authoritative `source_url`) and drafts the talk-page post / edit; a human reviews
and files it, then sets `upstream_status` → `filed` (+ `upstream_url`).

Three ACTIVE fact_edits are draftable (all `upstream_status = not_filed`):
- **Lennart Palme** — Vikingsholm's architect (Emerald Bay State Park, wikipedia `1985884`); the
  article says "Leonard." Source: vikingsholm.com + Wikipedia's own Vikingsholm article.
- **Pope Estate builder/decade** (wikipedia `39007559`) — the article credits Lloyd Tevis / 1880s;
  correct is George Tallant (Crocker Bank) 1894, with the Tevis family buying it in 1899. Source:
  taylortallac.org history.
- **Chambers Lodge 1863** (wikipedia `32308786`) — the article says "first established in 1854";
  John McKinney established Hunter's Retreat at the site in 1863. Source: donsnotes.com + others.

NOT this list: the Tahoe Keys row is RETIRED (`active = false`, 2026-06-10) — Wikipedia already
removed the dated construction sentence, so there's nothing left to file.

- [ ] Draft a per-row talk-page correction (claim → correction → authoritative source, in
      Wikipedia's neutral register) for the 3 active rows; surface for human review + filing.

Refs: `docs/decisions/fact-overrides-and-veracity.md` ("Contribute back" + the discipline line),
`packages/db/seed/poi-overrides.ts` (the rows + reasons + source_urls),
`poi_overrides.upstream_status` / `upstream_url` (the workflow columns).
