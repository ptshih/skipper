# "This tour is sponsored by…" — an AI-voiced sponsor read in the intro

> **Status:** idea, pre-spec — post-MVP; lowest-priority of the monetization ideas (the one most in
> tension with the toy-lens). Needs a real sponsor; the intro/outro framing it rides on is the
> `asides` table (region/persona-owned intro/outro + clock beats), currently EMPTY/unpopulated.
> Captured 2026-06-08; extracted from CLAUDE.md 2026-06-09.

The podcast/YouTube host-read ad, in the skipper's voice: a short, in-character sponsor
spot baked into the **intro bracket** (the `asides` intro beat, where the
skipper introduces the drive), never mid-stop. The charm bet is that a corny tour guide doing a
corny sponsor read is *part of the bit*, not an interruption — same instinct as the tip jar (a corny
guide works for tips; a corny guide can also do a wink-wink ad read).

What it stresses:

- **Ads are EXTRACTION; the tip jar is DELIGHT — opposite ends of the toy-lens.** The
  whole project optimizes for charm over scale ("the persona is the product"), so this
  is the riskiest monetization idea here: an ad that reads as a toll poisons the charm.
  It only works if it stays warm, short, in-persona, skippable, and front-loaded into
  the intro (never gating or interrupting the drive). If it can't be charming, don't ship it.
- **Sponsor copy is DELIVERY, never FACTS.** The skipper voices the read in-character,
  but the sponsor's claims are NOT grounded narration — they must never leak into or
  contaminate the fact-grounded story stops. Keep the ad isolated to the bracket; the
  "persona lives in DELIVERY, never in FACTS" wall applies (a sponsor read is pure delivery).
- **A new generation input + a per-tour bracket variant.** Like persona/joke-level, a
  sponsor is a per-tour generation parameter (an intro-bracket overlay), not a cache key
  — narration is tour-owned, so a sponsored intro is just a different bracket generation.
  Needs sponsor name + a short brief the skipper riffs on (in the persona's idiom), then
  re-synth that one bracket clip (cf. `resynth-narration`).
- **Voice continuity + the same TTS path.** Reuses the existing Charon voice and the
  AAC `.m4a` synthesis (Gemini-TTS + ffmpeg loudnorm) — the ad is one more bracket clip, so the skipper sounds
  continuous from sponsor read into the drive.
- **Sequencing:** post-MVP; the intro-bracket infra exists (the `asides` table) but is currently
  EMPTY/unpopulated, so the remaining prerequisites are populating that flavor + a REAL sponsor + the charm read working. Pairs with — but is distinct
  from — the tip-jar/billing work. Explore only if the charm read works.
