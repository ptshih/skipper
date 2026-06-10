# docs/ — the project's durable records

How truth is managed in this repo. Four layers; each fact lives in exactly ONE of them:

| Layer | Where | What |
| --- | --- | --- |
| **Operating truth** (now) | `/CLAUDE.md` | doctrine, hard invariants, stack, workflow — only what an agent must know to avoid breaking something or burning money |
| **Engineering backlog** (near-term) | `/TODO.md` | actionable items with enough context to act on; DELETE items when done (git history is the archive) |
| **Durable records** (history + future) | `docs/` | everything below |
| **Code** (the rest of now) | the repo | if a doc and the code disagree, the code wins — fix the doc |

## The folders

- **`decisions/`** — dated decision records + spike results: *why things are the way they are.*
  Append-only history: revise by adding a dated addendum or a new record with a `Superseded by:`
  pointer — never silently rewrite a decision's rationale.
- **`specs/`** — build-ready designs for features (mostly unbuilt): *concrete future truth.* When a
  spec ships, flip its status line to shipped/built in place — the file does not move.
- **`ideas/`** — pre-spec product ideas with their charm rationale: *fuzzy future truth.* Promotion
  path: idea → spec → built.
- **`research/`** — competitive/external studies: *reference.* Inputs to decisions, not commitments.
- **`guides/`** — operational how-tos (EAS builds, etc.).

## Conventions

1. **Folders are by KIND; the status line is by STATE.** Every doc opens with a short dated
   status note under its title — what it is, whether it's built/unbuilt/superseded, and where it
   points if so. A doc never changes folders when its state changes; ship a spec and you flip its
   status line, not its path.
2. **Code wins.** Line numbers, tour ids, and column names in docs go stale; the status line should
   warn about known drift rather than pretend currency.
3. **Handoffs are ephemeral.** Agent-to-agent baton docs (the old `*-handoff.md` files) don't live
   here — they're deleted once consumed; cross-session continuity lives in agent memory, durable
   rationale lives in `decisions/`.
4. **CLAUDE.md stays lean.** It gets a paragraph only when violating it breaks an invariant or burns
   money. When something there is superseded, DELETE it and record the history in the relevant
   decision record — no strikethrough graveyards.
5. **Enforced, not aspirational.** `scripts/lint-docs.ts` (`bun run lint:docs`, first step of root
   `bun run check`, auto-run by a project hook on docs edits) fails on: a file loose at `docs/`
   root or in an unknown folder, a doc without a `**Status**` line in its first 12 lines, any
   `*-handoff.md` under `docs/`, any bare `docs/<file>.md` path reference anywhere in the repo,
   and CLAUDE.md exceeding its line ceiling. Status SEMANTICS (does the line match reality?) can't
   be linted — flip statuses in the same commit as the change (CLAUDE.md → Git workflow).

## Index

### decisions/
- [tour-data-model-zero-reuse.md](decisions/tour-data-model-zero-reuse.md) — **the canonical entity
  model** (shared facts on `pois`, tour-owned narration on `tour_stops`, zero content reuse); built +
  live-migrated 2026-06-08.
- [tour-structure-design-review.md](decisions/tour-structure-design-review.md) — adversarial
  pre-build review of the tour-structure spec (verdict: build-with-fixes); historical.
- [audio-compression-spike.md](decisions/audio-compression-spike.md) — WAV → MP3 32 kbps spike;
  shipped 2026-06-08.
- [enrichment-scout.md](decisions/enrichment-scout.md) — story-stop enrichment decided by a
  bounded tool-using scout (judgment) instead of char-count sparse-gates; built 2026-06-09.
- [fact-overrides-and-veracity.md](decisions/fact-overrides-and-veracity.md) — the
  upstream-source-error loop (`poi_overrides` corrections + the web-checking `--veracity`
  eval) and the durable eval record (`eval_runs`/`eval_scores`); built 2026-06-09.

### specs/
- [ask-the-skipper-spec.md](specs/ask-the-skipper-spec.md) — live, grounded voice Q&A mid-drive (the
  north-star delighter); build-ready, unbuilt, post-MVP.
- [gps-player-spec.md](specs/gps-player-spec.md) — the M1 live GPS phone player; mostly built
  (remaining: duck flip + the real drive).
- [tour-structure-spec.md](specs/tour-structure-spec.md) — intro/outro brackets + quality-gated
  narration; §3/§4 built, data-model half superseded by zero-reuse.
- [downtime-callouts-spec.md](specs/downtime-callouts-spec.md) — persona-only beats in the quiet
  stretches (the "dead air" answer); unbuilt.
- [tell-me-more-spec.md](specs/tell-me-more-spec.md) — pre-generated deeper-cut B-side per story
  stop; unbuilt.
- [replay-last-stop-spec.md](specs/replay-last-stop-spec.md) — one-tap re-hear of the last stop;
  unbuilt, cheap, player-only.
- [skipper-opinions-spec.md](specs/skipper-opinions-spec.md) — opinionated asides ("the world off
  the rails"); unbuilt, builds on downtime-callouts.
- [drive-thesis-spec.md](specs/drive-thesis-spec.md) — the drive's through-idea (the keystone:
  plant in intro → evidence in stops → land at the payoff); unbuilt, generation-only.
- [scenic-stops-spec.md](specs/scenic-stops-spec.md) — deliberately adding scenic stops; unblocked
  but partially overtaken by the pacing rework — re-ground before building.

### ideas/
- [journey-layer.md](ideas/journey-layer.md) — **the north-star vision**: Skipper as the
  entertainment/meaning layer of the journey (the self-driving age) + "any road, anywhere, generated
  live" — the demand and supply of one endgame the feature-ideas below ladder toward. Direction, not
  commitment.

The rest are post-MVP features, gated behind the proven phone player:
- [drive-complete-moment.md](ideas/drive-complete-moment.md) — the payoff beat as motion + sound
  (the stage the next two plug into).
- [tip-the-skipper.md](ideas/tip-the-skipper.md) — end-of-tour tip jar (IAP; delight, not extraction).
- [sponsor-read.md](ideas/sponsor-read.md) — in-character intro-bracket sponsor spot (riskiest vs
  the toy lens).
- [region-skippers.md](ideas/region-skippers.md) — a different named host per region (M4).
- [passport-logbook.md](ideas/passport-logbook.md) — stamps + the skipper's logbook souvenir layer.

### research/
- [competitive-research.md](research/competitive-research.md) — multi-agent cited research across
  the category (2026-06-07).
- [shaka-guide-ux-study.md](research/shaka-guide-ux-study.md) — teardown of THE reference comp.
- [competitor-ux-studies.md](research/competitor-ux-studies.md) — GuideAlong / Autio / VoiceMap +
  the 4-for-4 "dead air" cross-comp finding.

### guides/
- [eas-setup.md](guides/eas-setup.md) — building + running the Expo app on EAS (dev build).
