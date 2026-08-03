# Drive audio assets

The drive soundtrack is a **shuffled rotation** (`src/lib/driveMusic.ts`): a fresh track
fades in for each leg between stops, ducking out under narration. All tracks below are
loudness-matched to the **Skipper audio master spec — −14 LUFS / −1.0 dBTP** (the same target the
TTS narration uses, so voice and music never jump in level; `AUDIO_LOUDNESS` in `@skipper/shared`,
`docs/decisions/audio-loudness-spec.md`).

The rotation is **fully cleanly-licensed royalty-free** — Pixabay Content License (no
attribution) + Creative Commons BY 4.0 (attribution carried in-app). The four original
ElevenLabs songs (unverified commercial license) were **removed** once the clean tracks
covered the rotation, so there's no longer any license ambiguity in the bundle.

| File | Track / artist | License | In rotation |
|------|----------------|---------|-------------|
| `drive_loop.mp3` | seamless ~55s bed, from *Sentimental Acoustic Guitar & Piano* (music_for_videos) | Pixabay Content License | ✅ |
| `acoustic_road_trip.mp3` | *Acoustic Road Trip Music* — Sonican | Pixabay Content License | ✅ |
| `travel_in_light.mp3` | *Travel in Light* — Sonican | Pixabay Content License | ✅ |
| `golden_twilight.mp3` | *Golden Twilight (Country Folk Instrumental)* — kaazoom | Pixabay Content License | ✅ |
| `acoustic_folk_guitar.mp3` | *Acoustic folk guitar instrumental* — Moonpub | Pixabay Content License | ✅ |
| `small_town.mp3` | *Small Town* — Mr Smith | CC BY 4.0 | ✅ |
| `strummin_robin_smith.mp3` | *Strummin' with Robin Smith* — Beat Mekanik | CC BY 4.0 | ✅ |
| `homeward.mp3` | *Homeward* — Scott Buckley (folky/carefree) | CC BY 4.0 | ✅ |
| `simplicity.mp3` | *Simplicity* — Scott Buckley (folky/carefree) | CC BY 4.0 | ✅ |
| `wanderlust.mp3` | *Wanderlust* — Scott Buckley (folky/carefree) | CC BY 4.0 | ✅ |
| `journeys.mp3` | *Journeys* — Scott Buckley (folky/carefree; faint backing vox) | CC BY 4.0 | ✅ |
| `felicity.mp3` | *Felicity* — Scott Buckley (folky/carefree) | CC BY 4.0 | ✅ |
| `ice_cream.mp3` | *Ice Cream* — Scott Buckley (folky/carefree) | CC BY 4.0 | ✅ |
| `green_leaves.mp3` | *Green Leaves* — Jason Shaw (Audionautix) | CC BY 4.0 | ✅ |
| `redwood_trail.mp3` | *Redwood Trail* — Jason Shaw (Audionautix) | CC BY 4.0 | ✅ |
| `paper_wings.mp3` | *Paper Wings* — Jason Shaw (Audionautix) | CC BY 4.0 | ✅ |
| `landras_dream.mp3` | *Landra's Dream* — Jason Shaw (Audionautix) | CC BY 4.0 | ✅ |
| `intro.mp3` / `outro.mp3` | drive-start / drive-end sting (Pixabay) | Pixabay Content License | Staged, not wired |

> **Loudness:** the whole rotation (all 17, incl. `drive_loop.mp3`) was re-mastered 2026-06-19 to the
> master spec with a two-pass `ffmpeg -af loudnorm=I=-14:TP=-1.0:LRA=11` (measure → linear gain),
> re-encoded to 192 kbps stereo MP3, metadata stripped. Verified: every track lands ≈−14 LUFS
> (the prior −11.7…−15.0 spread collapsed). To re-master after an `AUDIO_LOUDNESS` change, redo this
> two-pass on the source tracks at the new numbers — see `docs/decisions/audio-loudness-spec.md`.

## Source & license

### Pixabay — `drive_loop.mp3`, `intro.mp3`, `outro.mp3`

Derived from **"Sentimental Acoustic Guitar & Piano"** (uploader: *music_for_videos*):
<https://pixabay.com/music/acoustic-group-sentimental-acoustic-guitar-amp-piano-145041/>

### Pixabay — the four added road-trip instrumentals

