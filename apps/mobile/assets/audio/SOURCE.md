# Tour audio assets

**`drive_loop.mp3`** — the between-stops driving soundtrack (seamless ~55s loop).
**`intro.mp3`** — tour-start sting (staged; not wired into the player yet).
**`outro.mp3`** — tour-end sting.

## Source & license

Derived from **"Sentimental Acoustic Guitar & Piano"** (uploader: *music_for_videos*),
downloaded from Pixabay:
<https://pixabay.com/music/acoustic-group-sentimental-acoustic-guitar-amp-piano-145041/>

License: **Pixabay Content License** — free for commercial use, **no attribution
required**, editing/looping allowed. (Constraint: don't redistribute the bare audio
file standalone; bundling it under the app/narration is a "larger work" and fine.)
This credit is kept for our records, not because the license requires it.

## How they were derived (reproducible)

- `drive_loop.mp3` — loop points chosen by audio-similarity search (the theme recurs
  ~every 55s); cut `7.11s → 62.00s` with a 1s crossfade folding the matched tail into
  the head → seamless, soft entry. Full quality (stereo, no low-pass).
- `intro.mp3` — the track's opening ~5s + a 0.8s out-fade.
- `outro.mp3` — the track's natural ending (~145.5–150.5s) — its own resolve/decay.

The player (`src/lib/driveMusic.ts`) loops `drive_loop` between stops, fades it out
under each stop's narration, and plays `outro` once at the end.
