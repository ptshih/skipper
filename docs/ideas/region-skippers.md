# Region-specific skipper identities — a different host per region

> **Status:** idea, pre-spec — needs breadth to matter (M4, multiple regions); pairs with the region
> expansion. The underlying registries are BUILT (generation: `PersonaDef`, commit `687c885`;
> presentation: `apps/api/src/host.ts`). Captured 2026-06-08; extracted from CLAUDE.md 2026-06-09.

The Tahoe skipper is not the Yosemite skipper: each region gets a named guide with its own persona,
backstory, and (optionally) voice — variations on the deadpan pun-machine DNA, not a
different species (keep the founder's road-trip-guide heart). The payoff to the new
region browse axis: picking "Yosemite" in the "Where to?" picker introduces you to the
Yosemite skipper. "The persona is the product," applied per region — a charm multiplier.

What it stresses:

- **Region is a per-tour generation parameter, not a cache key.** Since narration is
  tour-owned (no content cache), a per-region persona/voice/prompt-overlay is just a
  different generation input per tour — each region generates its own content, no schema fight.
- **A region skipper can SOUND different.** Each `PersonaDef`
  (`packages/generator/src/persona/`, resolved per-tour by `personaForRegion(slug)`) carries its
  own `voice` (skipper → Charon), so a Yosemite skipper just sets a different Gemini-TTS voice on
  its def. Tune + ear-judge per region (the voice gate is already per-region).
- **The generation persona is a per-region `PersonaDef`** (registry BUILT, commit `687c885`):
  system + bracket prompt, voice, TTS style, and the personal KIT, resolved by region slug. The
  KIT is SINGLE-SOURCED on `PersonaDef.kit` and read by BOTH the diversity lint and
  `generate.ts` — there are no duplicated `lint.ts`/`generate.ts` kit regexes to keep in sync
  (that silent-drift footgun is closed). Still TODO for a 2nd region: factor the prompt into a
  base skipper layer + a per-region overlay (backstory, regional idioms) so the shared grounding
  rules stay single-sourced.
- **Backstory is DELIVERY, never FACTS.** An ex-ski-bum-mechanic Tahoe skipper vs. a
  grizzled-climber Yosemite skipper colors the jokes and asides — it must NEVER invent
  regional history. Same rule as "Ask the Skipper": don't let "backstory" become an
  ungrounded-fact backdoor.
- **A "meet your skipper" surface.** Name, rig, one-line backstory — pairs with the
  deferred enamel-badge / passport ornament and the region picker (the location filter).
- **Sequencing:** needs breadth to matter (M4, multiple regions) — pairs with the region
  expansion; each new region = persona tuning + a voice judged by ear (that per-region
  content cost IS the charm-per-region multiplier).
