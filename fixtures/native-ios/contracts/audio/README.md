# Synthetic create-flow audio

`create-continuity.m4a` is 250 ms of generated silence: AAC-LC, mono, 24 kHz,
798 bytes. It contains no recording, voice, copyrighted sample, or rider data.

SHA-256: `7c31c2b7f339f8d4328a76efcb39a48a833a6c7614ce682c76adbaf895503b05`.

Generated with the locally installed FFmpeg using:

```sh
ffmpeg -nostdin -hide_banner -loglevel error -n -f lavfi \
  -i anullsrc=r=24000:cl=mono -t 0.25 -c:a aac -b:a 32k \
  -fflags +bitexact -flags:a +bitexact -map_metadata -1 -movflags +faststart \
  fixtures/native-ios/contracts/audio/create-continuity.m4a
```

FFprobe confirms codec/profile, duration and sample rate; a complete FFmpeg decode
to the null sink succeeds. These checks validate the file, not app playback.
Retain the checked-in bytes/hash rather than regenerating them during tests.

Only `planner-account-retry` and `planner-account-lost-ack` may download this asset,
from the exact synthetic URL `https://fixture.invalid/native-ios/create-continuity.m4a`.
The DEBUG downloader returns bundled local bytes and rejects every other request;
it has no network fallback. Production Storage performs the write/manifest commit.
Tests must never preseed the canonical drive or manifest to satisfy persistence.
