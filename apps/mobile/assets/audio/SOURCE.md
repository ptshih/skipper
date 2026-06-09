# Tour audio assets

The drive soundtrack is a **shuffled rotation** (`src/lib/driveMusic.ts`): a fresh track
fades in for each leg between stops, ducking out under narration. All tracks below are
loudness-matched (~-13 LUFS integrated) so the rotation never jumps in volume.

The rotation now leans on **cleanly-licensed royalty-free** tracks (Pixabay Content
License + Creative Commons BY 4.0); the four ElevenLabs songs are kept but carry an
**unverified** commercial license (see below) and can be dropped — the clean tracks
fully cover the rotation.

| File | Track / artist | License | In rotation |
|------|----------------|---------|-------------|
| `drive_loop.mp3` | seamless ~55s bed, from *Sentimental Acoustic Guitar & Piano* (music_for_videos) | Pixabay Content License | ✅ |
| `acoustic_road_trip.mp3` | *Acoustic Road Trip Music* — Sonican | Pixabay Content License | ✅ |
| `travel_in_light.mp3` | *Travel in Light* — Sonican | Pixabay Content License | ✅ |
| `golden_twilight.mp3` | *Golden Twilight (Country Folk Instrumental)* — kaazoom | Pixabay Content License | ✅ |
| `acoustic_folk_guitar.mp3` | *Acoustic folk guitar instrumental* — Moonpub | Pixabay Content License | ✅ |
| `long_road_ahead.mp3` | *Long Road Ahead* — Kevin MacLeod | CC BY 4.0 | ✅ |
| `americana.mp3` | *Americana* — Kevin MacLeod | CC BY 4.0 | ✅ |
| `small_town.mp3` | *Small Town* — Mr Smith | CC BY 4.0 | ✅ |
| `strummin_robin_smith.mp3` | *Strummin' with Robin Smith* — Beat Mekanik | CC BY 4.0 | ✅ |
| `acoustic_countryside_journey.mp3` | road-trip song (~2:46) | ElevenLabs (⚠️ unverified) | ✅ |
| `wanderers_tale.mp3` | road-trip song (~2:20) | ElevenLabs (⚠️ unverified) | ✅ |
| `restless_roads_ahead.mp3` | road-trip song (~2:37) | ElevenLabs (⚠️ unverified) | ✅ |
| `seaside_cafe.mp3` | road-trip song (~1:34) | ElevenLabs (⚠️ unverified) | ✅ |
| `intro.mp3` / `outro.mp3` | tour-start / tour-end sting (Pixabay) | Pixabay Content License | Staged, not wired |

> **Loudness:** each added track was normalized with
> `ffmpeg -af loudnorm=I=-13:TP=-1.5:LRA=11` and re-encoded to 192 kbps stereo MP3
> (matching the existing rotation), metadata stripped. The existing five tracks were
> left as-is (they already sit within the -16…-11 LUFS band the new ones target).

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

These four are licensed **CC BY 4.0**: commercial use + editing/looping are allowed,
but attribution is required. The credits are shown in-app on **Settings → Credits →
Sources & Licenses** (`app/legal.tsx`, driven by `src/lib/licenses.ts MUSIC_CREDITS`) —
keep that surface in sync with this list.

- *Long Road Ahead* and *Americana* — **Kevin MacLeod** (incompetech.com),
  CC BY 4.0 <https://creativecommons.org/licenses/by/4.0/>. Files obtained from the
  Internet Archive mirror of his discography
  (`archive.org/details/KevinMacLeod_2019-04_Discography`). Kevin MacLeod's canonical
  license is CC BY — some archive.org mirrors mislabel individual tracks as CC0, so we
  attribute him regardless (compliant either way).
- *Small Town* — **Mr Smith** (Free Music Archive), CC BY 4.0 —
  <https://freemusicarchive.org/music/mr-smith/a-new-roar/small-town/>
- *Strummin' with Robin Smith* — **Beat Mekanik** (Free Music Archive), CC BY 4.0 —
  <https://freemusicarchive.org/music/beat-mekanik/single/strummin-with-robin-smith/>

### ElevenLabs (Eleven Music) — the four original road-trip songs

Generated with **ElevenLabs (Eleven Music)** (original filenames
`ElevenLabs_Acoustic_Countryside_Journey`, `ElevenLabs_The_Wanderer's_Tale`,
`ElevenLabs_Restless_Roads_Ahead`, `ElevenLabs_Seaside_Cafe`; renamed to snake_case for
`require()`).

⚠️ **License = confirm before any paid distribution.** Commercial-use rights for
ElevenLabs-generated music follow the **account's ElevenLabs subscription tier** and have
NOT been verified against the founder's plan. Fine for this toy/dev build; the
clean-licensed tracks above were added specifically so the rotation no longer depends on
this — **the four ElevenLabs files can be removed** from `TRACKS` (in `driveMusic.ts`)
to ship a fully clean-licensed soundtrack.

## How the Pixabay `drive_loop` assets were derived (reproducible)

- `drive_loop.mp3` — loop points chosen by audio-similarity search (the theme recurs
  ~every 55s); cut `7.11s → 62.00s` with a 1s crossfade folding the matched tail into
  the head → seamless, soft entry. Full quality (stereo, no low-pass).
- `intro.mp3` — the track's opening ~5s + a 0.8s out-fade.
- `outro.mp3` — the track's natural ending (~145.5–150.5s) — its own resolve/decay.

The player (`src/lib/driveMusic.ts`) shuffles the rotation, plays a fresh track per leg
between stops, fades each out under a stop's narration, advances gaplessly when a track
ends mid-leg (playlist `loop: 'all'`), and fades out when the tour ends. The full songs
are not seamless loops; the rotation advances between them rather than looping any single
one.
