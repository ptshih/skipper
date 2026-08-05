import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
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

export default function SampleScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)
  const pickRegion = useRegionPicker()

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
    // ⚠ `scroll padded`, and NOT `center` — deliberately, on two counts (founder, 2026-08-04: "can you
    // top align the postcard too").
    //   • TOP-ALIGNED: the postcard is the hero and it should meet the eye where the eye lands, not
    //     float in a vertically-centred block whose position moves with the clip's own controls.
    //   • `center` also sets `alignItems: 'center'`, which SILENTLY COLLAPSED the divider below: a
    //     `Divider` draws a hairline via `borderTopWidth` on a View with no intrinsic width, so a
    //     centring cross-axis shrank it to nothing. It rendered, measured zero, and looked like a
    //     missing feature. Same family as the `alignSelf` traps on the badge and the region chip.
    // `scroll` stays: postcard + transport + question + CTA is taller than a small phone at large
    // Dynamic Type, and this is the one screen a rider cannot navigate away from to escape a clipped
    // control.
    <Screen scroll padded edges={SCREEN_EDGES} contentContainerStyle={styles.body}>
      <Stack.Screen options={BLANK_HEADER} />

      <PostcardFrame image={postcardImageFor(sample?.qid)} caption={voice.sample.kicker} colors={colors} />

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
        <TransportBar
          playing={status.playing}
          onPlayPause={togglePlay}
          // ⚠ BOTH, never one — see `pauseLabel` on TransportBar. The defaults are drive copy, and on
          // this screen the disc starts a one-minute postcard, not a drive.
          playLabel={voice.sample.playA11y}
          pauseLabel={voice.sample.pauseA11y}
          canSeek={canSeek}
          onSeekBack={() => seekBy(-15)}
          onSeekForward={() => seekBy(15)}
        />

        {/* The ⓘ source affordance — same reveal as the drive player (unified). */}
        <AttributionButton items={sample?.attribution} />
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
        {/* Says the LIMIT out loud rather than hiding it: a newcomer who picks from a short list has
            learned something true in the one moment they are most forgiving of it, where the same fact
            discovered later, mid-plan, reads as a dead end. Hidden when the list failed to load — the
            sentence would be describing something not on screen. */}
        {hasRegions ? (
          <Text variant="dim" color="inkFaint" align="center">
            {voice.region.setupBody}
          </Text>
        ) : null}
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
}: {
  image: ImageSourcePropType | undefined
  caption: string
  colors: Theme['colors']
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
      <View style={[styles.postcardImage, { backgroundColor: colors.surfaceSunken }]}>
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
  card: { gap: space.lg, width: '100%' },
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
    padding: space.sm,
    paddingBottom: space.xs,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  postcardImage: {
    width: '100%',
    aspectRatio: 3 / 2, // a postcard is landscape
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
