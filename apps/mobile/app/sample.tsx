import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { Stack, useRouter } from 'expo-router'
import type { ImageSourcePropType } from 'react-native'
import { applyExclusiveBackgroundAudio, releaseAudioSession } from '@/lib/audio-session'
import { track } from '@/lib/analytics'
import { getSample } from '@/lib/api'
import { cleanPlaceName } from '@/lib/labels'
import { postcardImageFor } from '@/lib/postcards'
import type { Sample } from '@skipper/shared'
import { space, radius } from '@/theme/tokens'
import { useTheme, type Theme } from '@/theme'
import {
  AttributionButton,
  Badge,
  Button,
  Scrubber,
  Screen,
  StateView,
  Sunburst,
  Text,
  TransportBar,
  voice,
} from '@/ui'

// /sample — the "postcard": ONE curated Tahoe clip a stranger ANYWHERE can hear, permission-free and
// account-free. It exists because the corpus is Tahoe-only, so a first-timer (or an Apple reviewer in
// Cupertino) can talk to the Skipper and still never reach a road he has stories for. This is the way
// out of that wall: a deterministic taste that lands in the first breath, then a "plan a drive" door.
//
// ⚠ IT IS ALSO STEP ONE OF ONBOARDING, AND SINCE 2026-08-04 THAT IS ITS ONLY ENTRANCE. Home's listen
// row was deleted when the taste moved here (founder), so nothing else pushes this route: every rider
// arrives on their first launch, from home's redirect, and leaves through `/region-setup`. Two things
// follow that a future editor must not undo piecemeal — the forward CTA may not be a `router.back()`
// (there is nothing behind it but the redirect that sent us, i.e. a loop), and the SKIP affordance is
// load-bearing rather than polite (without it a rider who does not want a minute of audio has no way
// out of onboarding at all). See docs/designs/onboarding-taste-then-where.md.
//
// Deliberately NOT a simulated drive (which opens on proximity-roulette, can start silent, and ends
// in dead air) — so it is structurally incapable of showing the
// dev diagnostics footer that sim mode carries. It's a small standalone player over one presigned clip.
//
// The clip is chosen server-side (SAMPLE_NARRATION_QID → GET /sample). If it isn't configured the
// endpoint 404s and this screen shows a reachable retry — never a white void.
//
// ⚠ NOTHING PLAYS UNTIL THE RIDER TOUCHES THE DISC, and that reverses this screen's original design
// (founder, 2026-08-04). It autoplayed after a 450 ms anti-jump-scare beat, which was defensible while
// it sat behind a deliberate tap on home's listen row — the rider had already asked for audio. As the
// FIRST screen of a fresh install it is not: this surface takes EXCLUSIVE `doNotMix` focus (see the
// audio effect below), so autoplaying here does not merely make noise, it STOPS whatever a stranger
// was already listening to, unasked, as the app's opening move. On a bus or at a desk that is a wince.
// One tap is the price of not hijacking a podcast to introduce ourselves.

// ⚠ A MODULE CONSTANT, not an inline literal, and it is the same defect step 1 of
// docs/designs/chat-render-performance.md fixed on the chat screen. `Screen` pushes `options` through
// `navigation.setOptions` from a `useLayoutEffect` keyed on that object, and react-navigation always
// spreads a new one — so a fresh literal forces a navigator-wide re-render plus a native header
// re-commit, synchronously before paint. This screen subscribes to expo-audio's status, so it
// re-renders every 500 ms while the sample clip plays. Four call sites, one object.
// (Blank on purpose: StateView skips its own Stack.Screen for a falsy title, so an empty string here
// is what keeps the route name "sample" out of the header.)
const BLANK_HEADER = { title: '' } as const

