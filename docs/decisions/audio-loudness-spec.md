# Audio loudness master spec — Spotify-aligned targets for Skipper audio

**Status:** ACTIVE — the narration master is a true-peak LIMITER → single-pass loudnorm with TWO parked
presets in `loudnorm.ts` (`MASTERS`): **`normal14` (−14, ACTIVE)** and **`loud13` (−13, Spotify-"Loud" —
validated 2026-06-20 but OFF)**. At −14 the voice matches the **−14** drive-music bed (`AUDIO_LOUDNESS` in
`@skipper/shared`); flipping `MASTER` to `loud13` puts the voice 1 dB above it. Shared: **11 LU range**,
EBU R128, −1.0 dBTP delivery ceiling. Flip the preset in `loudnorm.ts` + regen — see §1 + History 2026-06-20.

## The spec

The narration presets (`loudnorm.ts` `MASTERS`) + the music bed (`AUDIO_LOUDNESS`):

| Knob | `normal14` (ACTIVE) | `loud13` (parked) | Music bed |
|---|---|---|---|
| Integrated loudness (I) | **−14 LUFS** | −13 LUFS | −14 LUFS |
| Pre-encode TP ceiling | −2 dBTP | −3 dBTP | −1.0 dBTP |
| Limiter gain (`level_in`) | 3 | 6 | n/a |
| AAC bitrate | 48 kbps | 64 kbps | n/a (offline MP3) |
| Loudness range (LRA) | 11 LU | 11 LU | 11 LU |

Final clips land ≈−1.5…−2 dBTP on either preset (AAC overshoot eats the pre-encode headroom). The voice
presets live in `loudnorm.ts` (flip `MASTER`); the bed target in `AUDIO_LOUDNESS` (`@skipper/shared`).

## Where it applies

1. **Studio TTS narration.** Every shipped take is mastered by the `masteringChain` in
   `packages/studio/src/pipeline/loudnorm.ts` — a true-peak **`alimiter`** (pushes the body up +
   brick-walls the peaks, making the headroom peaky TTS lacks) → **single-pass dynamic `loudnorm`** to the
   ACTIVE preset's target, fused with the AAC encode. Active = **`normal14` (−14, 48k)**; the parked
   **`loud13` (−13, 64k)** is one `MASTER =` line away. Targets, limiter params, pre-encode ceilings +
   bitrates all live in `loudnorm.ts` (only the LRA is shared from `AUDIO_LOUDNESS`). `loud13` was validated
   2026-06-20 on the 6-clip Reno corpus through the REAL resynth path (−13.0…−13.4, clean −1.6…−2.1).
   Applies on the next (re)synthesis — existing clips take the active preset on regen.

2. **Bundled drive-music rotation → −14.** The 17 tracks in `apps/mobile/assets/audio/*.mp3`
   (`src/lib/driveMusic.ts`) are mastered OFFLINE to `AUDIO_LOUDNESS` (−14 / −1.0) — a one-time ffmpeg
   re-encode, NOT a runtime path. Recipe + per-track sources/licenses: `apps/mobile/assets/audio/SOURCE.md`.

At the active −14 the voice MATCHES the bed (no hand-off jump — the original intent). Flipping to `loud13`
puts the voice ~1 dB ABOVE the bed; since the bed ducks to SILENCE under a narration (it doesn't play under
the voice), that gap only shows when music swells back after a clip — a subordinate-bed feel. Either way,
verify on the on-device A/B (Open).

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
- **2026-06-20 — reverted ACTIVE preset to −14, parked −13.** Founder: keep −13's tuning but ship −14 for
  now. Refactored the two recipes into `MASTERS` presets in `loudnorm.ts` (`normal14` ACTIVE, `loud13`
  OFF) so neither is lost — flipping is one `MASTER =` line + a regen. The 6 Reno clips were resynthed
  back to −14. `loud13` stays fully validated, ready when wanted.

## Open

- **On-device A/B vs Spotify** of the active −14 voice + bed on the real drive — and, if revisiting
  loudness, A/B `loud13` (−13) against it (flip the preset + regen the 6 Reno clips).
- **Full-corpus regen** still pending — only the 6 Reno clips carry the new limiter master (at −14).
- **Louder?** `loud13` (−13) is the parked, validated answer — flip `MASTER` in `loudnorm.ts`. Don't go
  past −13 (already the edge of clean AAC overshoot); drop the *bed* instead for more separation.
- **Drive-music bed** stays plain offline loudnorm at −14 / −1.0 (pre-mastered, low-overshoot MP3 — no
  limiter needed).
