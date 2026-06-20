# Audio loudness master spec — Spotify-aligned targets for Skipper audio

**Status:** ACTIVE — narration MASTER rebuilt + pushed to −13 on 2026-06-20 (founder). The VOICE and the
MUSIC now have DIFFERENT targets: narration **−13 LUFS** (the voice is the product — Spotify-"Loud"-ish),
the drive-music bed **−14 LUFS** (`AUDIO_LOUDNESS` in `@skipper/shared`). Shared: **11 LU range**, EBU
R128. The narration master reaches a consistent −13 via a true-peak LIMITER → single-pass loudnorm at
64 kbps AAC (peaky TTS is otherwise peak-bound, and −13 overshoots 48k) — see §1 + History 2026-06-20.

## The spec

| Knob | Narration | Music bed | Why |
|---|---|---|---|
| Integrated loudness (I) | **−13 LUFS** | **−14 LUFS** | Spotify-"Loud" for the voice (the product); the bed sits 1 dB under (Spotify-"Normal"). |
| True-peak ceiling | **−3 dBTP** pre-encode | −1.0 dBTP | The narration master limits to −3 pre-encode so 64k AAC overshoot lands the final ≈−1.6…−2.1; the offline MP3 bed has little overshoot, so −1.0. |
| AAC bitrate | **64 kbps** | n/a (MP3 bed) | Raised from 48k so the louder −13 survives encoder overshoot (48k clipped some clips to +1.4). |
| Loudness range (LRA) | **11 LU** | **11 LU** | The loudnorm default; speech + the quiet bed are low-dynamic, so it rarely binds. |

The voice target + limiter params live in `loudnorm.ts`; the bed target (`AUDIO_LOUDNESS`) in `@skipper/shared`.

## Where it applies

1. **Studio TTS narration → −13.** Every shipped take is mastered by the `masteringChain` in
   `packages/studio/src/pipeline/loudnorm.ts` — a true-peak **`alimiter`** (pushes the body up +
   brick-walls the peaks, making the headroom peaky TTS lacks) → **single-pass dynamic `loudnorm`** to
   **−13 LUFS**, fused with the 64 kbps AAC encode. The narration target (−13), limiter params, and the
   **−3 dBTP pre-encode ceiling** all live in `loudnorm.ts` (only the LRA is shared from `AUDIO_LOUDNESS`).
   Validated 2026-06-20 on the 6-clip Reno corpus (resynthed + measured through the REAL path): consistent
   −13.0…−13.4, clean peaks (−1.6…−2.1). Applies on the next (re)synthesis — existing clips take it on regen.

2. **Bundled drive-music rotation → −14.** The 17 tracks in `apps/mobile/assets/audio/*.mp3`
   (`src/lib/driveMusic.ts`) are mastered OFFLINE to `AUDIO_LOUDNESS` (−14 / −1.0) — a one-time ffmpeg
   re-encode, NOT a runtime path. Recipe + per-track sources/licenses: `apps/mobile/assets/audio/SOURCE.md`.

The voice now sits ~1 dB ABOVE the bed (−13 vs −14). The bed plays foreground between stops and ducks to
SILENCE under a narration (it doesn't play under the voice), so the gap only shows when music swells back
after a clip — a subordinate-bed feel, intended. Flagged for the on-device A/B (Open).

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
- **2026-06-20 — pushed narration to −13 (louder), bitrate 48k→64k.** Founder "push to −13". −13 isn't a
  free target bump (peak-bound), so it took MORE limiter gain (`LIMITER_INPUT_GAIN` 3→6) + a deeper −3
  pre-encode ceiling. The canary caught two things the default-style validation missed: the register-
  varied resynth voice is ~1.8 dB PEAKIER than a default-style synth (so validate on the real resynth
  path, not standalone), and at 48k AAC one clip (US-395) overshot to **+1.4 dBTP (clipping)** while 5
  others were clean — 48k's overshoot is the wall. Raised AAC 48k→64k (overshoot −3 dB → US-395 −1.58) and
  resynthed all 6: consistent −13.0…−13.4, clean −1.6…−2.1. `LOUDNORM_TARGET_LUFS` retired (narration owns
  its −13 in `loudnorm.ts`; `AUDIO_LOUDNESS` −14 now governs only the music bed).

## Open

- **On-device A/B vs Spotify** of the −13 voice over the −14 bed on the real drive — confirm the 1 dB
  voice/bed gap reads right (voice dominant, bed subordinate on swell-back) and the −13 density is good.
- **Full-corpus regen** carries the −13 / 64k master; only the 6 Reno clips have it so far.
- **Louder than −13?** Don't — −13 is already at the EDGE of clean AAC (per-clip overshoot); past it you
  clip or crush the voice. Push the *bed* DOWN instead if more voice/bed separation is wanted.
- **Drive-music bed** stays plain offline loudnorm at −14 / −1.0 (pre-mastered, low-overshoot MP3 — no
  limiter needed).
