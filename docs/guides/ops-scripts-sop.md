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
| `prune-corpus.ts` | MUTATES DB (flags only; never deletes) | dry-run | ✅ (has `--restore`) |
| `classify-treatments.ts` | SPENDS $ (~$0.7/region) + MUTATES DB | dry-run | ✅ (has `--clear`) |
