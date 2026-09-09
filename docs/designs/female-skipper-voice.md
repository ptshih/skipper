# Add a female Skipper voice

**Status:** DEFERRED 2026-09-09 by founder request. Agreed plan saved for later; implementation,
audition, paid synthesis, and rollout are not scheduled or authorized by this document.
The female voice remains uncast until the founder hears the three-voice audition below.

## Experience

Add **Skipper voice: Male / Female** in Settings, using the same stories, humor, and personality.

- Male remains the default.
- Remember the preference on the device, including across sign-in.
- Apply it to new route previews and saved drives when opened. An active drive keeps its current voice.
- Download only the selected voice. Keep the previous download playable until its replacement is complete.
- If the selected voice is unavailable offline, clearly offer the downloaded voice instead.

The intended moment is choosing the female voice before a drive and hearing the same familiar
Skipper warmth and corny punchlines delivered by her. This is a voice choice, not a new character
or a rewrite of the stories.

Alternatives considered: a distinct female host with separate writing and evaluation; or keeping
Charon alone, avoiding extra recordings but leaving the requested choice unmet. The founder chose
the same Skipper with a second voice. Per-drive preferences, mid-playback switching, and downloading
both voices were also considered; the choices above are the agreed first version.

## Audition first

Compare **Sulafat, Gacrux, and Vindemiatrix**, all supported female voices in
[Google's voice catalog](https://docs.cloud.google.com/text-to-speech/docs/gemini-tts#voice_options)
(checked 2026-09-09; recheck provider documentation when resuming).

- Use four existing scripts covering history, landscape, civic, and a fused town telling.
- Produce a local listening page comparing all three candidates with existing Charon recordings.
- Adapt male-specific delivery instructions while preserving pacing, joke delivery, pronunciation
  guidance, and the mastering pipeline.
- Check clarity, warmth, punchlines, and closing-word volume. The founder chooses the winner before
  corpus generation; that choice changes only the female voice configuration.

Prepare the exact audition inputs and bounded run first. Paid synthesis requires the explicit
founder go specified in [CLAUDE.md](../../CLAUDE.md); saving this plan does not authorize it.
Corpus runs must name their region, with explicit narration-ID runs using the existing exemption.
This design adds no rider-triggered synthesis calls.

## Implementation

- **Audio storage:** Retain canonical scripts and existing male recordings. Add
  `narration_audio_variants`, keyed by narration and voice, with the source script hash, provider
  voice, audio key, duration, revision, and release status. Cover solo and fused narrations.
- **Generation:** Add a preview-first female synthesis workflow that reuses existing scripts. Once
  both voices are enabled, script regeneration prepares both recordings before committing the
  updated telling. Audio-only resynthesis updates its selected voice independently. Freshness
  follows the canonical script hash, not a male recording's resynthesis timestamp; include story,
  scenic, and fused generation paths.
- **Serving:** Add an optional `voice` field to propose/create requests and the saved-drive GET
  query, defaulting to male. Include voice identity in manifests and clips. Use the selected
  recording's actual duration; preserve saved routes, stop selections, ownership, and credit behavior.
- **Availability:** Serve only current, approved female recordings. A saved drive missing a required
  female recording returns an explicit unavailable result; it must never silently mix voices or
  lose stops. Anonymous previews retain their existing release restrictions.
- **Mobile:** Add the persisted Settings selector using existing UI primitives. Include voice in
  cache filenames, freshness comparisons, download work, and repair logic. Treat legacy downloads
  as male without deleting or downloading their bytes again.
- **Switching:** Commit a replacement download only when every required clip is present.
  Cancellation, failure, or another preference change preserves the previous playable manifest.
  Stop and invalidate existing route-preview audio on a preference change; do not rerun billed
  route planning automatically.
- **Operations:** Extend listening review, publication fingerprints, audio QA, and orphan cleanup
  to recognize variants. Update operating guidance and the admin Reference page alongside
  implementation. The current one-voice doctrine remains in force until this deferred work is
  explicitly resumed and implemented; see the earlier
  [narrator direction](../decisions/cut-joke-notch.md).

## Validation and rollout

- Test default-male compatibility with the shipped client, both voices across solo/fused subjects,
  and correct duration/revision handling.
- Verify staged audio cannot leak, stale script variants cannot play, and voice selection cannot
  bypass ownership or spend extra credits.
- Test offline upgrades, interrupted replacements, rapid preference changes, shared-cache cleanup,
  and active-drive isolation.
- Verify Settings in day/dusk themes and large text, then exercise preview and downloaded playback
  in the simulator.
- Run root and mobile `bun run check`.
- Deploy the additive backend and operator support first. Generate and review the chosen female
  voice for the existing released corpus, including subjects retained by saved drives, before
  enabling the rider selector.

**Next when resumed:** Recheck the current code and provider documentation, then prepare the
audition workflow and its reviewable run specification. Do not begin implementation or paid work
merely because this document exists.
