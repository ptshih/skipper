# Skipper audio takes EXCLUSIVE focus (`doNotMix`) — the skipper is the audio, not a voice-over

> **Status:** DECIDED 2026-06-19 (founder) for the DRIVING player. **EXTENDED 2026-08-01 (founder, 1.1
> D35) to EVERY surface the skipper speaks on** — the pre-drive tastes now take exclusive focus too, so
> there is no longer a "polite" tier of skipper audio. `interruptionMode: 'doNotMix'` is **by design**
> everywhere; it is NOT a deferred default awaiting a flip to `'duckOthers'` or `'mixWithOthers'`.
> Supersedes the prior "Phase-0 audio-duck spike" stance (the CLAUDE.md "In-car player landmines" audio
> line, the `useDrive.ts` `DRIVE_INTERRUPTION_MODE` comment, and the `gps-player-spec.md` Phase-0
> references — all corrected in the 2026-06-19 change), and supersedes the "a couch preview is polite"
> comments that shipped on the two preview surfaces until 1.1 step 8.

## What

Every surface on which the skipper's voice sounds sets the audio session to `'doNotMix'`: it takes
**exclusive** focus and pauses the rider's own external music (Spotify, podcasts) while he talks. Nothing
ducks (lower-and-mix) the rider's music under him, anywhere. Four surfaces, one rule:

1. **The drive player** — `apps/mobile/src/lib/useDrive.ts`, `DRIVE_INTERRUPTION_MODE`. The original
   2026-06-19 decision.
2. **The `GET /sample` postcard** (`apps/mobile/app/sample.tsx`) — the one ungated clip a stranger hears
   before anything else.
3. **The drive-detail stop preview** (`apps/mobile/src/lib/useStopPreview.ts`) — tap a stop on the couch
   to hear that one narration.
4. **The route preview clip** — the single presigned clip from the rider's own proposed route, played
   inside the plan conversation (1.1 step 8; INV-5 picks it server-side from the release-filtered build
   corpus).

⚠ **Exclusivity is the only thing 2–4 inherit from 1.** `shouldPlayInBackground` is a SEPARATE question
decided per surface and is deliberately not unified: the drive and the postcard keep playing on a locked
phone (a taste that dies mid-sentence is worse than one that finishes); the two in-list previews are
foreground-only, because a clip that keeps talking after the rider leaves the screen is a bug. That split
is why `useStopPreview` re-asserts the whole audio mode on every play — `setAudioModeAsync` is
PROCESS-WIDE and the drive player, which pushes over a still-mounted detail screen, is the last writer.

## Why

1. **The drive is a self-contained produced experience, not a narration over your playlist.** "Voice owns
   the stops; MUSIC owns the drive" (`apps/mobile/src/lib/driveMusic.ts`): between narration stops the drive
   plays the Skipper's OWN curated road-trip soundtrack. The rider opted into a complete experience that
   supplies BOTH the voice and the music — so there is no "their music" to duck under; the drive replaces
   it. `'duckOthers'` would imply the rider's playlist keeps playing underneath, which contradicts the
   curated-soundtrack model.
2. **Ducking was already rejected — for the same reason — in roam** (2026-06-11). Ducking left the rider's
   music competing UNDER the Skipper, which was distracting; roam chose pause+resume instead. The drive
   reaches the same conclusion from the soundtrack angle: exclusive focus, never a competing bed. ⚠ Roam
   itself was REMOVED in 1.1 — the code is gone, the finding is not. It is the only time we actually
   listened to the alternative.
3. **`doNotMix` keeps lock-screen Now Playing working.** The GPS-player spec flagged the duck-vs-lock-screen
   coexistence as the riskiest audio assumption; exclusive focus resolves it cleanly — the skipper owns the
   lock-screen transport.
4. **(2026-08-01, the extension.) The rider's first impression of the skipper must not be him talking over
   something else.** The previous split — the drive exclusive, every preview `mixWithOthers` — read as
   principled but wasn't: reason 1 is an argument about the *drive's own soundtrack bed*, and a preview
   clip has no bed, so it never actually applied. What it produced instead was the skipper mumbling under
   a stranger's Spotify on the exact surfaces that have to sell him. Reasons 2 and 3 apply to a single
   clip unchanged: a competing bed was tried and rejected on its own merits, and a clip that owns the
   session is the clip that owns the lock screen.
5. **One rule is the durable one.** A per-surface politeness tier is a knob every future surface has to
   re-argue, and each re-argument is a coin flip. "The skipper never talks over the rider's music" is a
   sentence an agent can apply without re-deriving it. CLAUDE.md's "In-car player landmines" audio line
   carries it.

## What this decision does NOT license

- **Autoplay.** Exclusive focus makes an un-asked-for clip strictly worse: it doesn't join the rider's
  music, it stops it. The route preview clip is TAP-to-play, always (1.1 step 8). The postcard's autoplay
  predates this and survives only because the rider explicitly navigated to a player screen — it is not
  the precedent for anything that appears beside other content.
- **Holding focus while silent.** Exclusive focus is taken when he speaks and released when the surface
  is left. Blur stops an in-list preview; that is a corollary of exclusivity, not a nicety.