export default function SampleScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)

  // ⚠ `postcard` is the surface, NOT "audio is running" — the transport's own `status.playing` is the
  // only thing that knows that. It was called `playing` while this screen autoplayed, where the two
  // were the same thing on arrival; naming it that now would be a lie in the one state that matters
  // most here, the freshly-painted card with the disc still untouched.
  const [phase, setPhase] = useState<'loading' | 'postcard' | 'ended' | 'error'>('loading')
  const [sample, setSample] = useState<Sample | null>(null)
  // didJustFinish can double-fire; latch the end exactly once.
  const endedRef = useRef(false)
  // `sample_played` is a SEPARATE event from the conversation's preview_clip_played on purpose: they
  // answer different questions — this one is "did the VOICE land" on a stranger, that one is "did
  // THEIR drive land". Averaging them would hide both. `startedRef` latches the start to one event per
  // load, so a pause/resume is not a second play.
  const startedRef = useRef(false)

  // setAudioModeAsync is process-wide (shared with the drive player). ⚠ D35 (1.1, founder): the postcard
  // is pre-drive SKIPPER audio, so it takes EXCLUSIVE focus like a drive rather than mixing under the
  // rider's music — the skipper never talks over their playlist on any surface. This read 'mixWithOthers'
  // with a comment arguing "a taste is polite" until 1.1 step 8; docs/decisions/drive-audio-exclusive-focus.md
  // was scoped to the DRIVING player and never settled this surface (it is now amended to cover all three).
  // Do not flip it back. `playsInSilentMode` so it still sounds on a muted reviewer device.
  // ⚠ `shouldPlayInBackground` stays TRUE and is deliberately NOT part of D35's flip: this is a dedicated
  // full-screen player the rider navigated to, and a one-minute taste that dies mid-sentence when the
  // phone locks is worse than one that finishes.
  useEffect(() => {
    void applyExclusiveBackgroundAudio()
    // ⚠ AND HAND IT BACK ON THE WAY OUT. This is the other half of the flip and it is not optional:
    // `doNotMix` INTERRUPTS the rider's music, and iOS resumes theirs only once the session is
    // deactivated — pausing the player is not enough. Without this, a stranger taps the postcard, we
    // pause their podcast, and it never comes back — on the app's very first impression, which
    // autoplays. `useDrive` already pays this at the end of a drive; every exclusive surface owes it.
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
    try {
      const s = await getSample()
      setSample(s)
      // Pre-buffers, and deliberately does NOT play: `replace` only cues the source. The disc is the
      // rider's, and buffering ahead of it is what makes their tap feel instant rather than polite.
      player.replace({ uri: s.url })
      setPhase('postcard')
    } catch {
      // A soft 404 (no sample configured) or a network blip — both are a retryable hiccup here, not a
      // persona dead-end. Show the retry surface.
      setPhase('error')
    }
  }, [player])

  useEffect(() => {
    void load()
  }, [load])

  // Fill the trail as the story plays (RouteTrack snaps this under Reduce Motion on its own).
  const durSec =
    status.duration && status.duration > 0 ? status.duration : (sample?.durationMs ?? 0) / 1000

  // Clip finished → the end card (the forward door). didJustFinish is the primary signal, guarded
  // against its double-fire. FALLBACK: expo-audio can DROP didJustFinish across an OS audio
  // interruption (useDrive defends the same way) — so also flip to ended when playback has
  // stopped at/near the very end. Without this, a dropped event strands the rider on the postcard
  // with no CTA — the exact funnel the screen exists to close. Guarded so it can't fire at 0:00.
  useEffect(() => {
    if (endedRef.current || phase !== 'postcard') return
    // ⚠ `startedRef` gates the fallback, and it is new with tap-to-play. While this screen autoplayed,
    // "stopped at/near the end" could only mean a clip that had run; now the card can sit at 0:00,
    // not playing, indefinitely — and a clip whose duration failed to resolve would satisfy
    // `currentTime >= durSec - 0.35` at rest and jump a rider who never pressed play straight to the
    // end card. Requiring a start makes the fallback mean what it says.
    const atEnd =
      startedRef.current && durSec > 0 && !status.playing && (status.currentTime ?? 0) >= durSec - 0.35
    if (status.didJustFinish || atEnd) {
      endedRef.current = true
      setPhase('ended')
      // ── sample_played: COMPLETION. It rides the screen's EXISTING end latch (endedRef, plus the
      // atEnd fallback for a didJustFinish dropped across an OS interruption) rather than a second
      // mechanism of its own — so the event can never disagree with the end card the rider is
      // looking at, and a dropped native event doesn't silently drop the completion too.
      track('sample_played', { completed: true })
      // Hand the audio session back the moment the taste is over, not on unmount: the rider sits on
      // the end card deciding, and under `doNotMix` their own music stays paused for as long as they
      // do. The unmount teardown above is the backstop for leaving mid-clip.
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

  // StateView skips its Stack.Screen for a falsy title, so an empty string would leak the route name
  // ("sample") into the header. Render the blank-header Stack.Screen alongside it instead.
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

  // ── ENDED: the forward door. No motif here — the glowing CTA is the screen's one amber. ──
  if (phase === 'ended')
    return (
      <Screen padded center contentContainerStyle={styles.body}>
        <Stack.Screen options={BLANK_HEADER} />
        <View style={styles.heroSunburst} pointerEvents="none">
          <Sunburst size={168} opacity={0.09} />
        </View>
        <View style={styles.endCard}>
          <Text variant="display" color="ink" align="center">
            {voice.sample.endTitle}
          </Text>
          <Text variant="body" color="inkDim" align="center">
            {voice.sample.endBody}
          </Text>
        </View>
        <TransportBar
          single={{
            title: voice.sample.endCta,
            // ⚠ FORWARD, NEVER `router.back()`, and this is the trap the old code left loaded. Back
            // used to be right because home pushed this screen; home now REDIRECTS to it on a
            // first launch, so going back lands on a home that immediately redirects here again — an
            // onboarding loop with no exit. `replace` also drops this screen from the stack, which is
            // what stops the region step's back chevron offering a rider a second listen they did not
            // ask for. There is exactly one way out of onboarding and it points at `/region-setup`.
            onPress: () => router.replace('/region-setup'),
            glow: true,
          }}
        />
      </Screen>
    )

  // ── THE POSTCARD PROPER. The framed image is the hero; the scrubber is the ONE progress bar (the
  // old RouteTrack motif was a redundant second one). Nothing is playing yet — the disc is the ask. ──
  return (
    <Screen padded center contentContainerStyle={styles.body}>
      <Stack.Screen options={BLANK_HEADER} />

      <PostcardFrame image={postcardImageFor(sample?.qid)} caption={voice.sample.kicker} colors={colors} />

      <View style={styles.card}>
        <View style={styles.titleRow}>
          <Text variant="display" color="ink" align="center" numberOfLines={2}>
            {sample ? cleanPlaceName(sample.name) : ''}
          </Text>
          <Badge tone="teal" label={voice.sample.badge} />
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
          canSeek={canSeek}
          onSeekBack={() => seekBy(-15)}
          onSeekForward={() => seekBy(15)}
        />

        {/* The ⓘ source affordance — same reveal as the drive player (unified). */}
        <AttributionButton items={sample?.attribution} />
      </View>

      {/* ⚠ THE WAY OUT, AND IT IS A REQUIREMENT RATHER THAN A COURTESY. This screen is the first thing
          a fresh install shows and it has no back chevron (home redirected here, so `canGoBack` is
          false) — without this control a rider who does not want to stand still for a minute of audio
          has NO exit from onboarding at all. `ghost` keeps it quiet enough that the disc stays the
          obvious move; it is an escape, not an alternative.
          ⚠ It goes FORWARD to the region step, not home: skipping the taste is not skipping
          onboarding, and jumping home would leave `onboarded` unwritten and bounce them right back. */}
      <Button
        variant="ghost"
        title={voice.sample.skip}
        onPress={() => router.replace('/region-setup')}
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
  body: { gap: space.xl },
  heroSunburst: { position: 'absolute', top: -40, alignSelf: 'center' },
  card: { gap: space.lg, width: '100%' },
  endCard: { gap: space.md },
  titleRow: { gap: space.sm, alignItems: 'center' },
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
