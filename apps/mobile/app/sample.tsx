import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Animated, Image, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { Stack, useRouter } from 'expo-router'
import type { ImageSourcePropType } from 'react-native'
import { applyExclusiveBackgroundAudio, releaseAudioSession } from '@/lib/audio-session'
import { track } from '@/lib/analytics'
import { getSample } from '@/lib/api'
import { markOnboarded } from '@/lib/client-flags'
import { cleanPlaceName } from '@/lib/labels'
import { postcardImageFor } from '@/lib/postcards'
import type { Sample } from '@skipper/shared'
import { space, radius } from '@/theme/tokens'
import { useTheme, type Theme } from '@/theme'
import {
  AttributionButton,
  Button,
  Card,
  Ridgeline,
  RouteTrack,
  Screen,
  StateView,
  Sunburst,
  Text,
  voice,
} from '@/ui'

// /sample — THE WHOLE FIRST-RUN EXPERIENCE, on one screen: the postcard a stranger can hear, and the
// one question the app needs answered ("where are we driving?"), asked once per install.
//
// The clip exists because the corpus is Tahoe-only, so a first-timer (or an Apple reviewer in
// Cupertino) can talk to the Skipper and never reach a road he has stories for. This is the way out of
// that wall: a deterministic taste that lands in the first breath.
//
// ⚠ IT WAS THREE SURFACES FOR A DAY — postcard → a full-screen "end card" → a separate
// `/region-setup` screen — and collapsing them to one was a founder call (2026-08-04: "what if we
// combined the region selection with the sample on the same screen"). The reasoning that had kept them
// apart, and why it lost:
//   • "The rider should be listening, not deciding" was the stated objection, and it over-values the
//     conflict. The picker is DEFAULTED and passive; nothing on this screen demands attention while
//     the clip runs. That minute is idle attention, not contested attention.
//   • The END CARD only ever existed to give the clip somewhere to land and a forward door. With the
//     region field and the CTA already on screen, the clip simply finishes and the rider is already
//     looking at what comes next — so a whole surface of ceremony deleted itself.
//   • The SKIP control went with it. "Skip the sample" always read as an apology; when the forward CTA
//     is permanently on screen it IS the skip, and it never has to say so.
//
// ⚠ THERE IS NO PLAYER ON THIS SCREEN ANY MORE (founder, 2026-08-05: "i wonder if we should just get
// rid of all the player controls, and just have one 'secondary' cta above the primary 'plan a drive'
// cta that says 'Hear a Sample'"). Scrubber, ±15 and the play disc are all GONE. The card is a
// poster; hearing it is a SECONDARY button above the primary exit. The diagnosis that earned it:
// a photo over a transport bar reads as a MEDIA PLAYER, so the app's first screen looked like an
// audio app for a pretty place rather than a narrated road trip — and no amount of copy above the
// picture argued that away (docs/designs/onboarding-first-screen-legibility.md).
//
// ⚠ THIS REVERSES THE QUIET-CTA MITIGATION, deliberately — `onboarding-taste-then-where.md` §8.4 said
// the forward CTA must ship `secondary` and promote only once the clip had been heard, because "a
// forward CTA and a play disc compete for 'what do I do now?'". There is no disc to compete with now,
// and that is what retires the rule rather than breaking it: with the two actions stacked and
// LABELLED, the hierarchy is stated in words instead of being fought over by weight. "Plan a drive"
// is primary from the first frame because planning genuinely IS the primary act and the sample is
// optional. The `glow` still waits for the clip, so finishing it is acknowledged without gating exit.
//
// ⚠ THE SECONDARY BUTTON TOGGLES TO A STOP LABEL, and that is a REQUIREMENT, not a nicety: this
// surface takes exclusive `doNotMix` focus (see the audio effect below), so a rider who cannot stop
// the clip has had their podcast taken hostage by the app's opening move. Never let this become a
// one-way "Hear a sample" that offers no way back.
//
// ⚠ NOTHING SIGNALS PLAYBACK EXCEPT THAT LABEL. Known and unresolved (2026-08-05): with the scrubber
// gone there is no motion, so a rider on silent or with headphones unplugged taps and sees only a word
// change. Filed in §7 of the legibility doc; do not mistake it for an oversight.
//
// ⚠ NOTHING PLAYS UNTIL THE RIDER ASKS FOR IT (founder, 2026-08-04). It autoplayed after a 450 ms
// anti-jump-scare beat, which was defensible while it sat behind a deliberate tap on home's listen row
// — the rider had already asked for audio. As the first screen of a fresh install it is not: this
// surface takes EXCLUSIVE `doNotMix` focus (see the audio effect below), so autoplaying does not merely
// make noise, it STOPS whatever a stranger was already listening to, unasked, as the app's opening
// move. On a bus or at a desk that is a wince.
//
// ⚠ HOME REDIRECTS HERE, it does not push. So `canGoBack` is false and there is no back chevron: the
// PRIMARY CTA is the ONLY exit, and it must never become a `router.back()` (that lands on a home which
// redirects straight back — a loop). It is also why the CTA may not be gated on having a region, and
// why it is never disabled: see `finish`.
//
// Deliberately NOT a simulated drive (which opens on proximity-roulette, can start silent, and ends in
// dead air) — so it is structurally incapable of showing the dev diagnostics footer sim mode carries.
//
// The clip is chosen server-side (SAMPLE_NARRATION_QID → GET /sample). If it isn't configured the
// endpoint 404s and this screen shows a reachable retry — never a white void.
//
// docs/designs/onboarding-taste-then-where.md.

