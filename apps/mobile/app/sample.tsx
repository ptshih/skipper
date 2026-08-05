import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, StyleSheet, useWindowDimensions, View } from 'react-native'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { Stack, useRouter } from 'expo-router'
import type { ImageSourcePropType } from 'react-native'
import { applyExclusiveBackgroundAudio, releaseAudioSession } from '@/lib/audio-session'
import { track } from '@/lib/analytics'
import { getSample, listRegions } from '@/lib/api'
import { markOnboarded } from '@/lib/client-flags'
import { cleanPlaceName } from '@/lib/labels'
import { postcardImageFor } from '@/lib/postcards'
import { readCachedRegion, writeCachedRegion } from '@/lib/region-cache'
import { pickRegionId } from '@/lib/region-select'
import type { Region, Sample } from '@skipper/shared'
import { space, radius } from '@/theme/tokens'
import { useTheme, type Theme } from '@/theme'
import {
  AttributionButton,
  Badge,
  Button,
  Divider,
  RegionChip,
  Scrubber,
  Screen,
  StateView,
  Sunburst,
  Text,
  TransportBar,
  useRegionPicker,
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

export default function SampleScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)
  const pickRegion = useRegionPicker()
  // ⚠ `useWindowDimensions`, not a one-shot `Dimensions.get()` — it re-renders on rotation and on
  // iPad split-screen resize, where a stale first read would leave the picture sized for a viewport
  // the rider is no longer in.
  const { height: windowH } = useWindowDimensions()
  const postcardH = Math.min(
    POSTCARD_MAX_H,
    Math.max(POSTCARD_MIN_H, Math.round(windowH * POSTCARD_SCREEN_FRACTION)),
  )

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

  const [regions, setRegions] = useState<Region[] | null>(null)
  const [regionId, setRegionId] = useState<string | null>(null)

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

  // ⚠ THE REGIONS LOAD IS ITS OWN EFFECT AND MUST NOT BE FOLDED INTO `load` ABOVE. A failed or slow
  // `/regions` may not cost the rider the CLIP, and a failed clip may not cost them the region
  // question — they are independent answers to independent questions, and this screen has to be able
  // to show either one without the other.
  // ⚠ `.then(…)` rather than `async/await`: `react-hooks/set-state-in-effect` follows the call, and an
  // async version reads as setting state synchronously in an effect even with an await in front of it.
  // Every setState here lives in a promise CALLBACK, which is the shape the rule names as correct.
  const loadRegions = useCallback(() => {
    listRegions().then(
      (rs) => {
        setRegions(rs)
        // ⚠ SEEDED THROUGH `pickRegionId`, NOT `rs[0]`, so this screen and home can never disagree
        // about what "the current region" means. It honours a cached choice too, which is not dead
        // code: a rider reinstalling over a restored backup arrives with a region already remembered.
        setRegionId(pickRegionId(rs, readCachedRegion()?.regionId))
      },
      () => setRegions([]),
    )
  }, [])

  useEffect(() => {
    loadRegions()
  }, [loadRegions])

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

  const region = regions?.find((r) => r.id === regionId) ?? null
  const hasRegions = (regions?.length ?? 0) > 0

  const openPicker = useCallback(() => {
    pickRegion({ regions: regions ?? [], selectedId: regionId, onSelect: setRegionId })
  }, [pickRegion, regions, regionId])

  const finish = useCallback(() => {
    // Persist the CHOICE before the flag, and the flag before navigating. Home re-reads both at mount:
    // it seeds its region from `readCachedRegion()` and decides whether to redirect from
    // `shouldShowOnboarding()`, so writing either after `replace('/')` races the mount that reads it —
    // and losing the flag race is an onboarding loop, not a cosmetic glitch.
    if (region) {
      // Names only, for the degraded/offline cards — `region-cache.ts`'s header owns what may live
      // here. `rotation` is deliberately unset, so home's cold open starts at window 0.
      writeCachedRegion({
        regionId: region.id,
        displayName: region.displayName,
        exampleAnchors: region.exampleAnchors,
      })
    }
    // ⚠ MARKED EVEN WITH NO REGION, and the CTA is never disabled for the lack of one. `/regions` can
    // fail on a first launch, and trapping a new install behind a dead button would be a far worse
    // outcome than the one it prevents: home survives having no region (it retries the same load and
    // shows the in-persona outage card), so the honest move is to let them through. The network
    // failed, not the flow.
    markOnboarded()
    // `replace`, so the back gesture from home cannot walk a finished rider into onboarding again.
    router.replace('/')
  }, [region, router])

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
    <Screen scroll padded edges={SCREEN_EDGES} contentContainerStyle={styles.body}>
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
        <Text variant="dim" color="inkFaint" align="center">
          {voice.tagline}
        </Text>
      </View>

      <PostcardFrame
        image={postcardImageFor(sample?.qid)}
        caption={voice.sample.kicker}
        colors={colors}
        imageHeight={postcardH}
      />

      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Text variant="display" color="ink" align="center" numberOfLines={2}>
            {sample ? cleanPlaceName(sample.name) : ''}
          </Text>
          {/* ⚠ A ROW WITH `justifyContent`, not the parent's `alignItems: 'center'`. `Badge` sets
              `alignSelf: 'flex-start'` on its own pill — correct there, since it stops the pill
              stretching full-width in the COLUMN containers it usually lands in — and a child's
              `alignSelf` always beats its parent's `alignItems`, so only the main axis can centre it.
              Do not "fix" this by editing Badge: every other caller depends on that flex-start. */}
          <View style={styles.badgeRow}>
            <Badge tone="teal" label={voice.sample.badge} />
          </View>
        </View>

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
      </View>

      {/* ── The question. Everything above is the taste; everything below is the one answer the app
          needs. The rule separates them without a second screen. ── */}
      <Divider />

      <View style={styles.field}>
        {/* ⚠ THE QUESTION IS THE LABEL, and that is what survived the merge. A dry "REGION" caption
            would have been the honest cost of collapsing the two screens; asking it keeps the framing
            the standalone screen did for free — the rider is answering the skipper, not filling in a
            form field. */}
        <Text variant="heading" color="ink" align="center">
          {voice.region.setupTitle}
        </Text>
        {/* ⚠ `onPress` is passed WHENEVER A LIST EXISTS, never gated on "is there more than one" —
            RegionChip's own header is a monument to that bug. With a list of one the sheet is a
            one-row answer to "which roads?", which is a real answer. */}
        {/* ⚠ THE SAME ROW WRAPPER THE BADGE NEEDS, and for the identical reason — `RegionChip`'s own
            row carries `alignSelf: 'flex-start'`, which beats any `alignItems` its parent sets, so a
            column could never centre it (measured: chip centre 147 against 220 for everything else on
            the screen). Only the MAIN axis can, hence a row with `justifyContent`. Third instance of
            this trap on this screen; if a fourth appears, it wants a shared `<Center>` primitive. */}
        <View style={styles.centerRow}>
          <RegionChip regionName={region?.displayName ?? null} onPress={hasRegions ? openPicker : undefined} />
        </View>
        {/* ⚠ NO COVERAGE CAPTION HERE, and it was built and cut (founder, 2026-08-04: "maybe we can
            drop the 'I know…' tagline at the bottom"). It read "I know every turn on these. More are
            coming." and its argument — say the LIMIT out loud, because a newcomer who learns it here is
            forgiving where the same fact discovered mid-plan reads as a dead end — is still sound. It
            was not refuted, it was RELOCATED: the picker one tap away is titled "Roads I know" and
            lists exactly what exists, which answers the same question more honestly than a sentence
            promising it. The ~40pt it cost now pays for the masthead above. */}
      </View>

      {/* ⚠ NO CLOSING LINE HERE, and it was built and cut (founder, 2026-08-04: "maybe get rid of the
          'that's the taste'"). "That's the taste, friend." was the last surviving fragment of the
          deleted end card, and on a merged screen it earned nothing: the CTA lighting up already says
          he has finished, so the sentence restated it in words AND grew the layout by ~39pt at exactly
          the moment the primary action appears — which pushed the button flush against the home
          indicator. A line that says what the screen has already shown is not charm, it is a caption. */}
      {/* ⚠ QUIET UNTIL HEARD — see the header. `secondary` on arrival so the play disc owns the
          screen's one obvious action; primary + glow once the clip has landed, which is also the
          screen's way of saying it is finished with the rider. Never disabled: this is the only exit. */}
      <Button
        title={voice.region.setupCta}
        variant={finished ? 'primary' : 'secondary'}
        glow={finished}
        onPress={finish}
      />
    </Screen>
  )
}

