# Audio loudness master spec — one Spotify-aligned target for all Skipper audio

**Status:** ACTIVE — target LOCKED 2026-06-19, narration MASTER CHAIN rebuilt 2026-06-20 (founder).
Canonical target: **−14 LUFS integrated / 11 LU range**, **−1.0 dBTP delivery ceiling** (EBU R128,
Spotify-aligned). Single source of truth for the target: `AUDIO_LOUDNESS` in `@skipper/shared`
(`packages/shared/src/audio.ts`). The narration master reaches a consistent −14 via a true-peak
LIMITER → single-pass loudnorm (peaky TTS is otherwise peak-bound) — see §1 + History 2026-06-20.

## The spec

| Knob | Value | Why |
|---|---|---|
| Integrated loudness (I) | **−14 LUFS** | Spotify's normalization level; the reference we A/B against. |
| True-peak ceiling (TP) | **−1.0 dBTP** (delivery) | The final-file ceiling. The narration master reaches it via a **−2 dBTP pre-encode** loudnorm ceiling — the 48 kbps AAC overshoots ~0.5 dB, so final clips land ≈−1.5. |
| Loudness range (LRA) | **11 LU** | The loudnorm default; speech + the quiet music bed are both low-dynamic, so it rarely binds. |

Tune in ONE place — `AUDIO_LOUDNESS` — then re-master both surfaces below.

## Where it applies

1. **Studio TTS narration.** Every shipped take is mastered to −14 at synthesis by the `masteringChain`
   in `packages/studio/src/pipeline/loudnorm.ts` — a true-peak **`alimiter`** (pushes the body up +
   brick-walls the peaks, making the headroom peaky TTS lacks) → **single-pass dynamic `loudnorm`** to
   −14 LUFS, fused with the AAC encode. The integrated target + LRA come from `AUDIO_LOUDNESS`; the
   limiter params + the **−2 dBTP pre-encode ceiling** (AAC-overshoot headroom → final ≈−1.5 dBTP) live
   in `loudnorm.ts`. Validated 2026-06-20 on 3 clips (LRA 4→10): consistent −14.1…−14.5, clean peaks.
   Applies on the next (re)synthesis — existing clips take it on regen.

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
- **2026-06-20 — peak-limiter master (the louder/cleaner fix), after a false start.** A first attempt
  (an `acompressor` BEFORE the two-pass linear loudnorm) shipped + was reverted same day: a stateful
  filter breaks the two-pass "measured == gained" assumption, so the TP limit hit the wrong peaks and
  the 48 kbps AAC overshot to **+2.4 dBTP (clipping)** while still landing ~−15. Root-caused on REAL raw
  TTS (the first attempt was mis-validated on already-mastered clips): Gemini TTS is **peak-bound** — it
  crests at ~0 dBFS, so a plain loudnorm can't gain up and undershoots −14 inconsistently (−14.7…−15.5).
  Fix = the broadcast move done right: a true-peak `alimiter` makes the headroom, then a **single-pass**
  dynamic loudnorm hits −14 (no measure/apply gap), with a **−2 dBTP pre-encode ceiling** for AAC
  overshoot. Validated on 3 clips → consistent ~−14.1…−14.5, clean peaks, LRA cost ~1 LU. (This is
  exactly Spotify Loud's mechanism — gain + limiter.) `LOUDNORM_TRUE_PEAK_DB` retired: the master owns
  its pre-encode TP now.

## Open

- **On-device A/B vs Spotify** of the −14 master (narration + music together) on the real drive.
- **Louder still?** −13 is reachable with the SAME chain at more limiter gain (validated: clean, but
  LRA → ~3.5, a denser "radio" voice) — a creative call, deferred. To go louder, raise
  `LIMITER_INPUT_GAIN` in `loudnorm.ts` and re-validate peaks across clips — NOT the target number
  (peak-bound, so a bare target bump does nothing; that's the lesson the limiter exists to fix).
- **Drive-music bed** still uses plain offline loudnorm at −14 / −1.0 (pre-mastered, low-overshoot MP3 —
  it doesn't need the limiter); revisit only if the voice/bed handoff reads uneven on-device.
