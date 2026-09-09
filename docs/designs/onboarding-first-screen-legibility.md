# Onboarding — the first screen is pretty but does not say what this is

**Status:** HISTORICAL — the onboarding screen and sample were deleted 2026-08-05.
Condensed 2026-09-09 to retain the decision and reusable lessons; this is not a proposal to
restore the screen. See [onboarding-gate-reconsidered.md](onboarding-gate-reconsidered.md).

## What changed and why

The original screen showed a name, a pretty place, and an audio transport without explaining that
Skipper narrates what you pass while driving. “Start exploring” promised browsing but opened a
conversation. Home taught the product better than the gate in front of it.

The first fixes renamed the CTA to “Plan a drive” and promoted the explanatory text from `inkFaint`
to `inkDim`. A separate “NARRATED ROAD TRIPS” descriptor was tried on large and small phones and
rejected as redundant. The tagline instead became “You drive, I'll tell you what you're passing.”
Naming the activity also made the pictured place read as an example, rather than the whole product.

The founder then removed the scrubber and transport controls: a photograph above a transport bar
still looked like a media player, however good the copy. A sun, ridge, and animated road supplied
playback feedback without offering another control. The gate itself was subsequently deleted.
The full alternatives and build diary remain in git history at this path.

## Lessons that survive the screen

- **Audit what a stranger can infer.** Visual polish can conceal a missing explanation. Essential
  explanatory text needs an appropriate contrast role, and a CTA should name what happens next.
  A “sample” needs enough context to say what it is a sample of.
- **Recheck a tradeoff when its supporting cues disappear.** The rationale for removing the category
  descriptor depended partly on an “A TASTE” badge that was also removed. The two edits invalidated
  the combined argument even though each had its own explanation.
- **A control and decoration have different accessibility duties.** `RouteTrack` was tried as a
  scrubber replacement and silently removed the screen's only adjustable accessibility element,
  because it was hidden from assistive technology. The same component worked as noninteractive art.
  Better-looking feedback is not a replacement for an accessible control.
- **Do not surprise a new rider with exclusive audio.** No autoplay was deliberate: taking exclusive
  focus would interrupt the rider's other audio on the app's opening screen. See
  [drive-audio-exclusive-focus.md](../decisions/drive-audio-exclusive-focus.md).
- **Animation must agree with the action.** Stopping snapped the illustrated car to the start;
  easing it back looked like driving backwards. The position effect also had to stop tracking the
  paused timestamp or it would move the car forward again.
- **Illustration must not claim geography it lacks.** The sample had no route geometry. Its road
  motif could show progress but could not honestly carry real place names or a mapped route.

## The two audio defects (formerly §7.3)

Both were fixed on 2026-08-05, before the screen was removed. Their value is the failure pattern
and the verification method, not the deleted screen's implementation.

1. **Replay after completion was silent.** The screen activated audio only on mount, then released
   the session when the clip ended. A later play never reactivated it. Reactivating on every play
   fixed the defect; the same class had already appeared after ending a drive. The surviving
   session owner is [audio-session.ts](../../apps/mobile/src/lib/audio-session.ts).
2. **“Stop” resumed instead of restarting.** Pausing and seeking on the stop path did not reliably
   reset playback in the observed native sequence. Stopping around 15 seconds into a 64-second
   clip and timing the replay exposed it: playback ended after about 49 seconds. The fix awaited
   activation and `seekTo(0)` on the next play path, then played. That screen had no resume concept.

A screenshot cannot distinguish restarting from resuming, and the native behavior escaped the unit
suite and typecheck. Verify completion → replay and stop → replay by playing the audio and timing it.
Do not apply a restart-on-play rule to surfaces that intentionally support pause/resume.

## Small-screen and verification lessons (formerly §§7.2 and 8)

The design was rendered at 375×667 as well as on a tall phone. A decorative sun in normal flow
pushed both CTAs below the small screen; an absolute layer clipped to the available gap avoided
spending layout height. Clipping belonged on that layer, not the road's parent, because the ridge
intentionally extended beyond the gutter. A previous flex-to-fit attempt had shrunk the postcard to
zero. Empty space on a tall phone did not establish a safe space budget on the small one.

One attempted positioning fix spread `StyleSheet.absoluteFillObject`, which was absent from the
installed typing in that build. Spreading `undefined` left no positioning at runtime and looked
like a stale bundle. Typechecking caught it immediately. When a visual fix changes nothing, check
its types and computed layout before blaming the bundler.

Use the current [mobile design system](../../apps/mobile/DESIGN.md) and
[device support decision](../decisions/device-support-matrix.md) for implementation guidance.
