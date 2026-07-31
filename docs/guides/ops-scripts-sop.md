# Ops-scripts SOP

**Status:** ✅ **ADOPTED 2026-06-10.** Enforced by reuse via `packages/studio/src/pipeline/ops.ts`;
reference implementation = `sweep-orphans.ts`; `resynth-narration.ts` (1:1 narration resynth) and
`rename-roam-prefix.ts` conform to the contract (preview by default, act only on `--apply`). This is
the contract for the studio pipeline's one-off operational CLIs.

## What this covers

The studio pipeline's **one-off ops CLIs** — `packages/studio/src/*.ts` you run by hand via
`dotenvx … bun …` to fix or maintain live data (`sweep-orphans`, `resynth-narration`,
`rename-roam-prefix`, backfills). NOT the generation pipeline itself, and not app/API code.

These touch live, irreversible things — the DB, R2 bytes, and metered TTS/LLM spend (a live regen
burns GCP credits). So they share one safety contract.

⚠ Two sections below are scoped WIDER than that on purpose — "what the checks can't see" and "judging
a paid run" are about interpreting a run's OUTPUT, so they apply to the generation CLIs
(`generate-narrations`, `generate-cluster-narrations`, `enrich-pois`) as much as to the one-offs.
That is where the money is, and where the wrong conclusions have actually been drawn.

## The rules

1. **Declare the blast radius** in the file's header comment, using these labels:
   `READ-ONLY` / `MUTATES DB` / `DELETES BYTES` / `SPENDS $` (note which: TTS/LLM). Combine as
   needed (e.g. `SPENDS $ + MUTATES DB + DELETES BYTES`).
2. **Safe by default.** Anything that mutates the DB, deletes bytes, or spends money **previews
   by default and acts only on `--apply`.** A read-only tool needs no gate. (This is the rule —
   never make "execute" the no-flag default.)
3. **Scope guards.** Confine the blast to a single entity or key prefix (e.g. the sweep only ever
   touches `narration/`). A fan-out (`--all`) combined with `--apply` requires `--yes`.
4. **Use `pipeline/ops.ts`.** Don't re-roll arg parsing, tour resolution, env checks, or the
   preamble — the SOP is enforced by reuse, not prose.
5. **Invocation + env.** Run via `dotenvx run -f .env.development -- bun
   packages/studio/src/<tool>.ts …` (dev) or `-f .env.production --overload` (prod). Never add
   a plaintext `.env`. An `--apply` run asserts its env up front (`assertReady`).
6. **Idempotent + logged + honest exit.** Re-runnable without harm; log per item + a final
   summary; `process.exitCode = 1` on failure (the `main().catch(...)` tail).

## ⚠ The one CLI whose PREVIEW spends

`classify-treatments` breaks rule 2's spirit and it is not a bug: the tool's whole job is to ask the
model how to group a region, so the no-flag run **classifies** (one Opus call per multi-member group,
~$0.82 for 64 groups, plus one per group the duplicate merge fuses) and only the DB WRITE is gated on
`--apply`. There is no way to see the verdicts without paying for them. Budget a preview like an apply,
and get the founder go for either. Every other CLI's preview is genuinely free.

## Corpus hygiene: what the checks CAN'T see

Two verification traps that have each produced a wrong conclusion in practice. Both belong here rather
than in a code comment, because they bite the person reading a run's output.

**1. A presigned R2 URL is signed PER HTTP METHOD.** A `HEAD` against a `presignGet` URL returns 403
on a perfectly healthy object. Check with a ranged `GET` (`curl -r 0-1`), or you will diagnose a
working corpus as entirely broken — this nearly produced a false outage report on 2026-07-30.

**2. A green grounding score means "matches its fact sheet", NOT "is correct".** The fail-closed eval
gate verifies script ↔ sheet, so it is structurally blind to anything outside that pair — most
importantly **where the place actually is**.

The live case (2026-07-30): `UNLV Arboretum` (Q7865354) carries the UNR Arboretum's coordinates, so a
RELEASED clip saying *"…down in Paradise, Nevada"* fired on the Reno campus, 700 km away. Script,
facts and attribution were all correct; only the coordinate was wrong. Worse, every structured signal
agreed with every other and all were wrong — Wikidata `P625`, Wikidata `P131` ("located in" — it also
says Reno), and the Wikipedia article's own coordinates, which inherit from Wikidata. Only the article
PROSE was right. Our import was faithful; the error is upstream, so it is also a contribute-back
candidate.

**So there is no free, deterministic check that can DECIDE this class** — a decisive one has to read
the prose, which means model judgment, and the natural home is the paid `enrich` step where the
article is already in context. Not built; worth doing when `enrich` is next touched.

**What IS free is the triage, and it now runs automatically:**
`pipeline/colocation.ts` flags two DIFFERENT Wikidata items on a **byte-identical** coordinate —
reported by `discover-pois` (on the swept batch, BEFORE anything is written, so a phantom place is
caught before you pay to enrich and narrate it) and by `prune-corpus` (over existing rows, so a
pre-existing one surfaces without a re-sweep). Exact equality, not a radius: genuinely adjacent places
are normal (Harold's Club and Harrah's Reno are 60 m apart) and would flood any proximity rule.

