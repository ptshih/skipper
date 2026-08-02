# Landing-page audio — the hero clip

The home hero's primary action is **"Hear the Skipper"** — a real, ungated ~20-second
MP3 that plays inline (no app, no account). The whole page bets on this one clip making
a stranger smile, so per the no-fake-metrics posture it must be a **real generated clip**,
not a mock.

## The live clip

The live hero clip is **present**:

```
apps/site/public/clips/skipper-hero.mp3
```

It's wired in `src/components/sections/Hero.astro` (`HERO_CLIP = '/clips/skipper-hero.mp3'`).
To rebless or replace it, drop a new founder-blessed clip at that same path. If the file is
ever missing, the player degrades gracefully to a charming **"warming up — clip lands at
launch"** state, so the page is never broken.

Recommended: ~20 s, the Emerald Bay overlook telling (the stop named in the hero caption);
≤ ~150 KB. Keep it **MP3** for maximum browser compatibility as a static web asset — the
studio pipeline now emits AAC-LC `.m4a`, so transcode the blessed clip to MP3 before
committing it here. Audio in R2 is presigned/private, so **export a copy** and commit it as a
public static asset — don't link a short-TTL presigned URL.

If you change which stop the clip is from, update `HERO_STOP` / the caption in `Hero.astro`
to match (honesty: the caption names the real place).

## Related go-live switch — the App Store link

The closing section shows a quiet **"Coming soon to the App Store"** badge until the app
ships. It's wired in `src/components/sections/FinalCta.astro`: set `APP_STORE_URL` to the
live App Store listing and the badge becomes a real **"Download on the App Store"** button.
Per Apple's marketing guidelines, swap the placeholder glyph for the official Apple-provided
badge artwork when you do.
