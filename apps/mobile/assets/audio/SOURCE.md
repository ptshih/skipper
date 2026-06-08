# Tour audio assets

The drive soundtrack is a **shuffled rotation** (`src/lib/driveMusic.ts`): a fresh
track fades in for each leg between stops, ducking out under narration. All five
tracks below are in the rotation.

**`drive_loop.mp3`** — the original seamless ~55s driving bed. **In rotation.**
**`acoustic_countryside_journey.mp3`** — road-trip song (~2:46). **In rotation.**
**`wanderers_tale.mp3`** — road-trip song (~2:20). **In rotation.**
**`restless_roads_ahead.mp3`** — road-trip song (~2:37). **In rotation.**
**`seaside_cafe.mp3`** — road-trip song (~1:34). **In rotation.**
**`intro.mp3`** — tour-start sting. **Staged, not wired** (founder deferred intro/outro).
**`outro.mp3`** — tour-end sting. **Staged, not wired** (founder deferred intro/outro).

## Source & license

### `drive_loop.mp3` / `intro.mp3` / `outro.mp3` — Pixabay

Derived from **"Sentimental Acoustic Guitar & Piano"** (uploader: *music_for_videos*),
downloaded from Pixabay:
<https://pixabay.com/music/acoustic-group-sentimental-acoustic-guitar-amp-piano-145041/>

License: **Pixabay Content License** — free for commercial use, **no attribution
required**, editing/looping allowed. (Constraint: don't redistribute the bare audio
file standalone; bundling it under the app/narration is a "larger work" and fine.)
This credit is kept for our records, not because the license requires it.

### The four road-trip songs — ElevenLabs (Eleven Music)

Generated with **ElevenLabs (Eleven Music)** and exported as 192 kbps stereo MP3
(original filenames `ElevenLabs_Acoustic_Countryside_Journey`,
`ElevenLabs_The_Wanderer's_Tale`, `ElevenLabs_Restless_Roads_Ahead`,
`ElevenLabs_Seaside_Cafe`; renamed to snake_case for `require()`).

⚠️ **License = confirm before any paid distribution.** Commercial-use rights for
ElevenLabs-generated music follow the **account's ElevenLabs subscription tier**
(free tier generally requires attribution / restricts commercial use; paid tiers
grant broader rights) — this has NOT been verified against the founder's plan.
Fine for this toy/dev build; re-check the active plan's terms before shipping a
paid product. (Consistent with the repo's attribution-conscious culture — recorded
so the next agent can re-check.)

## How the Pixabay assets were derived (reproducible)

- `drive_loop.mp3` — loop points chosen by audio-similarity search (the theme recurs
  ~every 55s); cut `7.11s → 62.00s` with a 1s crossfade folding the matched tail into
  the head → seamless, soft entry. Full quality (stereo, no low-pass).
- `intro.mp3` — the track's opening ~5s + a 0.8s out-fade.
- `outro.mp3` — the track's natural ending (~145.5–150.5s) — its own resolve/decay.

The player (`src/lib/driveMusic.ts`) shuffles the five rotation tracks, plays a fresh
one per leg between stops, fades each out under a stop's narration, advances gaplessly
when a track ends mid-leg (playlist `loop: 'all'`), and fades out when the tour ends.
The ElevenLabs songs are full tracks (not seamless loops); the rotation advances
between them rather than looping any single one.
