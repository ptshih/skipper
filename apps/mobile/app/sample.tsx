import { useCallback, useEffect, useRef, useState } from 'react'
import { Image, StyleSheet, View } from 'react-native'
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import type { ImageSourcePropType } from 'react-native'
import { getRoamSample } from '@/lib/api'
import { cleanPlaceName } from '@/lib/labels'
import { postcardImageFor } from '@/lib/postcards'
import type { RoamSample } from '@skipper/shared'
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
// Cupertino) who taps "Ride Along" gets zero pins and a dead-end. This is the way out of that wall:
// a deterministic taste that lands in the first breath, then a "ride along for real" forward door.
//
// Deliberately NOT the sim roam engine (which opens on proximity-roulette, can start silent, and ends
// in dead air) and deliberately never imports useRoam — so it is structurally incapable of showing the
// dev diagnostics footer that sim mode carries. It's a small standalone player over one presigned clip.
//
// The clip is chosen server-side (SAMPLE_NARRATION_QID → GET /roam/sample). If it isn't configured the
// endpoint 404s and this screen shows a reachable retry — never a white void.

// A short beat after the screen paints before audio starts — so a stranger in a quiet room isn't
// jump-scared by a voice the instant they tap, and reads the "A TASTE" badge first.
const AUTOPLAY_BEAT_MS = 450

export default function SampleScreen() {
  const router = useRouter()
  // `?from=roam` when reached from the roam no-coverage rescue (roam is already on the stack beneath
  // us). The end CTA then goes BACK to that roam rather than replace('/roam') stacking a second one.
  const { from } = useLocalSearchParams<{ from?: string }>()
  const { colors } = useTheme()
  const player = useAudioPlayer()
  const status = useAudioPlayerStatus(player)

  const [phase, setPhase] = useState<'loading' | 'playing' | 'ended' | 'error'>('loading')
  const [sample, setSample] = useState<RoamSample | null>(null)
  // didJustFinish can double-fire; latch the end exactly once.
  const endedRef = useRef(false)
  const beatTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // setAudioModeAsync is process-wide (shared with roam/drive). A taste is polite — mixWithOthers,
  // playsInSilentMode so it sounds on a muted reviewer device, background-safe.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'mixWithOthers',
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setPhase('loading')
    endedRef.current = false
    try {
      const s = await getRoamSample()
      setSample(s)
      player.replace({ uri: s.url })
      // Pre-buffer is implicit in replace(); the beat is purely the anti-jump-scare pause.
      beatTimer.current = setTimeout(() => {
        try {
          player.play()
        } catch {}
      }, AUTOPLAY_BEAT_MS)
      setPhase('playing')
    } catch {
      // A soft 404 (no sample configured) or a network blip — both are a retryable hiccup here, not a
      // persona dead-end. Show the retry surface.
      setPhase('error')
    }
  }, [player])

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
  // interruption (useDrive/useRoam defend the same way) — so also flip to ended when playback has
  // stopped at/near the very end. Without this, a dropped event strands the rider on the postcard
  // with no CTA — the exact funnel the screen exists to close. Guarded so it can't fire at 0:00.
  useEffect(() => {
    if (endedRef.current || phase !== 'playing') return
    const atEnd = durSec > 0 && !status.playing && (status.currentTime ?? 0) >= durSec - 0.35
    if (status.didJustFinish || atEnd) {
      endedRef.current = true
      setPhase('ended')
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
      status.playing ? player.pause() : player.play()
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
            // From the roam rescue, roam is already beneath us — go back to it, don't stack a second.
            // From home/gate it isn't, so replace into roam.
            onPress: () => (from === 'roam' ? router.back() : router.replace('/roam')),
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

        {/* The ⓘ source affordance — same reveal as the drive player + roam (unified). */}
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