// The framed "postcard": a landscape image (the WPA poster of the place) matted like a real postcard,
// with a little stamp in the corner, and the region caption printed on the bottom matte. Until the
// curated art for this clip's QID exists (see @/lib/postcards), it renders a calm sunburst placeholder
// so it reads as an intentional postcard, never a broken image.
function PostcardFrame({
  image,
  caption,
  colors,
  imageHeight,
}: {
  image: ImageSourcePropType | undefined
  caption: string
  colors: Theme['colors']
  /** Device-derived — see POSTCARD_SCREEN_FRACTION. Passed in rather than read here so the ONE
   *  arithmetic lives beside the layout it is protecting. */
  imageHeight: number
}) {
  return (
    <View
      style={[
        styles.postcard,
        {
          backgroundColor: colors.surfaceRaised,
          borderColor: colors.rule,
          boxShadow: [{ offsetX: 0, offsetY: 8, blurRadius: 22, color: colors.shadowCast }],
        },
      ]}
    >
      <View style={[styles.postcardImage, { height: imageHeight, backgroundColor: colors.surfaceSunken }]}>
        {image ? (
          <Image source={image} style={styles.postcardFill} resizeMode="cover" accessibilityIgnoresInvertColors />
        ) : (
          <View style={styles.postcardPlaceholder} pointerEvents="none">
            <Sunburst size={132} opacity={0.16} />
          </View>
        )}
      </View>
      <Text variant="label" color="accentWarm" align="center" style={styles.postcardCaption}>
        {caption}
      </Text>
      {/* The stamp — the small thing that makes it read as a postcard rather than a photo card. */}
      <View
        style={[styles.stamp, { backgroundColor: colors.surfaceRaised, borderColor: colors.rule }]}
        pointerEvents="none"
      >
        <Sunburst size={30} opacity={0.5} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
  masthead: { gap: space.xs, width: '100%' },
  // ⚠ `md`, not `lg`. This column holds the title, the scrubber and the transport — three things that
  // read as ONE control surface, so the roomier `lg` step was spacing them like separate sections and
  // spending ~16pt to do it. `lg` still separates the postcard, the question and the CTA in `body`.
  card: { gap: space.md, width: '100%' },
  transportRow: { flexDirection: 'row', alignItems: 'center' },
  // Matches the ⓘ's own 48pt tap floor, and is mirrored empty on the right — see the call site.
  transportSlot: { width: 48 },
  transportFill: { flex: 1 },
  titleRow: { gap: space.sm, alignItems: 'center' },
  // ⚠ ONE STYLE, THREE CALL SITES — the badge, the region chip, and anything else whose own component
  // pins `alignSelf: 'flex-start'`. A row is the only container that can centre such a child, because
  // `justifyContent` runs along the MAIN axis and `alignSelf` only ever overrides the cross one.
  badgeRow: { flexDirection: 'row', justifyContent: 'center' },
  centerRow: { flexDirection: 'row', justifyContent: 'center' },
  field: { gap: space.sm, alignItems: 'center' },
  // The postcard matte: a raised card holding the image, with the caption printed on its lower margin.
  postcard: {
    width: '100%',
    // ⚠ `overflow: hidden` as a backstop. A FLEX version of this frame was tried first and the image
    // spilled out of its matte, drawing over the title beneath it — "parent measured small, child drew
    // large" is a bug you SEE rather than one a test catches. The height is explicit now so it cannot
    // recur, but clipping to the matte makes the whole class impossible.
    overflow: 'hidden',
    padding: space.sm,
    paddingBottom: space.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
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
  postcardPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  postcardCaption: { marginTop: space.sm, marginBottom: space.xs },
  stamp: {
    position: 'absolute',
    top: space.md,
    right: space.md,
    width: 46,
    height: 46,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    transform: [{ rotate: '5deg' }],
  },
})