⚠ **It warns, it never excludes.** Measured over Tahoe + Yosemite: 13 collisions, **12 genuine**
(Glacier Point / Glacier Point Hotel, El Capitan / Salathé Wall, Genoa Historic District / Genoa) and
1 real error. Auto-excluding would bury 12 real places to catch 1. Treat a collision as a question:
open both articles and check the stated location against the pin. Adjudicating one (excluding the
wrong row) drops it out of the queue on the next run, so the list shrinks as you work it.

## Judging a paid run: five traps that each produced a wrong conclusion

Same genre as the section above — these bite the person deciding what a run MEANT, not the person
writing the tool. Every one is from the 2026-07-30 corpus regeneration, where three prompt fixes were
shipped correctly and a fourth defect was introduced, diagnosed wrong twice, and finally fixed for
$1.25 after ~$70 of avoidable spend.

**1. Establish REVERSIBILITY before the first `--apply`, not after.** `generate-narrations` overwrites
`narrations.script` in place and there is no history table, so a regeneration cannot be undone — only
fixed forward. That was discovered after 72 clips had been rewritten. Ask it in the same breath as
"what does this cost?", because it decides how you stage: an irreversible op earns a small first batch
and a measured baseline; a reversible one does not.

**2. Capture the baseline BEFORE the intervention.** The tail-collapse rate for the affected places was
2% — learned only after shipping a change that took it to 21%. Had it been measured first, batch 1
would have caught it at six clips instead of 187. A "before" number costs one read-only query.

**3. Never validate a fix on the population it was written to repair.** A closer rule measured 15 → 3
on already-broken clips looked decisive; on fresh generation it was 21% → 17%. A repair population
regresses to the mean and will tell you a weak fix worked. Measure on clips that were fine.

**4. A sample that cannot answer the question should produce no conclusion.** The same metric was
called a catastrophe and then an all-clear, both at n=6. Six clips cannot distinguish 2% from 20%.
"This sample can't tell us" is a valid and cheap answer; two confident opposite readings are not.

**5. Try the CHEAP lever before the expensive one — and check that an inherited finding transfers.**
Tail collapse was treated as a writing problem because a code comment said all three retakes collapse
identically, *therefore the script determines it*. That was measured on FUSED tallies, where a verbless
list has nothing to land on in any take. It does not generalise: a `resynth-narration` pass — same
scripts, TTS re-rolled — cleared 22 of 35 flagged clips for $1.25, i.e. the collapse is largely
stochastic in the synth. Resynth is ~$0.035/clip against ~$0.28 to re-narrate. **Reach for it first**;
regenerating to fix a tail is paying 8× for a re-roll you can buy directly.

⚠ The meta-lesson under 5: a load-bearing conclusion in a comment is evidence about the population it
was measured on. Before building on one, check that yours is the same population.

## The shared helper (`pipeline/ops.ts`)

- `parseFlags(argv, { valueFlags })` → `{ positionals, has(name), value(name) }` — supports
  `--flag`, `--flag=val`, `--flag val`; `valueFlags` keeps a value token from being read as a
  positional (e.g. `generate-narrations`'s `--region`/`--limit`/`--max-cost`).
- `maxCostFlag(flags)` — shared parser for the `--max-cost` cap the discover/enrich/generate CLIs take.
- `assertReady(['r2' | 'tts'])` — throws a clear, actionable message if an `--apply` run's env is
  missing.
- `announce({ tool, blast, apply })` — the loud preamble (`DRY RUN — pass --apply` vs `APPLYING`).

## New ops-script checklist

- [ ] Header comment: one-line usage + **blast-radius label** + what `--apply` needs.
- [ ] `parseFlags` (+ `valueFlags` if any), `announce(...)` first thing in `main`.
- [ ] Default path = preview; gate every mutate/delete/spend behind `apply`.
- [ ] `assertReady([...])` only on the `--apply` branch.
- [ ] Scope confined to one entity/prefix; never act outside it.
- [ ] `main().catch(e => { console.error(...); process.exitCode = 1 })`.
- [ ] Pure decision logic factored out + unit-tested (see `test/ops.test.ts`).

## Conformance

| Tool | Blast radius | Default | Conforms |
| --- | --- | --- | --- |
| `sweep-orphans.ts` | DELETES BYTES | dry-run | ✅ (reference) |
| `resynth-narration.ts` | SPENDS $ + MUTATES DB | dry-run | ✅ |
| `rename-roam-prefix.ts` | MUTATES DB + DELETES BYTES | dry-run | ✅ |
| `snap-speakable-anchors.ts` | MUTATES DB (no spend — OSM) | dry-run | ✅ |
| `prune-corpus.ts` | MUTATES DB; `--delete` DELETES ROWS + cascades | dry-run | ✅ (`--restore`; `--delete` needs `--apply`) |
| `classify-treatments.ts` | SPENDS $ (~$0.8/region) + MUTATES DB | ⚠ preview SPENDS | ⚠ see above — only the WRITE is gated |
| `backfill-poi-extent.ts` | MUTATES DB (no spend — WDQS) | dry-run | ✅ |