// ⚠ A MODULE CONSTANT, not an inline literal, and it is the same defect step 1 of
// docs/designs/chat-render-performance.md fixed on the chat screen. `Screen` pushes `options` through
// `navigation.setOptions` from a `useLayoutEffect` keyed on that object, and react-navigation always
// spreads a new one — so a fresh literal forces a navigator-wide re-render plus a native header
// re-commit, synchronously before paint. This screen subscribes to expo-audio's status, so it
// re-renders every 500 ms while the sample clip plays.
//
// ⚠ `headerShown: false`, NOT a blank title — and the difference is 116 points of dead paper at the
// top of the app's first screen (founder, 2026-08-04: "also not really top aligned"). A blank header
// still OCCUPIES the bar: on iOS 26 it floats, so `useScreenPadding` adds its full height back as
// content padding (src/ui/screenInsets.ts) and the postcard started a third of the way down. Every
// other screen owes that inset because it has a title or a back chevron up there; this one has
// neither — home REDIRECTS here, so there is nothing to go back to and nothing to label. Removing the
// bar is what makes `edges` below need 'top': the status bar's inset now has to come from the frame.
const BLANK_HEADER = { headerShown: false } as const

/** ⚠ 'top' is NOT the shell's default, and it is load-bearing HERE ONLY because this route hides its
 *  header (above). `Screen` omits 'top' by default precisely because the navigator's bar normally owns
 *  that inset — so this is the one screen that has to claim it back, or the postcard runs under the
 *  clock and the notch. A module constant for the same reason `BLANK_HEADER` is one. */
const SCREEN_EDGES = ['top', 'left', 'right', 'bottom'] as const

/**
 * How tall the postcard picture is, as a fraction of the SCREEN — the one number that decides whether
 * this screen fits without scrolling.
 *
 * ⚠ IT REPLACED A FIXED `aspectRatio: 3/2`, which is the whole point. A ratio is a function of WIDTH,
 * so it demanded ~260pt of height on a 375pt-wide phone exactly as readily as on a 440pt one — and the
 * short phone is precisely where those points do not exist. Height is what is scarce here, so height
 * is what this is measured against.
 */
const POSTCARD_SCREEN_FRACTION = 0.28
/** Never larger than the natural 3:2 height at the widest iPhone — a bigger picture on a tall phone
 *  would just push the CTA back off the bottom, which is the thing this whole exercise fixed. */
const POSTCARD_MAX_H = 260
/** Below this it stops reading as a postcard and becomes a stripe. On a 375x667 SE the fraction lands
 *  above this, so the floor is a guard rather than the operative rule — but it is what stops a future
 *  smaller viewport (a split-screen iPad, a fold) from rendering a caption over a play button, which
 *  is what a pure flex-to-fit layout actually did when it was tried. */
const POSTCARD_MIN_H = 140

/**
 * Below this window height the screen switches to the tighter spacing step.
 *
 * ⚠ SPACING IS THE ONE THING WORTH COMPRESSING ON A SHORT PHONE, and that is a finding rather than a
 * preference (docs/research/fitting-one-screen-across-iphone-sizes.md §5–§6). Type and controls are at
 * their designed size and shrinking THEM makes every phone worse to spare one; device-scaled FONTS are
 * worse still, because they multiply with the rider's Dynamic Type setting instead of replacing it.
 * Gaps carry no accessibility contract and are the largest single consumer on a dense screen, so they
 * are where the give is.
 *
 * ⚠ A THRESHOLD, NOT A DEVICE CHECK. It asks "is this window short", which is also true of an iPad
 * slide-over and a future foldable — never "is this an iPhone SE". iOS size classes cannot answer the
 * device question anyway: every iPhone in portrait is compact-width x regular-height, so there is no
 * abstraction to lean on here (§1 of that note). 750 sits above the 667 of the smallest supported
 * phone and below the 844 of the smallest CURRENT one, so it separates the two generations rather than
 * landing mid-range.
 */
const COMPACT_SCREEN_H = 750

