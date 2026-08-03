import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { setAudioModeAsync, setIsAudioActiveAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { Stack, useRouter } from 'expo-router'
import type { ImageSourcePropType } from 'react-native'
import { track } from '@/lib/analytics'
import { markSamplePlayed } from '@/lib/client-flags'
import { getSample } from '@/lib/api'
import { cleanPlaceName } from '@/lib/labels'
import { postcardImageFor } from '@/lib/postcards'
import type { Sample } from '@skipper/shared'
import { space, radius } from '@/theme/tokens'
import { useTheme, type Theme } from '@/theme'
import {
  AttributionButton,
  Badge,
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
// Deliberately NOT a simulated drive (which opens on proximity-roulette, can start silent, and ends
// in dead air) — so it is structurally incapable of showing the
// dev diagnostics footer that sim mode carries. It's a small standalone player over one presigned clip.
//
// The clip is chosen server-side (SAMPLE_NARRATION_QID → GET /sample). If it isn't configured the
// endpoint 404s and this screen shows a reachable retry — never a white void.

// A short beat after the screen paints before audio starts — so a stranger in a quiet room isn't
// jump-scared by a voice the instant they tap, and reads the "A TASTE" badge first.
const AUTOPLAY_BEAT_MS = 450

export default function SampleScreen() {
  const router = useRouter()
  const { colors } = useTheme()
  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)

  const [phase, setPhase] = useState<'loading' | 'playing' | 'ended' | 'error'>('loading')
  const [sample, setSample] = useState<Sample | null>(null)
  // didJustFinish can double-fire; latch the end exactly once.
  const endedRef = useRef(false)
  const beatTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // `sample_played` is a SEPARATE event from the conversation's preview_clip_played on purpose: this
  // screen AUTOPLAYS, so its plays are zero-intent by default, while a tap on the rider's OWN
  // proposed route is the sharpest charm signal the release has. Averaging the two together would
  // hide both. `startedRef` latches the start to one event per load (a pause/resume is not a new
  // play); `autoplayRef` carries the initiator forward to the completion event, which fires far away
  // in the end-latch effect below.
  const startedRef = useRef(false)
  const autoplayRef = useRef(true)

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
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {})
    // ⚠ AND HAND IT BACK ON THE WAY OUT. This is the other half of the flip and it is not optional:
    // `doNotMix` INTERRUPTS the rider's music, and iOS resumes theirs only once the session is
    // deactivated — pausing the player is not enough. Without this, a stranger taps the postcard, we
    // pause their podcast, and it never comes back — on the app's very first impression, which
    // autoplays. `useDrive` already pays this at the end of a drive; every exclusive surface owes it.
    return () => {
      void setIsAudioActiveAsync(false).catch(() => {})
    }
  }, [])

  // Fire sample_played's START exactly once per load. `auto` records WHO began playback — the beat
  // timer (true) or the rider's own tap on the transport (false) — and it must be truthful: a screen
  // that autoplays produces plays nobody asked for, and a tap after a failed/blocked autoplay is a
  // different, much stronger signal. Whichever fires first wins, so a rider who taps during the
  // autoplay beat is correctly recorded as deliberate. (The beat's length lives on its constant —
  // restating it here would be a second copy that lies the day it moves.)
  const markStarted = useCallback((auto: boolean) => {
    if (startedRef.current) return
    startedRef.current = true
    autoplayRef.current = auto
    track('sample_played', { completed: false, autoplay: auto })
    // ⚠ RIDES THIS LATCH RATHER THAN ADDING ONE — it is already exactly "the sample began playing",
    // once per load, for both the autoplay beat and a deliberate tap. A second latch would be a
    // second definition of the same fact, and the two would drift the first time either moved.
    // This is the PLAYED half of home's listen-row rule (the SEEN half is marked on home itself):
    // heard it once and the row never greets you again, whichever came first.
    markSamplePlayed()
  }, [])

  const load = useCallback(async () => {
    setPhase('loading')
    endedRef.current = false
    startedRef.current = false // the retry path re-loads the clip — that is a new play
    try {
      const s = await getSample()
      setSample(s)
      player.replace({ uri: s.url })
      // Pre-buffer is implicit in replace(); the beat is purely the anti-jump-scare pause.
      beatTimer.current = setTimeout(() => {
        try {
          player.play()
          markStarted(true)
        } catch {}
      }, AUTOPLAY_BEAT_MS)
      setPhase('playing')
    } catch {
      // A soft 404 (no sample configured) or a network blip — both are a retryable hiccup here, not a
      // persona dead-end. Show the retry surface.
      setPhase('error')
    }
  }, [player, markStarted])

  useEffect(() => {
    void load()
    return () => {
      if (beatTimer.current) clearTimeout(beatTimer.current)
    }
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
    if (endedRef.current || phase !== 'playing') return
    const atEnd = durSec > 0 && !status.playing && (status.currentTime ?? 0) >= durSec - 0.35
    if (status.didJustFinish || atEnd) {
      endedRef.current = true
      setPhase('ended')
      // ── sample_played: COMPLETION. It rides the screen's EXISTING end latch (endedRef, plus the
      // atEnd fallback for a didJustFinish dropped across an OS interruption) rather than a second
      // mechanism of its own — so the event can never disagree with the end card the rider is
      // looking at, and a dropped native event doesn't silently drop the completion too.
      track('sample_played', { completed: true, autoplay: autoplayRef.current })
      // Hand the audio session back the moment the taste is over, not on unmount: the rider sits on
      // the end card deciding, and under `doNotMix` their own music stays paused for as long as they
      // do. The unmount teardown above is the backstop for leaving mid-clip.
      void setIsAudioActiveAsync(false).catch(() => {})
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
        // A no-op once the beat timer already started the clip (startedRef). It matters only when
        // the autoplay never took — a silenced/interrupted session — and the rider reached for the
        // button themselves, which is a deliberate play, not an autoplay.
        markStarted(false)
      }
    } catch {}
  }

  // StateView skips its Stack.Screen for a falsy title, so an empty string would leak the route name
  // ("sample") into the header. Render the blank-header Stack.Screen alongside it instead.
  if (phase === 'loading')
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <StateView loading message={voice.sample.loading} />
      </>
    )
  if (phase === 'error')
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
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
        <Stack.Screen options={{ title: '' }} />
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
            // ⚠ Every route into this screen now arrives from home, so BACK is always correct — the
            // `?from=roam` fork existed only because the roam rescue put roam on the stack beneath us.
            // Do not "restore" a replace() here: with one entry point, replacing would drop the
            // rider's history for no gain.
            onPress: () => router.back(),
            glow: true,
            secondary: { title: voice.sample.endSecondary, onPress: () => router.back() },
          }}
        />
      </Screen>
    )

  // ── PLAYING: the postcard proper. The framed image is the hero; the scrubber is the ONE progress
  // bar (the old RouteTrack motif was a redundant second one). ──
  return (
    <Screen padded center contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: '' }} />

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
