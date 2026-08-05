import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native'
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
  Scrubber,
  Screen,
  StateView,
  Sunburst,
  Text,
  TransportBar,
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
// ⚠ THE ONE REAL COST OF MERGING, and the thing not to undo: a forward CTA and a play disc compete for
// "what do I do now?", and a rider who taps past without pressing play defeats the entire purpose of
// the screen. So the CTA ships QUIET (`secondary`) and promotes to the glowing primary once the clip
// has been heard — see `finished` below. The disc is unmistakably the loudest thing on arrival; the
// exit is always reachable and never shouts. Do not "tidy" that into one constant variant.
//
// ⚠ NOTHING PLAYS UNTIL THE RIDER TOUCHES THE DISC (founder, 2026-08-04). It autoplayed after a 450 ms
// anti-jump-scare beat, which was defensible while it sat behind a deliberate tap on home's listen row
// — the rider had already asked for audio. As the first screen of a fresh install it is not: this
// surface takes EXCLUSIVE `doNotMix` focus (see the audio effect below), so autoplaying does not merely
// make noise, it STOPS whatever a stranger was already listening to, unasked, as the app's opening
// move. On a bus or at a desk that is a wince.
//
// ⚠ HOME REDIRECTS HERE, it does not push. So `canGoBack` is false and there is no back chevron: the
// CTA is the ONLY exit, and it must never become a `router.back()` (that lands on a home which
// redirects straight back — a loop). It is also why the CTA may not be gated on having a region:
// see `finish`.
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
  const { height: windowH } = useWindowDimensions()
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
  }, [player])

  useEffect(() => {
    void load()
  }, [load])


  const durSec =
    status.duration && status.duration > 0 ? status.duration : (sample?.durationMs ?? 0) / 1000

  // Clip finished. didJustFinish is the primary signal, guarded against its double-fire. FALLBACK:
  // expo-audio can DROP didJustFinish across an OS audio interruption (useDrive defends the same way),
  // so also latch when playback has stopped at/near the very end.
  useEffect(() => {
    if (endedRef.current || phase !== 'ready') return
    // ⚠ `startedRef` gates the fallback, and it is what makes tap-to-play safe here. While this screen
    // autoplayed, "stopped at/near the end" could only mean a clip that had run; now the card can sit
    // at 0:00, not playing, indefinitely — and a clip whose duration failed to resolve would satisfy
    // `currentTime >= durSec - 0.35` at rest and promote the CTA for a rider who never pressed play.
    const atEnd =
      startedRef.current && durSec > 0 && !status.playing && (status.currentTime ?? 0) >= durSec - 0.35
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

  const canSeek = !!status.isLoaded && durSec > 0
  const seekToMs = (ms: number) => {
    try {
      player.seekTo(Math.max(0, Math.min(ms / 1000, durSec)))
    } catch {}
  }
  const seekBy = (sec: number) => seekToMs(((status.currentTime ?? 0) + sec) * 1000)
  const togglePlay = () => {
    try {
      if (status.playing) {
        player.pause()
      } else {
        player.play()
        // Latched, so a resume after a pause is not counted as a second play.
        markStarted()
      }
    } catch {}
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
            ⚠ THE SIZE STAYS `dim` (13.5pt) ON PURPOSE. The tagline that named the category wrapped to
            two lines at 375pt, which is part of why the descriptor was cut — and restoring it is still
            open (docs/designs/onboarding-first-screen-legibility.md §2). Growing the type now would
            spend the line budget that change needs.
            ⚠ AND THE DESCRIPTOR IS STILL MISSING. This makes the line legible; it does not make it say
            "narrated road trips". §2 of that doc is the open half of this fix — do not read a promoted
            colour role as having closed it. */}
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
          kicker={voice.sample.kicker}
          name={sample ? cleanPlaceName(sample.name) : ''}
        />
        {/* ⚠ NO "A TASTE" BADGE HERE ANY MORE (founder, 2026-08-04). Its stated job was to be honest
            that "this is a sample, not a live drive" — which was true copy on the OLD `/sample`,
            reached from a row on home by a rider who already knew what a drive was. On the first
            screen of a fresh install it disambiguates against a concept the rider has never met, and
            three other things on the same screen already say the clip is not the product: the tagline
            ("you pick the road"), the section heading ("where are we driving?") and the CTA ("start
            exploring"). A fourth signal cost ~28pt on the screen where vertical space is the whole
            fight. It also took the app's only teal Badge with it — a real palette loss, and the
            cheapest thing here to put back if the screen reads flat without it. */}

        <Scrubber
          positionMs={(status.currentTime ?? 0) * 1000}
          durationMs={durSec * 1000}
          onSeek={seekToMs}
          disabled={!canSeek}
        />
        {/* ⚠ THE ⓘ RIDES THE TRANSPORT ROW rather than owning a row of its own (founder, 2026-08-04:
            "that info icon also wastes a lot of vertical space"). It was a full-width Pressable on its
            own line — ~43pt of height, gap included, for an 18pt glyph — on the one screen where
            vertical space decides whether the CTA is visible without scrolling. The transport is three
            discs centred in a wide row, so the space beside them was already empty.
            ⚠ THE EMPTY SLOT ON THE RIGHT IS LOAD-BEARING, not filler: `TransportBar` centres its discs
            within whatever width it is given, so without a matching slot the row would be 48pt wider
            on the left and the play disc would sit visibly off-centre from everything above it.
            ⚠ The ⓘ keeps its own 48pt tap floor (its `hitSlop` — see AttributionButton, where the
            reasoning is a licence obligation rather than a preference); the slot only reserves the
            space, it does not shrink the target. */}
        <View style={styles.transportRow}>
          <View style={styles.transportSlot}>
            <AttributionButton items={sample?.attribution} />
          </View>
          <TransportBar
            style={styles.transportFill}
            playing={status.playing}
            onPlayPause={togglePlay}
            // ⚠ BOTH, never one — see `pauseLabel` on TransportBar. The defaults are drive copy, and
            // on this screen the disc starts a one-minute postcard, not a drive.
            playLabel={voice.sample.playA11y}
            pauseLabel={voice.sample.pauseA11y}
            canSeek={canSeek}
            onSeekBack={() => seekBy(-15)}
            onSeekForward={() => seekBy(15)}
          />
          <View style={styles.transportSlot} />
        </View>
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
      <Button
        title={voice.region.setupCta}
        variant={finished ? 'primary' : 'secondary'}
        glow={finished}
        onPress={finish}
      />
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
  kicker,
  name,
}: {
  image: ImageSourcePropType | undefined
  colors: Theme['colors']
  /** Device-derived — see POSTCARD_SCREEN_FRACTION. */
  imageHeight: number
  kicker: string
  name: string
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
          {
            experimental_backgroundImage: `linear-gradient(180deg, ${colors.photoScrimFade} 0%, ${colors.photoScrim} 78%)`,
          },
        ]}
        pointerEvents="none"
      >
        <Text variant="label" color="onPhoto" align="center">
          {kicker}
        </Text>
        {/* ⚠ `display`, the heavy slab — the whole reason to move this onto the artwork. Below the
            image it had to stay small so it would not fight the picture; ON the picture, at poster
            weight, it IS the picture's title. Two lines max: a long place name at AX sizes must not
            eat the scene it is captioning. */}
        <Text variant="display" color="onPhoto" align="center" numberOfLines={2}>
          {name}
        </Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
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
  transportRow: { flexDirection: 'row', alignItems: 'center' },
  // Matches the ⓘ's own 48pt tap floor, and is mirrored empty on the right — see the call site.
  transportSlot: { width: 48 },
  transportFill: { flex: 1 },
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
