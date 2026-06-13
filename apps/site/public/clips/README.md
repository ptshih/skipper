# Landing-page audio — the hero clip

The home hero's primary action is **"Hear the Skipper"** — a real, ungated ~20-second
MP3 that plays inline (no app, no account). The whole page bets on this one clip making
a stranger smile, so per the no-fake-metrics posture it must be a **real generated clip**,
not a mock.

## To go live

Drop a founder-blessed clip here:

```
apps/site/public/clips/skipper-hero.mp3
```

It's wired in `src/components/sections/Hero.astro` (`HERO_CLIP = '/clips/skipper-hero.mp3'`).
If the file is missing, the player degrades gracefully to a charming **"warming up — clip
lands at launch"** state, so the page is never broken pre-clip.

Recommended: ~20 s, the Emerald Bay overlook telling (the stop named in the hero caption).
Keep it MP3 (the generator already outputs 32 kbps MP3); ≤ ~150 KB at that bitrate. Audio
in R2 is presigned/private, so **export a copy** of the blessed clip and commit it here as a
public static asset — don't link a short-TTL presigned URL.

If you change which stop the clip is from, update `HERO_STOP` / the caption in `Hero.astro`
to match (honesty: the caption names the real place).

## Related go-live switch — the launch list

The closing CTA captures emails. It's wired in `src/components/sections/FinalCta.astro`:
set `LAUNCH_ENDPOINT` to your provider's form-POST URL (Buttondown / ConvertKit /
Formspree — all accept an `email` field). Until then it falls back to a `mailto:` compose
to `CONTACT_EMAIL` (default `hello@skipper.fm`), so the button is never dead.