export default function SampleScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)
  // ⚠ `useWindowDimensions`, not a one-shot `Dimensions.get()` — it re-renders on rotation and on
  // iPad split-screen resize, where a stale first read would leave the picture sized for a viewport
  // the rider is no longer in.
  const { height: windowH, width: windowW } = useWindowDimensions()
  const postcardH = Math.min(
    POSTCARD_MAX_H,
    Math.max(POSTCARD_MIN_H, Math.round(windowH * POSTCARD_SCREEN_FRACTION)),
  )
  const compact = windowH < COMPACT_SCREEN_H

  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [sample, setSample] = useState<Sample | null>(null)
  // The clip has been heard all the way through. Drives ONLY presentation — the closing line and the
  // CTA's promotion to primary. It is deliberately not a `phase`: there is no longer a separate screen
  // to be in, and modelling it as one is what produced the end card this merge deleted.
  const [finished, setFinished] = useState(false)
  // didJustFinish can double-fire; latch the end exactly once.
  const endedRef = useRef(false)
  // `sample_played` is a SEPARATE event from the conversation's preview_clip_played on purpose: they
  // answer different questions — this one is "did the VOICE land" on a stranger, that one is "did THEIR
  // drive land". Averaging them would hide both. `startedRef` latches the start to one event per load,
  // so a pause/resume is not a second play.
  const startedRef = useRef(false)
  // Set the instant the rider STOPS, cleared when they start again. It exists only to defend the
  // end-of-clip fallback below against the stop's own pause→seek gap — see `togglePlay`.
  const manualStopRef = useRef(false)

  /** The rig's position along the trail below the card, 0..1.
   *
   *  ⚠ DECORATION THAT HAPPENS TO BE HONEST, not a control. `RouteTrack` is
   *  `accessibilityElementsHidden` and has no touch handlers, which is exactly right for art and was
   *  exactly WRONG when an earlier pass tried to make it the transport (it silently deleted the
   *  screen's only adjustable element). Nothing here is tappable; it only shows time passing.
   *  ⚠ It also closes the gap §7.2 of the legibility doc left open — with the player gone the label
   *  was the only sign the clip was running. This answers "is it playing?" without handing back a
   *  control to grab, which was the stated constraint. */
  //  ⚠ A LAZY `useState`, NOT `useRef(...).current` — that form reads `.current` during RENDER, which
  //  is `react-hooks/refs` ("Cannot access refs during render") and a NEW lint error rather than one
  //  of the baselined ones. The lazy initialiser gives the same guarantee the ref was there for: the
  //  Animated.Value is constructed once and its identity never changes, so the tween below is never
  //  re-targeted at a fresh object mid-clip.
  const [trailProgress] = useState(() => new Animated.Value(0))


  // setAudioModeAsync is process-wide (shared with the drive player). ⚠ D35 (1.1, founder): the postcard
  // is pre-drive SKIPPER audio, so it takes EXCLUSIVE focus like a drive rather than mixing under the
  // rider's music — the skipper never talks over their playlist on any surface. This read 'mixWithOthers'
  // with a comment arguing "a taste is polite" until 1.1 step 8; docs/decisions/drive-audio-exclusive-focus.md
  // was scoped to the DRIVING player and never settled this surface (it is now amended to cover all three).
  // Do not flip it back. `playsInSilentMode` so it still sounds on a muted reviewer device.
  // ⚠ `shouldPlayInBackground` stays TRUE and is deliberately NOT part of D35's flip: a one-minute taste
  // that dies mid-sentence when the phone locks is worse than one that finishes.
  useEffect(() => {
    void applyExclusiveBackgroundAudio()
    // ⚠ AND HAND IT BACK ON THE WAY OUT. This is the other half of the flip and it is not optional:
    // `doNotMix` INTERRUPTS the rider's music, and iOS resumes theirs only once the session is
    // deactivated — pausing the player is not enough. Without this, a stranger taps the postcard, we
    // pause their podcast, and it never comes back — on the app's very first impression.
    return () => {
      releaseAudioSession()
    }
  }, [])

  // Fire sample_played's START exactly once per load. Every play is deliberate now — there is no
  // autoplay to distinguish it from — so this is simply "the rider pressed play", once per clip load.
  const markStarted = useCallback(() => {
    if (startedRef.current) return
    startedRef.current = true
    track('sample_played', { completed: false })
  }, [])

  const load = useCallback(async () => {
    setPhase('loading')
    endedRef.current = false
    startedRef.current = false // the retry path re-loads the clip — that is a new play
    manualStopRef.current = false // a fresh clip has not been stopped
    // A reload is a fresh clip, so the rig starts at the trailhead. Without this a retry after a
    // completed play would draw the car parked at the END of a clip that has not run yet.
    trailProgress.stopAnimation(() => trailProgress.setValue(0))
    setFinished(false)
    try {
      const s = await getSample()
      setSample(s)
      // Pre-buffers, and deliberately does NOT play: `replace` only cues the source. The disc is the
      // rider's, and buffering ahead of it is what makes their tap feel instant rather than polite.
      player.replace({ uri: s.url })
      setPhase('ready')
    } catch {
      // A soft 404 (no sample configured) or a network blip — both are a retryable hiccup here, not a
      // persona dead-end. Show the retry surface.
      setPhase('error')
    }
    // `trailProgress` is a lazily-initialised `useState` value, so its identity never changes and
    // this stays a once-per-mount load — the dependency is honesty for the hooks lint, not a re-run.
    // (Same reasoning `loadRegions` states for `nextRotation` on home.)
  }, [player, trailProgress])

  useEffect(() => {
    void load()
  }, [load])


  const durSec =
    status.duration && status.duration > 0 ? status.duration : (sample?.durationMs ?? 0) / 1000

  // Drive the rig from the clip's real position.
  // ⚠ A 500ms TIMING, NOT `setValue`. `expo-audio` publishes status about twice a second, so writing
  // the value outright would STEP the token twice a second and lose the glide that is the whole point
  // of the motif; easing to the next sample lands just as the following one arrives.
  // ⚠ `useNativeDriver: false` is forced, not lazy — RouteTrack positions its token with percentage
  // layout, which the native driver cannot animate (its own header says so).
  useEffect(() => {
    // ⚠ THE STOPPED RIG STAYS PARKED. A stop freezes `currentTime` rather than rewinding it, so any
    // later tick would re-assert the old position and undo the snap-to-zero `togglePlay` just did.
    // Reading the REF (not state) is what makes this correct: it is written synchronously inside the
    // tap, so it is already true by the time this effect next runs. Cleared on the next play, before
    // `play()`, so real progress resumes animating immediately.
    if (manualStopRef.current) return
    const frac = durSec > 0 ? Math.max(0, Math.min(1, (status.currentTime ?? 0) / durSec)) : 0
    const anim = Animated.timing(trailProgress, {
      toValue: frac,
      duration: 500,
      useNativeDriver: false,
    })
    anim.start()
    return () => anim.stop()
  }, [status.currentTime, durSec, trailProgress])

  // Clip finished. didJustFinish is the primary signal, guarded against its double-fire. FALLBACK:
  // expo-audio can DROP didJustFinish across an OS audio interruption (useDrive defends the same way),
  // so also latch when playback has stopped at/near the very end.
  useEffect(() => {
    if (endedRef.current || phase !== 'ready') return
    // ⚠ `startedRef` gates the fallback, and it is what makes tap-to-play safe here. While this screen
    // autoplayed, "stopped at/near the end" could only mean a clip that had run; now the card can sit
    // at 0:00, not playing, indefinitely — and a clip whose duration failed to resolve would satisfy
    // `currentTime >= durSec - 0.35` at rest and promote the CTA for a rider who never pressed play.
    // ⚠ `manualStopRef` is the second guard and it is NOT redundant with `startedRef`: a rider who
    // stops inside the last 0.35s has started, is no longer playing, and is still sitting at a
    // `currentTime` that satisfies the window — indistinguishable from a finished clip until the
    // seek-to-zero lands. See `togglePlay` for why that gap exists at all.
    const atEnd =
      startedRef.current &&
      !manualStopRef.current &&
      durSec > 0 &&
      !status.playing &&
      (status.currentTime ?? 0) >= durSec - 0.35
    if (status.didJustFinish || atEnd) {
      endedRef.current = true
      setFinished(true)
      // ── sample_played: COMPLETION. It rides the screen's EXISTING end latch rather than a second
      // mechanism of its own, so the event can never disagree with what the rider is looking at.
      track('sample_played', { completed: true })
      // Hand the audio session back the moment the taste is over, not on unmount: the rider now sits
      // deciding, and under `doNotMix` their own music stays paused for as long as they do. The
      // unmount teardown above is the backstop for leaving mid-clip.
      releaseAudioSession()
    }
  }, [status.didJustFinish, status.playing, status.currentTime, durSec, phase])

  // ⚠ THE SEEK HELPERS WENT WITH THE TRANSPORT (2026-08-05). `canSeek`, `seekToMs` and `seekBy`
  // existed only for `Scrubber` and the ±15 discs; with the controls gone the clip is play/stop and
  // nothing else, so `player.seekTo` has no caller here. Bringing back any scrubbing means bringing
  // back a control, which is the decision this screen just made in the other direction.
  /** ⚠ STOP MEANS BACK TO THE TOP, NOT PAUSE (founder, 2026-08-05). The control says "Stop the
   *  sample", and with the transport gone there is no scrubber, no clock and no resume affordance —
   *  so pausing would leave a position that nothing on the screen can show or reach, and the next tap
   *  (labelled "Hear a sample") would drop a stranger into the middle of a sentence. A taste is heard
   *  from the beginning or not at all. */
  const togglePlay = () => {
    if (status.playing) {
      try {
        player.pause()
      } catch {}
      // ⚠ THE REWIND DOES NOT HAPPEN HERE, and that is a MEASURED correction, not a preference.
      // `player.pause()` followed immediately by `player.seekTo(0)` was tried and DOES NOT STICK:
      // timed on device (stop at 15s, replay, still-playing check at 55s of a 64s clip) the clip
      // resumed from 15s and ended at 49s. Rewinding on the PLAY side instead — where the seek can
      // be awaited before playback starts — is what actually resets it.
      // ⚠ HAND THE SESSION BACK on stop, same obligation the completion path has: under `doNotMix`
      // we STOPPED the rider's music, and pausing our player does not give it back.
      manualStopRef.current = true
      releaseAudioSession()
      // ⚠ PARK THE RIG AT THE START IMMEDIATELY (founder, 2026-08-05). The trail is driven off
      // `status.currentTime`, which a stop FREEZES rather than rewinds — so without this the car sat
      // mid-trail advertising a position the next tap will not resume from, which is the same
      // label-vs-behaviour lie the "Stop" wording already had to have fixed once.
      // ⚠ SNAP, NOT A GLIDE, and that is a picture rather than a performance concern: easing the
      // token back would literally show the car DRIVING BACKWARDS down the road.
      // ⚠ `stopAnimation` FIRST — a 500ms tracking tween may be mid-flight, and it would otherwise
      // finish after this and drag the rig straight back out again.
      trailProgress.stopAnimation(() => trailProgress.setValue(0))
      return
    }
    manualStopRef.current = false
    // ⚠ RE-ACTIVATE, SEEK, THEN PLAY — in that order, and every one of the three is load-bearing.
    //   • RE-ACTIVATE: `releaseAudioSession` is `setIsAudioActiveAsync(false)`, which in expo-audio's
    //     own words "will pause all audio playback and PREVENT NEW AUDIO FROM PLAYING". This screen
    //     released on completion but only ever activated on MOUNT, so once the taste finished it
    //     could never be replayed — dead until the app relaunched, on the first screen of a fresh
    //     install. Found by testing on device 2026-08-05; it predates the player being removed.
    //     `src/lib/audio-session.ts` documents this exact defect shipping once before (a silent drive
    //     after "Pull over"), which is why every `apply*` turns the subsystem on FIRST.
    //   • SEEK: every play on this screen starts at 0. There is no resume concept here at all — no
    //     scrubber, no clock — so this is the one expression that makes "Stop" mean what it says.
    //   • ORDER: chained rather than fired together, because `seekTo` is async; starting playback
    //     before it lands is precisely the bug this replaced.
    void applyExclusiveBackgroundAudio()
      .then(() => player.seekTo(0))
      .then(() => player.play())
      .catch(() => {})
    // Latched, so restarting after a stop is not counted as a second play.
    markStarted()
  }


  const finish = useCallback(() => {
    // ⚠ THE FLAG BEFORE THE NAVIGATION, never after. Home decides whether to redirect here from a lazy
    // initialiser at MOUNT, so a flag written after `router.replace('/')` races the mount that reads it
    // — and losing that race is an onboarding LOOP, not a cosmetic glitch.
    // ⚠ No region is written any more: home's own `loadRegions` picks and caches one through
    // `pickRegionId`, and having onboarding write a second copy of that answer was exactly the kind of
    // duplicated decision that drifts.
    markOnboarded()
    // `replace`, so the back gesture from home cannot walk a finished rider into onboarding again.
    router.replace('/')
  }, [router])

  if (phase === 'loading')
    return (
      <>
        <Stack.Screen options={BLANK_HEADER} />
        <StateView loading message={voice.sample.loading} />
      </>
    )
  if (phase === 'error')
    return (
      <>
        <Stack.Screen options={BLANK_HEADER} />
        <StateView
          message={voice.error.generic}
          tone="danger"
          action={{ label: voice.error.retry, onPress: () => void load() }}
        />
      </>
    )

  return (
    // ⚠ NOT `scroll`, AND NOT `center` — both deliberate, and the first one reverses an earlier choice.
    //   • TOP-ALIGNED (founder: "can you top align the postcard too"): the postcard is the hero and
    //     should meet the eye where the eye lands, not float in a vertically-centred block whose
    //     position drifts with the clip's own controls. `center` also sets `alignItems: 'center'`,
    //     which SILENTLY COLLAPSED the divider below — a `Divider` draws a hairline via
    //     `borderTopWidth` on a View with no intrinsic width, so a centring cross-axis shrank it to
    //     nothing. It rendered, measured zero, and read as a missing feature.
    //   • THE POSTCARD SIZES ITSELF TO THE DEVICE (founder: "can we make the screen resize to fit to
    //     avoid scrolling") so that on every iPhone still sold the whole flow — including the ONLY
    //     exit — is on screen at once. It was a fixed `aspectRatio: 3/2` before, which demanded ~260pt
    //     of height whether the phone had it or not: on an SE that put 846pt of content in a 667pt
    //     viewport, with the region question and the CTA below the fold.
    //   • ⚠ `scroll` STAYS, and it is NOT a leftover. A pure flex-to-fit layout was tried and rejected
    //     ON DEVICE: with everything else at its natural size there is nothing left for a picture on a
    //     375x667 SE, so the postcard shrank to ZERO and the screen became a caption over a play
    //     button. Scrolling ~100pt on the oldest small phone is a far better failure than deleting the
    //     hero on it, and scroll is also what keeps this honest at large Dynamic Type everywhere else.
    <Screen
      scroll
      padded
      edges={SCREEN_EDGES}
      contentContainerStyle={[styles.body, compact && styles.bodyCompact]}
    >
      <Stack.Screen options={BLANK_HEADER} />

      {/* THE MASTHEAD — the wordmark and the one line that says what this is (founder, 2026-08-04).
          ⚠ IT IS NOT THE LANDING PAGE HOME DELETED, and the distinction is the whole justification.
          Home's hero stack (kicker → headline → rig → tagline) was cut on 2026-08-03 because it
          "re-sold someone who had already installed and was standing there wanting to plan a drive" —
          right there, wrong here: on the FIRST screen the rider has decided nothing, and a postcard of
          a lake never says the app narrates road trips. Two lines of type, no mark, no hero.
          ⚠ Skipper has NO drawn logo — the identity is the type (`variant="wordmark"`, the display
          face) plus the app icon. Anything asking for a "logo" here means commissioning one first. */}
      <View style={styles.masthead}>
        <Text variant="wordmark" color="ink" align="center">
          SKIPPER
        </Text>
        {/* ⚠ `inkDim`, NOT `inkFaint` (founder, 2026-08-05). This is the ONLY sentence on the app's
            first screen that attempts to say what Skipper is, and it was set in the role
            `src/theme/theme.ts` documents as "tertiary hints" — the faintest the system has, and the
            one settings footnotes use. The most explanatory line on the screen was styled as the least
            important text on it.
            ⚠ `inkDim` is NOT a hand-picked step up: it is what home's own one-line subhead under its
            headline already uses (`voice.plan.openingHint`, app/index.tsx). Two lines doing the same
            job on consecutive screens now read at the same weight.
            ⚠ THE SIZE STAYS `dim` (13.5pt) ON PURPOSE, and it is now load-bearing rather than
            cautious: the rewritten `voice.tagline` sets on ONE line at 375pt at this size (verified
            on an SE), which is exactly what let the category arrive without a second line of type.
            ⚠ TWO LINES WERE TRIED HERE AND NOT TAKEN — a small-caps "NARRATED ROAD TRIPS" kicker
            between the wordmark and this line, rendered on both viewports. It fits, and it still lost:
            beside a tagline that already names the activity it says less in more space, in the
            store-listing register that got home's hero deleted. See the tagline's own note in voice.ts
            and docs/designs/onboarding-first-screen-legibility.md §2. */}
        <Text variant="dim" color="inkDim" align="center">
          {voice.tagline}
        </Text>
      </View>

      <Card style={[styles.card, compact && styles.cardCompact]}>
        {/* ⚠ ABOVE the artwork, not beside the controls. It is a header for the whole card — "this card
            is a sample you can hear" — and putting it down by the transport would have made it a second
            caption stacked under the place name, which is the arrangement the "A TASTE" badge lost on.
            ⚠ `inkDim`, deliberately NOT `accentWarm`: the screen's one amber is already spent on the
            place name below the image, and two amber lines inside one card is a card with no
            hierarchy. */}
        <PostcardImage
          image={postcardImageFor(sample?.qid)}
          colors={colors}
          imageHeight={postcardH}
          name={sample ? cleanPlaceName(sample.name) : ''}
          // ⚠ THE ⓘ LIVES ON THE ARTWORK NOW — a licence obligation finding a new home, not a
          // decoration finding a prettier one. Deleting the transport deleted the row it used to
          // ride; given its own row under the picture it floated in ~40pt of empty card and drew the
          // eye to the least important thing on screen (founder, 2026-08-05: "can you hide the 'i'
          // icon better"). Pinned to the poster's corner it reads as a photo credit, costs no height,
          // and keeps its own 48pt tap floor.
          // ⚠ `onPhoto` is REQUIRED here, not a preference: it sits on the caption scrim's opaque end,
          // where the component's default `inkFaint` is a dark glyph on a dark band — invisible, which
          // for the control that opens the CC BY-SA credit is worse than ugly.
          // ⚠ ONE EXPRESSION decides both the glyph AND the caption's reserved corner. Passing the
          // button unconditionally and letting its own empty guard hide it would inset the place
          // name to dodge an icon that was never drawn — two copies of "is there a credit?" drifting
          // apart, which is the bug class this repo keeps paying for.
          credit={
            sample?.attribution?.length ? (
              <AttributionButton items={sample.attribution} color="onPhoto" />
            ) : undefined
          }
        />
        {/* ⚠ NO "A TASTE" BADGE HERE ANY MORE (founder, 2026-08-04). Its stated job was to be honest
            that "this is a sample, not a live drive" — which was true copy on the OLD `/sample`,
            reached from a row on home by a rider who already knew what a drive was. On the first
            screen of a fresh install it disambiguates against a concept the rider has never met, and
            the rest of the screen already says the clip is not the product: the tagline ("you drive,
            I'll tell you what you're passing"), the button that offers the sample BY NAME, and the
            primary CTA beneath it ("Plan a drive"). A fourth signal cost ~28pt on the screen where
            vertical space is the whole fight. It also took the app's only teal Badge with it — a real
            palette loss, and the cheapest thing here to put back if the screen reads flat without it.
            ⚠ Its "three other things" list named the 2026-08-04 strings, all three of which have since
            been rewritten; updated rather than left, because a tombstone that quotes dead copy reads
            as though the screen still says it. */}
      </Card>

      {/* ⚠ THE REGION QUESTION WAS HERE AND IS GONE (founder, 2026-08-04: "remove the region select
          from the onboarding screen and just default all new users to lake tahoe for now"). It was a
          heading, a picker chip and a divider; onboarding now asks a stranger for NOTHING, which is
          the lightest this flow can be — hear him, then go.
          ⚠ NOTHING IS HARDCODED TO TAHOE, and that is the honest reading of "default to lake tahoe":
          home already lands every rider on a region through `pickRegionId` (src/lib/region-select.ts),
          and with one region live that IS Lake Tahoe. Baking the slug into the client would be a fact
          in the app that the server owns, and it would go stale the day the region list changes.
          ⚠ The rider is now NEVER asked, on any install — see TODO #73, which was already tracking the
          narrower version of this for riders who onboarded before region 2. Home's chip is the only
          place the question is asked at all, which is why it is being made more prominent there. */}
      {/* THE TRAIL — the app's own dashed atlas trail with the skipper's rig on it, filling the space
          the bottom-pinned CTAs opened up (founder, 2026-08-05: "showcasing the drive routing,
          breadcrumbs, trail with an illustration… also maybe it makes sense to align the 2 CTAs to
          the bottom"). The two ideas solve each other: pinning the buttons CREATES this gap, and the
          trail is what stops it reading as dead paper.
          ⚠ ILLUSTRATION, NOT CARTOGRAPHY. `GET /sample` carries NO geography on purpose ("no
          geography, because there is no map here, just the clip" — packages/shared) and the `Region`
          DTO deliberately withholds coordinates, so nothing here may ever sprout real place names or
          claim to be a real route. It is a motif that says "a drive", and that is all it may say.
          ⚠ FLEXES, so it is the give on a short phone: the gap shrinks to `minHeight` on an SE while
          the poster and both buttons keep their size — spacing is the one thing worth compressing
          (docs/research/fitting-one-screen-across-iphone-sizes.md). */}
      <View style={styles.trailSlot} pointerEvents="none">
        {/* ⚠ THE RIDGE IS NOT OPTIONAL DRESSING — it is what makes this a SCENE. The trail alone was
            built first and looked worse than the empty space it filled: a hairline marooned in a tall
            void, reading as a stray progress bar at 0% rather than as illustration. A horizon behind
            it turns the same line into a road running along the foot of the hills, which is the WPA
            poster idiom the whole app is drawn in — and it is the motif home already uses at its top,
            so the two screens now rhyme. */}
        <View style={styles.trailGroup}>
          {/* ⚠ BLEEDS PAST THE GUTTER, and only the ridge does. `Ridgeline`'s own header is explicit
              that a horizon "runs off both sides instead of being cut off by them" — inset to the
              screen's padding it reads as a chart line with two ends rather than as scenery. The ROAD
              deliberately does not bleed: its rig starts at the line's left edge, and pushed to the
              screen edge the token would sit half off-screen looking clipped rather than parked. */}
          <View style={styles.ridgeBleed}>
            <Ridgeline width={windowW} height={56} opacity={0.5} />
          </View>
          <RouteTrack progress={trailProgress} glow={status.playing} />
        </View>
      </View>

      <View style={styles.ctaStack}>
        {/* ⚠ A TOGGLE, NEVER A STANDING OFFER — the stop half is a requirement. This surface takes
            exclusive `doNotMix` focus, so a rider who cannot stop the clip has had their podcast
            taken hostage by the app's opening move. The label is also the ONLY playback feedback the
            screen has now (see the header's ⚠ on that), which is a second reason it must change. */}
        <Button
          title={status.playing ? voice.sample.stopCta : voice.sample.hearCta}
          variant="secondary"
          onPress={togglePlay}
        />
        {/* ⚠ PRIMARY FROM THE FIRST FRAME, which retires onboarding-taste-then-where §8.4's
            quiet-until-heard rule. That rule existed because "a forward CTA and a play disc compete
            for 'what do I do now?'" — there is no disc to compete with any more, so the hierarchy is
            stated in labels instead of fought over by weight. `glow` still waits for the clip, so
            finishing it is acknowledged without ever gating the only exit. */}
        <Button title={voice.region.setupCta} variant="primary" glow={finished} onPress={finish} />
      </View>
    </Screen>
  )
}

