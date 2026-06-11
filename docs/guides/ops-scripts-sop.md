# Ops-scripts SOP

**Status:** ✅ **ADOPTED 2026-06-10.** Enforced by reuse via `packages/generator/src/pipeline/ops.ts`;
reference implementation = `sweep-orphans.ts`; `patch-clip.ts` + `resynth-tour.ts` retrofitted to
conform (their old default-execute was flipped to default-preview). This is the contract for the
generator's one-off operational CLIs.

## What this covers

The generator's **one-off ops CLIs** — `packages/generator/src/*.ts` you run by hand via
`dotenvx … bun …` to fix or maintain live data (`sweep-orphans`, `patch-clip`, `resynth-tour`,
backfills). NOT the generation pipeline itself, and not app/API code.

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
   touches `clips/<tourId>/`). A fan-out (`--all`) combined with `--apply` requires `--yes`.
4. **Use `pipeline/ops.ts`.** Don't re-roll arg parsing, tour resolution, env checks, or the
   preamble — the SOP is enforced by reuse, not prose.
5. **Invocation + env.** Run via `dotenvx run -f .env.development -- bun
   packages/generator/src/<tool>.ts …` (dev) or `-f .env.production --overload` (prod). Never add
   a plaintext `.env`. An `--apply` run asserts its env up front (`assertReady`).
6. **Idempotent + logged + honest exit.** Re-runnable without harm; log per item + a final
   summary; `process.exitCode = 1` on failure (the `main().catch(...)` tail).

## The shared helper (`pipeline/ops.ts`)

- `parseFlags(argv, { valueFlags })` → `{ positionals, has(name), value(name) }` — supports
  `--flag`, `--flag=val`, `--flag val`; `valueFlags` keeps a value token from being read as a
  positional (e.g. `patch-clip`'s `--find`/`--replace`).
- `resolveTourId(arg)` — full id or unique id prefix.
- `assertReady(['r2' | 'tts'])` — throws a clear, actionable message if an `--apply` run's env is
  missing.
- `announce({ tool, blast, apply })` — the loud preamble (`DRY RUN — pass --apply` vs `APPLYING`).
- `guardFanout({ all, apply, yes })` — enforces rule 3's `--all --apply` → `--yes`.

## New ops-script checklist

- [ ] Header comment: one-line usage + **blast-radius label** + what `--apply` needs.
- [ ] `parseFlags` (+ `valueFlags` if any), `announce(...)` first thing in `main`.
- [ ] Default path = preview; gate every mutate/delete/spend behind `apply`.
- [ ] `assertReady([...])` only on the `--apply` branch; `guardFanout` if it supports `--all`.
- [ ] Scope confined to one entity/prefix; never act outside it.
- [ ] `main().catch(e => { console.error(...); process.exitCode = 1 })`.
- [ ] Pure decision logic factored out + unit-tested (see `test/ops.test.ts`).

## Conformance

| Tool | Blast radius | Default | Conforms |
| --- | --- | --- | --- |
| `sweep-orphans.ts` | DELETES BYTES | dry-run | ✅ (reference) |
| `patch-clip.ts` | SPENDS $ + MUTATES DB | dry-run | ✅ (retrofit 2026-06-10) |
| `resynth-tour.ts` | SPENDS $ + MUTATES DB + DELETES BYTES | dry-run | ✅ (retrofit 2026-06-10) |
