# Drive audio takes EXCLUSIVE focus (`doNotMix`) — the drive IS the audio, not a voice-over

> **Status:** DECIDED 2026-06-19 (founder). The drive player's `interruptionMode` is `'doNotMix'` **by
> design** — it is NOT a deferred default awaiting a flip to `'duckOthers'`. Supersedes the prior "Phase-0
> audio-duck spike" stance (the CLAUDE.md "In-car player landmines" audio line, the `useDrive.ts`
> `DRIVE_INTERRUPTION_MODE` comment, and the `gps-player-spec.md` Phase-0 references — all corrected in
> this change). The code was already correct; this records the *why* and removes the stale "must duck"
> doctrine so a future agent doesn't "fix" it.

## What

The driving player (`apps/mobile/src/lib/useDrive.ts`, `DRIVE_INTERRUPTION_MODE`) sets the audio session to
`'doNotMix'`: it takes **exclusive** focus and pauses the rider's own external music (Spotify, podcasts) for
the drive. It does **not** duck (lower-and-mix) the rider's music under the narration. There is no pending
flip to `'duckOthers'` — this is the final design.

## Why

1. **The drive is a self-contained produced experience, not a narration over your playlist.** "Voice owns
   the stops; MUSIC owns the drive" (`apps/mobile/src/lib/driveMusic.ts`): between narration stops the drive
   plays the Skipper's OWN curated road-trip soundtrack. The rider opted into a complete experience that
   supplies BOTH the voice and the music — so there is no "their music" to duck under; the drive replaces
   it. `'duckOthers'` would imply the rider's playlist keeps playing underneath, which contradicts the
   curated-soundtrack model.
2. **Ducking was already rejected — for the same reason — in roam.** The roam decision (2026-06-11) found
   ducking left the rider's music competing UNDER the Skipper, which was distracting, and chose pause+resume
   instead. The drive reaches the same conclusion from the soundtrack angle: exclusive focus, never a
   competing bed.
3. **`doNotMix` keeps lock-screen Now Playing working.** The GPS-player spec flagged the duck-vs-lock-screen
   coexistence as the riskiest audio assumption; exclusive focus resolves it cleanly — the drive owns the
   lock-screen transport.

## Relation to roam

Roam (`apps/mobile/src/lib/useRoam.ts`) is a Q&A-style overlay with NO background soundtrack, so it takes
exclusive focus only WHILE a clip sounds and hands focus back between encounters (pause+resume). The drive,
with its continuous soundtrack, holds exclusive focus across the whole drive. Both deliberately do **not**
duck — two shapes of the same principle: never let the rider's music compete underneath the Skipper.