All under the **Pixabay Content License** — free for commercial use, **no attribution
required**, editing/looping allowed (the same license as `drive_loop.mp3`). Credit kept
here for our records, not because the license requires it. (Constraint: don't
redistribute the bare audio files standalone; bundling them under the app is a "larger
work" and fine.)

- *Acoustic Road Trip Music* — **Sonican** —
  <https://pixabay.com/music/acoustic-group-acoustic-road-trip-music-459535/>
- *Travel in Light* — **Sonican** —
  <https://pixabay.com/music/acoustic-group-travel-in-light-345685/>
- *Golden Twilight – Acoustic Guitar Country Folk Instrumental* — **kaazoom** —
  <https://pixabay.com/music/acoustic-group-golden-twilight-acoustic-guitar-country-folk-instrumental-144407/>
- *Acoustic folk guitar instrumental* — **Moonpub** —
  <https://pixabay.com/music/folk-acoustic-folk-guitar-instrumental-487479/>

### Creative Commons BY 4.0 — attribution **required** (carried in-app)

These are licensed **CC BY 4.0**: commercial use + editing/looping are allowed, but
attribution is required. The credits are shown in-app on **Settings → Credits →
Sources & Licenses** (`app/legal.tsx`, driven by `src/lib/licenses.ts MUSIC_CREDITS`) —
keep that surface in sync with this list.

- *Small Town* — **Mr Smith** (Free Music Archive), CC BY 4.0 —
  <https://freemusicarchive.org/music/mr-smith/a-new-roar/small-town/>
- *Strummin' with Robin Smith* — **Beat Mekanik** (Free Music Archive), CC BY 4.0 —
  <https://freemusicarchive.org/music/beat-mekanik/single/strummin-with-robin-smith/>
- *Homeward*, *Simplicity*, *Wanderlust*, *Journeys*, *Felicity*, and *Ice Cream* —
  **Scott Buckley** (<https://www.scottbuckley.com.au>), CC BY 4.0
  <https://creativecommons.org/licenses/by/4.0/>. Folky/carefree acoustic pieces —
  founder picks for the warm Bluey-ish vibe (the founder loves Joff Bush's "Creek").
  *Journeys* has faint textural backing vocals (no lead lyrics). Credit line per his
  site: "'Title' by Scott Buckley — released under CC-BY 4.0. www.scottbuckley.com.au".
- *Green Leaves*, *Redwood Trail*, *Paper Wings*, and *Landra's Dream* — **Jason Shaw**
  (Audionautix, <https://audionautix.com>), CC BY 4.0
  <https://creativecommons.org/licenses/by/4.0/>. Warm acoustic-guitar folk. Credit line:
  "Music by Jason Shaw — Audionautix.com — licensed under CC BY 4.0".

> **A note on Mixkit:** a Mixkit track (*Walking in the Park*, Diego Nava) was auditioned
> and the founder liked it, but the **Mixkit Stock Music Free License excludes "video
> games"** (alongside CDs/DVDs/broadcast) — a gray area for an interactive app that
> bundles music, and we keep frozen bundle assets to unambiguous licenses (CC0 / CC BY /
> Pixabay). So it was NOT shipped. (<https://mixkit.co/license/>)

### ElevenLabs (Eleven Music) — REMOVED

The four original road-trip songs (`acoustic_countryside_journey`, `wanderers_tale`,
`restless_roads_ahead`, `seaside_cafe`) were generated with ElevenLabs (Eleven Music),
whose commercial-use rights follow the account's subscription tier and were never verified.
They were **removed** once the clean-licensed tracks covered the rotation, so the bundle
now carries no license ambiguity. (Recorded here so the next agent doesn't resurrect them.)

## How the Pixabay `drive_loop` assets were derived (reproducible)

- `drive_loop.mp3` — loop points chosen by audio-similarity search (the theme recurs
  ~every 55s); cut `7.11s → 62.00s` with a 1s crossfade folding the matched tail into
  the head → seamless, soft entry. Full quality (stereo, no low-pass).
- `intro.mp3` — the track's opening ~5s + a 0.8s out-fade.
- `outro.mp3` — the track's natural ending (~145.5–150.5s) — its own resolve/decay.

The player (`src/lib/driveMusic.ts`) shuffles the rotation, plays a fresh track per leg
between stops, fades each out under a stop's narration, advances gaplessly when a track
ends mid-leg (playlist `loop: 'all'`), and fades out when the drive ends. The full songs
are not seamless loops; the rotation advances between them rather than looping any single
one.
