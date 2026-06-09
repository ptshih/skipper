// Tour background music for the preview/drive player — a SHUFFLED ROTATION.
//
// The skipper's VOICE owns the stops; the MUSIC owns the drive. A rotation of
// road-trip tracks (assets/audio/*.mp3 — see assets/audio/SOURCE.md) plays between
// stops and fades OUT when a stop's narration plays, then a FRESH track fades back
// IN when the next driving leg begins — so each narrated leg gets a different song.
// It also fades out when the tour ends. The playlist loops ('all'), so a track that
// ends mid-leg advances gaplessly (expo-audio's playlist engine) and the rotation
// never runs dry.
//
// Track rotation is keyed off the SEGMENT KIND (advancing only when we leave a
// 'clip'), NOT off play state — so pausing mid-drive and resuming never rotates the
// track, and the swap is always masked by the narration we just ducked under (never
// an abrupt mid-volume cut). Silent 'rest' stops keep the current song.
//
// Transitions are "duck-to-silence under the clip, then a fresh track swells back
// in" (a fade crossfade mediated by the narration) plus gapless advance mid-leg —
// not a true two-track overlap, which would need a second audio engine and is not
// worth the iOS-session / lock-screen contention with the narration player.
//
// intro.mp3 / outro.mp3 are staged in assets/audio but intentionally NOT used yet.
// Self-contained so the preview screen only adds one hook call.
import { useEffect, useRef } from 'react'
import { useAudioPlaylist } from 'expo-audio'

// The drive soundtrack rotation, shuffled per hook instance so repeat drives don't
// always open on the same song. Per-track sources + licenses live in SOURCE.md; the
// CC-BY credits also surface in-app on the Sources & Licenses screen (app/legal.tsx).
// All tracks are loudness-matched (~-13 LUFS) so the rotation never jumps in volume.
const TRACKS = [
  // Seamless Pixabay bed — Pixabay Content License (commercial OK, no attribution).
  require('../../assets/audio/drive_loop.mp3'),
  // Royalty-free road-trip instrumentals — Pixabay Content License (no attribution).
  require('../../assets/audio/acoustic_road_trip.mp3'),
  require('../../assets/audio/travel_in_light.mp3'),
  require('../../assets/audio/golden_twilight.mp3'),
  require('../../assets/audio/acoustic_folk_guitar.mp3'),
  // Creative Commons BY 4.0 — attribution carried on the Sources & Licenses screen.
  require('../../assets/audio/small_town.mp3'),
  require('../../assets/audio/strummin_robin_smith.mp3'),
  // Folky/carefree Scott Buckley pieces (founder picks — a gentler color for scenic legs).
  require('../../assets/audio/homeward.mp3'),
  require('../../assets/audio/simplicity.mp3'),
  require('../../assets/audio/wanderlust.mp3'),
  require('../../assets/audio/journeys.mp3'),
  require('../../assets/audio/felicity.mp3'),
  require('../../assets/audio/ice_cream.mp3'),
  // Jason Shaw (Audionautix) acoustic folk.
  require('../../assets/audio/green_leaves.mp3'),
  require('../../assets/audio/redwood_trail.mp3'),
  require('../../assets/audio/paper_wings.mp3'),
  require('../../assets/audio/landras_dream.mp3'),
]

const FULL = 0.95 // music is foreground between stops (not under voice) → near full
const TICK_MS = 50
const FADE_MS = 1200 // duck/unduck at a stop boundary
const FADE_END_MS = 600 // fade out a touch faster when the tour ends

// Fisher–Yates: a fresh shuffle of the track order for this hook instance.
function shuffled<T>(input: readonly T[]): T[] {
  const a = input.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * @param active       music should be audible now (driving/resting + playing, not at a clip)
 * @param ended        the tour has finished (fade the rotation out)
 * @param segmentKind  the current timeline segment's kind ('drive' | 'rest' | 'clip' | null).
 *                     Leg rotation keys off this (a 'clip' ending → a driving leg begins),
 *                     not off play state, so pausing mid-drive never rotates the track.
 */
export function useDriveMusic({
  active,
  ended,
  segmentKind,
}: {
  active: boolean
  ended: boolean
  segmentKind: string | null
}): void {
  // A shuffled, whole-set-looping playlist: it never runs dry and a track that ends
  // mid-leg advances gaplessly. The source list is shuffled once (lazy ref) so it's
  // stable across renders — the playlist isn't rebuilt on every render.
  const sources = useRef<number[] | null>(null)
  if (sources.current === null) sources.current = shuffled(TRACKS)
  const playlist = useAudioPlaylist({ sources: sources.current, loop: 'all' })

  const vol = useRef(0)
  const ramp = useRef<ReturnType<typeof setInterval> | null>(null)
  const started = useRef(false)
  const prevKind = useRef<string | null>(null)

  // Start the rotation muted + playing once, so fades are just volume ramps on an
  // already-running playlist (no restart pops). Clean up on unmount.
  useEffect(() => {
    try {
      playlist.volume = 0
      playlist.play()
    } catch {}
    return () => {
      try {
        playlist.pause()
      } catch {}
      if (ramp.current) clearInterval(ramp.current)
    }
  }, [playlist])

  // Rotate the track at each LEG boundary (a 'clip' ending → a driving segment), then
  // ramp the volume toward its target. Keying rotation off segment KIND (not play
  // state) means pause/resume within a leg never rotates, and the swap always happens
  // while ducked under the narration we just left.
  useEffect(() => {
    const audible = active && !ended

    if (audible && !started.current) {
      // First audible leg keeps shuffle[0] — don't advance (the timeline opens on a
      // clip, so this is what stops the first driving leg from skipping a track).
      started.current = true
    } else if (
      started.current &&
      segmentKind != null &&
      segmentKind !== 'clip' &&
      prevKind.current === 'clip'
    ) {
      // Out of a narration clip into a fresh driving leg → next track, while still
      // muted (it fades up below). iOS's native playlist next() omits the wasPlaying
      // → play() restore that previous()/skipTo() perform, so re-assert play()
      // (idempotent if already playing) to avoid fading up into silence.
      try {
        playlist.next()
        playlist.play()
      } catch {}
    }
    prevKind.current = segmentKind

    const target = audible ? FULL : 0
    const fadeMs = ended ? FADE_END_MS : FADE_MS
    const step = (FULL / fadeMs) * TICK_MS
    if (ramp.current) clearInterval(ramp.current)
    ramp.current = setInterval(() => {
      if (vol.current < target) vol.current = Math.min(target, vol.current + step)
      else if (vol.current > target) vol.current = Math.max(target, vol.current - step)
      try {
        playlist.volume = vol.current
      } catch {}
      if (vol.current === target && ramp.current) {
        clearInterval(ramp.current)
        ramp.current = null
      }
    }, TICK_MS)
    return () => {
      if (ramp.current) {
        clearInterval(ramp.current)
        ramp.current = null
      }
    }
  }, [active, ended, segmentKind, playlist])
}
