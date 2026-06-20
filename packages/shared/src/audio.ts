// Audio loudness master spec — the SINGLE source of truth for the level of every shipped Skipper
// audio surface. EBU R128, Spotify-aligned. Applied to BOTH:
//   • studio TTS narration — linear-loudnormed at synthesis (packages/studio/src/pipeline/loudnorm.ts;
//     the LOUDNORM_* constants in that package's models.ts are derived from this object), and
//   • the bundled drive-music rotation — apps/mobile/assets/audio/*.mp3, mastered OFFLINE to this same
//     target (the re-encode recipe + per-track sources live in apps/mobile/assets/audio/SOURCE.md).
// Matching voice and music to one target means the rotation never jumps in level when it ducks under
// a stop and swells back. The numbers are tunable here in ONE place; nudge and re-master both surfaces.
// Why these values + history: docs/decisions/audio-loudness-spec.md (and audio-compression-spike.md).
export const AUDIO_LOUDNESS = {
  /** Integrated loudness target (LUFS) — Spotify's normalization level. */
  integratedLufs: -14,
  /** True-peak ceiling (dBTP) — a standard streaming ceiling; headroom so the gain-up can't clip. */
  truePeakDbtp: -1.0,
  /** Loudness range (loudnorm LRA, in LU) — held at the loudnorm default; speech + the quiet music
   *  bed are both low-dynamic, so this rarely binds. */
  rangeLu: 11,
} as const
