# Cut the joke notch — v2 ships one delivery voice; variety comes from different narrators

> **Status:** DECIDED + DONE 2026-06-19. `jokeLevel` removed everywhere — the `off`/`mild`/`dad`/`dadpocalypse`
> Zod enum, the `createDriveRequest.jokeLevel` wire field, the `NarrationRequest.jokeLevel` input, the
> hardcoded value in `generate-narrations.ts`, and the whole "Dad-Joke-O-Meter" ladder + OFF/MILD/DAD
> calibration clips in the Skipper system prompt. Supersedes the prior "notch is deferred vocabulary,
> returns as a per-drive setting at M3" stance (CLAUDE.md persona invariant + Milestone 3 + the
> `jokeLevel` enum doc, all updated in this change). Not committed/pushed as of writing.

## What

There is now ONE delivery voice — the corny telling formerly called the `dadpocalypse` notch. The
generation pipeline no longer takes a notch parameter; the system prompt teaches a single voice; and
`jokeLevel` is gone from `@skipper/shared` (enum + type), the create-drive wire DTO, the studio
narration request, and the eval/charm judge prose.

## Why

1. **The dormant ladder was actively degrading live output, not just sitting idle.** An adversarial pass
   on the prompt (find → verify, 2026-06-19) showed the OFF/MILD/DAD example clips — all of which open
   "Up at the head of the bay there is a house called Vikingsholm" — were teaching the *dadpocalypse*
   generator to open every clip the same way. Few-shot examples template behavior across the whole
   system prompt; they do not compartmentalize by the active notch. So the non-shipped notches' examples
   leaked into the only voice we ship.
2. **It's the highest-leverage file; keep it about the voice you ship.** The Dad-Joke-O-Meter section +
   ladder + three OFF/MILD/DAD clips were ~a quarter of the prompt, all dormant. Cutting them makes every
   example in the prompt the actual shipped voice and leaves more room to iterate on that voice.
3. **The notch was never wired live.** The live path (`generate-narrations.ts` `gateClip`) hardcoded
   `dadpocalypse`; drives REUSE pre-generated roam clips (no notch at drive time); the mobile app has no
   notch picker and never sent the optional `createDriveRequest.jokeLevel`; there is no `joke_level` DB
   column. So a stored/parameterized notch carried no information today.
4. **Charm over scale.** A per-clip corniness dial is a scale-shaped knob. The product bet is "the persona
   is the product" — so delivery variety should come from *characters*, not a slider.

## The forward path (replaces the notch as the variation axis)

Delivery variation returns as **different NARRATORS**, not a corniness notch. A second host is a new
`PersonaDef` (its own system prompt, voice, fixed corniness) resolved by a per-narration persona key —
the region-skippers direction already sketched for M4 (`personaFromKey`, the `personas` registry). A
narrator achieves what a notch did (a different *telling* of the same grounded facts) but as a coherent
character a rider can choose, and it composes with region identity. This is strictly additive when it
lands: a persona key on `narrations`, no notch enum.

If a "play it straighter" mode is ever wanted, it is a *different narrator* (a sincere host), authored
and judged as its own voice — not a frequency setting on the corny one.

## Wire-contract note

`jokeLevel` was an `.optional()` field on `createDriveRequest` (`POST /drives`). Removing it is safe even
under the "evolve the wire contract additively" posture: it was optional, the only client (mobile) never
sent it, the route handler never read it, and V1 never shipped. A future client sending it has the key
silently stripped by the non-strict Zod object.
