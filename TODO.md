# TODO — engineering backlog

Carry-forward **engineering** items (the near-term layer of the truth system — see
`docs/README.md`; product ideas live in `docs/ideas/`, build-ready designs in `docs/specs/`).
Each item has enough context to action without re-deriving the reasoning. **Delete items
when done** — git history is the archive.

## Generation is not resumable — checkpoint the TTS spend

The cost *guardrail* shipped 2026-06-09: every Anthropic call records its usage
(`pipeline/spend.ts`), generate.ts prints the sunk LLM spend + a token-based TTS estimate
right before the TTS/R2 phase, and `--max-cost` aborts there (scripts + eval record still
land, tour state untouched); the regen loop was already hard-capped (`EVAL_REGEN_BUDGET`).
What remains is the ROBUSTNESS half: generation is **not resumable** — a crash mid-run
wastes all prior LLM+TTS spend (fresh per-run clip ids mean a retry re-synthesizes
everything) and orphans R2 objects. `storage.ts` already exposes `audioExists` ("lets
callers skip re-synthesis") with zero callers.

- [ ] Checkpoint synthesized clips (key by script hash, or persist run progress) so a
      retry resumes instead of re-paying the whole TTS phase.

Refs: `packages/generator/src/pipeline/generate.ts` (the bounded synth pool + atomic
ready-gate), `packages/generator/src/pipeline/storage.ts` (`audioExists`), and the R2
orphan sweep item below (the other half of the blast radius).

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

## R2 orphan sweep (cost cruft from regens)

Every successful regen orphans the previous telling's clips in R2: stop AND bracket keys
are per-run unique (deliberate — see `storage.ts`), so old objects under
`clips/<tourId>/…` are simply abandoned when `finalizeTourReady` replaces the rows. Known
+ accepted (private, unreferenced bytes), but it accrues. A small sweep tool — list
`clips/<tourId>/`, delete every key not referenced by a current `tour_stops.audioUrl` /
`tour_brackets.audioUrl` — caps it. Run it manually after blessed regens.

Refs: `packages/generator/src/pipeline/storage.ts` (`deleteAudio` exists),
2026-06-09 DB-write audit (verified-minor finding).

## Offline downloads never see patched clips

`patch-clip` re-synthesizes in place at the stored key, but a device that already
DOWNLOADED the tour keeps its local bytes forever — the exact bad word the tool fixed
stays on-device until the user manually re-downloads. Real fix is a manifest version (bump
on any clip update; the app re-fetches changed clips). Post-MVP; matters once strangers
hold offline tours.

Refs: `packages/generator/src/patch-clip.ts`, `apps/mobile/src/lib/offline.ts` (manifest),
2026-06-09 DB-write audit (verified-minor finding).