// The inset artwork — the WPA poster of the place, matted inside the player card like a print rather
// than bled to its edges. Until the curated art for this clip's QID exists (see @/lib/postcards) it
// renders a calm sunburst placeholder, so it is an intentional blank, never a broken image.
//
// ⚠ IT WAS A STANDALONE "POSTCARD FRAME" — its own raised matte, an amber caption reading "POSTCARD
// FROM LAKE TAHOE", and a dashed franking stamp — and the founder folded it into the player card
// (2026-08-04). What that bought: one object instead of two stacked placards, one set of padding
// instead of two, and a Tahoe mention removed that the region chip twelve points below was already
// making. The metaphor survives in the MATTE — an image inset in paper with a caption under it is a
// print; bleeding it to the card's edges is what would have made this a generic media header.
function PostcardImage({
  image,
  colors,
  imageHeight,
  name,
  credit,
}: {
  image: ImageSourcePropType | undefined
  colors: Theme['colors']
  /** Device-derived — see POSTCARD_SCREEN_FRACTION. */
  imageHeight: number
  name: string
  /** The ⓘ, pinned into the artwork's own scrim like a photo credit.
   *  ⚠ THE KICKER PROP WAS DELETED HERE (2026-08-05). It printed a small-caps line above the place
   *  name ('HEAR A SAMPLE'), and the button below the card now makes that offer BY NAME — a kicker
   *  saying the same thing on the artwork is the label twice, on the one screen where every point of
   *  height was fought for.
   *  ⚠ UNDEFINED IS A REAL STATE and it drives LAYOUT, not just the glyph: when there is no credit
   *  the caption reclaims the corner (see `postcardCaptionInset`). That is why the caller decides
   *  rather than leaning on AttributionButton's own empty guard — the inset and the icon have to be
   *  the same fact, or the name is narrowed to dodge an icon that was never drawn. */
  credit?: ReactNode
}) {
  return (
    <View style={[styles.postcardImage, { height: imageHeight, backgroundColor: colors.surfaceSunken }]}>
      {image ? (
        <Image source={image} style={styles.postcardFill} resizeMode="cover" accessibilityIgnoresInvertColors />
      ) : (
        <View style={styles.postcardPlaceholder} pointerEvents="none">
          <Sunburst size={132} opacity={0.16} />
        </View>
      )}
      {/* ⚠ THE SCRIM IS NOT DECORATION — it is the only thing making the type below legible, and it
          must not be "cleaned up" into a flat tint. The artwork is a different picture per QID
          (@/lib/postcards) and a caption laid straight onto an unknown image is a coin flip: this one
          has dark trees at the bottom, the next may have bright water. A gradient that reaches an
          OPAQUE dark at the baseline guarantees the contrast the theme's own test asserts
          (`onPhoto` on `photoScrim`), whatever is underneath.
          ⚠ It fades from the TOP of the band so the picture is untouched above it — the reference
          postcards all keep the scene clear and put the type in the last third. */}
      <View
        style={[
          styles.postcardCaption,
          // ⚠ RESERVE THE CORNER. The ⓘ is absolutely positioned OVER this full-width block, so
          // without this a long second line runs straight under the glyph. "Emerald Bay State Park"
          // happens to break short enough to miss it, which is exactly the kind of accident that
          // ships. Padded on BOTH sides so the centring stays true.
          credit ? styles.postcardCaptionInset : null,
          {
            experimental_backgroundImage: `linear-gradient(180deg, ${colors.photoScrimFade} 0%, ${colors.photoScrim} 78%)`,
          },
        ]}
        pointerEvents="none"
      >
        {/* ⚠ `display`, the heavy slab — the whole reason to move this onto the artwork. Below the
            image it had to stay small so it would not fight the picture; ON the picture, at poster
            weight, it IS the picture's title. Two lines max: a long place name at AX sizes must not
            eat the scene it is captioning. */}
        <Text variant="display" color="onPhoto" align="center" numberOfLines={2}>
          {name}
        </Text>
      </View>
      {/* ⚠ OUTSIDE the caption block, so it is not laid out in that column and cannot push the name
          around; it is pinned to the artwork's corner instead. It sits on the scrim's opaque end,
          which is exactly why it can be a light glyph at all. */}
      {credit ? (
        <View style={styles.creditCorner} pointerEvents="box-none">
          {credit}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  // ⚠ `flexGrow: 1` IS WHAT PINS THE CTAS TO THE BOTTOM, and it only works because this is a
  // ScrollView's CONTENT container: it lets the content stretch to fill a tall screen (so
  // `trailSlot`'s flex has something to claim) while still scrolling when the content is taller than
  // the viewport — which is the property the whole screen was built around and must not lose.
  body: { gap: space.lg, flexGrow: 1 },
  // ⚠ ONE STEP DOWN THE EXISTING SCALE, never a hand-picked number — `lg`→`md` and `md`→`sm` keep the
  // screen inside the design system's rhythm on a short phone instead of inventing a second one.
  bodyCompact: { gap: space.md },
  masthead: { gap: space.xs, width: '100%' },
  // ⚠ `md`, not `lg`. This column holds the title, the scrubber and the transport — three things that
  // read as ONE control surface, so the roomier `lg` step was spacing them like separate sections and
  // spending ~16pt to do it. `lg` still separates the postcard, the question and the CTA in `body`.
  card: { gap: space.md, width: '100%' },
  // ⚠ PADDING TOO, not just the gap — `Card` sets `space.lg` on all four sides, and the placard's
  // elevation would otherwise cost a short phone 32pt of pure inset on top of the gaps it just saved.
  // `style` is applied after the primitive's own base, so this override lands.
  cardCompact: { gap: space.sm, padding: space.md },
  // The ⓘ, pinned to the poster's bottom-right on the scrim's opaque end.
  creditCorner: { position: 'absolute', right: space.sm, bottom: space.sm },
  // ⚠ `xxxl` (32) clears the ⓘ's footprint: the `right: sm` inset (8) plus an 18pt glyph = 26, plus
  // a little air. DERIVED from `creditCorner` above, not picked by eye — if that inset changes, this
  // is the other half of the same measurement.
  postcardCaptionInset: { paddingHorizontal: space.xxxl },
  // ⚠ `sm`, not the body's `lg`: the two buttons are ONE decision surface (hear it, or go), so they
  // group rather than reading as two separate sections of the screen.
  ctaStack: { gap: space.sm, width: '100%' },
  // The trail's slot. ⚠ `flex: 1` claims whatever is left between the poster and the buttons, which
  // is what pushes the CTAs down; `minHeight` is the floor so the motif never renders as a sliver on
  // a short phone. `justifyContent: 'center'` keeps the trail off both neighbours as the gap grows.
  // ⚠ `flex-end`, NOT `center`. Centred, the scene floated with a void both above and below it and
  // read as marooned; anchored to the bottom of the gap it becomes the GROUND the two buttons stand
  // on, and the leftover space collects into one block under the poster instead of two.
  trailSlot: { flex: 1, minHeight: 44, justifyContent: 'flex-end', width: '100%' },
  // Ridge and road read as ONE object, so they sit flush — a gap between them would separate the
  // horizon from the road running along it and put us back to two stray elements.
  trailGroup: { width: '100%' },
  // ⚠ NEGATIVE GUTTER, mirrored, so the horizon reaches both screen edges — `Screen padded` insets
  // this column by exactly `space.gutter`, and this gives it back. Derived from that token, never a
  // hand-picked number: change the gutter and this follows.
  ridgeBleed: { marginHorizontal: -space.gutter },
  // ⚠ `transportRow` / `transportSlot` / `transportFill` WERE DELETED HERE (2026-08-05) with the
  // transport itself. They centred the play disc between an ⓘ slot and a matching empty one; there
  // is no disc to centre now. See the header for why the whole player left.
  // The postcard matte: a raised card holding the image, with the caption printed on its lower margin.
  postcardImage: {
    width: '100%',
    // ⚠ NO `aspectRatio` AND NO `flex` — the height arrives as a prop, computed from the screen (see
    // POSTCARD_SCREEN_FRACTION). Both alternatives were built and rejected ON DEVICE: the fixed 3:2
    // ratio overflowed short phones, and flexing it to the leftover space shrank it to ZERO on an SE,
    // because once the masthead, title, transport, question and CTA are all at natural size there is
    // genuinely nothing left. `resizeMode="cover"` crops rather than distorting as it gets shorter.
    borderRadius: radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  postcardFill: { width: '100%', height: '100%' },
  // Pinned to the image's lower edge; height comes from the type inside it, so a two-line name grows
  // the band rather than clipping. `paddingTop` is the fade's runway — without it the gradient starts
  // at the kicker and the first line sits on a half-dark wash.
  postcardCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: space.xxxl,
    paddingBottom: space.md,
    paddingHorizontal: space.md,
    gap: space.xs,
  },
  postcardPlaceholder: { alignItems: 'center', justifyContent: 'center' },
})
