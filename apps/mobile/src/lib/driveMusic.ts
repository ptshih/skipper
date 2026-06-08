// Tour background music for the preview/drive player.
//
// The skipper's VOICE owns the stops; the MUSIC owns the drive. A seamless loop
// (assets/audio/drive_loop.mp3 — a "McQueen and Sally"-style acoustic piece,
// Pixabay Content License, see assets/audio/SOURCE.md) plays between stops and
// fades OUT when a stop's narration plays, then fades back IN when the drive
// resumes; it also fades out when the tour ends.
//
// intro.mp3 / outro.mp3 are staged in assets/audio but intentionally NOT used yet.
// Self-contained so the preview screen only adds one hook call.
import { useEffect, useRef } from 'react'
import { useAudioPlayer } from 'expo-audio'

const FULL = 0.95 // loop is foreground between stops (not under voice) → near full
const TICK_MS = 50
const FADE_MS = 1200 // duck/unduck at a stop boundary
const FADE_END_MS = 600 // fade out a touch faster when the tour ends

/**
 * @param active music should be audible now (driving/resting + playing, not at a clip)
 * @param ended  the tour has finished (fade the loop out)
 */
export function useDriveMusic({ active, ended }: { active: boolean; ended: boolean }): void {
  const loop = useAudioPlayer(require('../../assets/audio/drive_loop.mp3'))
  const vol = useRef(0)
  const ramp = useRef<ReturnType<typeof setInterval> | null>(null)

  // Start the loop muted + looping once, so fades are just volume ramps on an
  // already-running seamless loop (no restart pops). Clean up on unmount.
  useEffect(() => {
    try {
      loop.loop = true
      loop.volume = 0
      loop.play()
    } catch {}
    return () => {
      try {
        loop.pause()
      } catch {}
      if (ramp.current) clearInterval(ramp.current)
    }
  }, [loop])

  // Ramp the loop volume toward its target whenever active/ended changes.
  useEffect(() => {
    const target = active && !ended ? FULL : 0
    const fadeMs = ended ? FADE_END_MS : FADE_MS
    const step = (FULL / fadeMs) * TICK_MS
    if (ramp.current) clearInterval(ramp.current)
    ramp.current = setInterval(() => {
      if (vol.current < target) vol.current = Math.min(target, vol.current + step)
      else if (vol.current > target) vol.current = Math.max(target, vol.current - step)
      try {
        loop.volume = vol.current
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
  }, [active, ended, loop])
}
