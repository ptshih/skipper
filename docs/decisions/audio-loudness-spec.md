# Audio loudness master spec — one Spotify-aligned target for all Skipper audio

**Status:** LOCKED 2026-06-19 (founder). Canonical target: **−14 LUFS integrated / −1.0 dBTP true-peak
ceiling / 11 LU range** (EBU R128, Spotify-aligned). Single source of truth in code: `AUDIO_LOUDNESS`
in `@skipper/shared` (`packages/shared/src/audio.ts`). Applied to BOTH shipped audio surfaces today.

## The spec

| Knob | Value | Why |
|---|---|---|
| Integrated loudness (I) | **−14 LUFS** | Spotify's normalization level; the reference we A/B against. |
| True-peak ceiling (TP) | **−1.0 dBTP** | Standard streaming ceiling; leaves headroom so the gain-up can't clip. |
| Loudness range (LRA) | **11 LU** | The loudnorm default; speech + the quiet music bed are both low-dynamic, so it rarely binds. |

Tune in ONE place — `AUDIO_LOUDNESS` — then re-master both surfaces below.

## Where it applies

1. **Studio TTS narration.** Every shipped take is linear-loudnormed to the spec at synthesis
   (`packages/studio/src/pipeline/loudnorm.ts`, two-pass `loudnorm` fused with the AAC encode). The
   `LOUDNORM_TARGET_LUFS` / `LOUDNORM_TRUE_PEAK_DB` / `LOUDNORM_RANGE_LU` constants in
   `packages/studio/src/models.ts` are **derived from** `AUDIO_LOUDNESS` (not redefined). Applies on
   the next (re)synthesis — existing clips take it on regen.

2. **Bundled drive-music rotation.** The 17 tracks in `apps/mobile/assets/audio/*.mp3`
   (`src/lib/driveMusic.ts`) are mastered OFFLINE to the same spec — a one-time ffmpeg re-encode, NOT
   a runtime path. Recipe + per-track sources/licenses: `apps/mobile/assets/audio/SOURCE.md`.

Matching voice and music to one target is the point: the rotation plays foreground between stops and
ducks to silence under a narration, so a mismatched bed would jump in level on every hand-off.

## History

- Narration shipped at −14 LUFS / **−1.5 dBTP** 2026-06-11 (the loudnorm mechanism;
  `audio-compression-spike.md`).
- **2026-06-19 — TP ceiling raised −1.5 → −1.0.** Founder feedback "still a bit too quiet"; a measured
  clip read −14.9 LUFS because the −1.5 ceiling bound (peaks already −0.77 dBTP post-AAC) and the
  linear gain undershot −14. −1.0 recovers the headroom so loudnorm reaches the target.
- **2026-06-19 — drive music matched to −14 / −1.0.** Previously the 16 added tracks were at ~−13
  (with `drive_loop.mp3` left un-normalized at ~−15) — ~1 dB louder than the voice and uneven. Re-mastered
  the full rotation to the spec (192 kbps stereo MP3, metadata stripped); the level spread (−11.7 … −15.0)
  collapsed to a uniform ≈−14.
- **2026-06-19 — spec centralized** into `AUDIO_LOUDNESS` (`@skipper/shared`) so narration and music
  reference one definition instead of scattered magic numbers (founder: "make sure these are defined
  somewhere for future").

## Open

- **On-device A/B vs Spotify** of the −14 / −1.0 level (narration + music together) on the real drive,
  before the first paid full-corpus regen. If it still reads low, nudge `AUDIO_LOUDNESS.integratedLufs`
  (−13/−12) or the TP ceiling further toward 0 — one edit, re-master both surfaces.
