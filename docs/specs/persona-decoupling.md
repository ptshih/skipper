# Persona decoupling from region

**Status:** BUILT — 2026-06-13

> **Built 2026-06-13.** `tours.persona_key` added (migration `0003_sticky_the_spike`, default
> `'skipper'`). `personaForRegion` deleted and replaced by `personaFromKey` (the `PERSONAS` map is
> now keyed by persona key, not region slug). The blast radius was wider than the original
> generate.ts-only framing: every caller was re-pointed — tour ops (`patch-clip`, `resynth-tour`)
> read `tours.persona_key`; roam/eval ops (`generate-narrations`, `resynth-narration`, `eval/run`) use
> `'skipper'` (single persona in M1). The CLAUDE.md hard invariant ("none of persona/voice/notch is
> a stored `tours` column") was amended: persona is now the one stored column (a *selector*; the
> definition still lives in `personas` + frozen on `segments.persona_id`). No persona picker UI —
> the admin create flow wires `personaKey: 'skipper'` explicitly. Follow-up for M4: eval artifacts
> don't yet carry a persona key, so `eval/run` hardcodes `'skipper'`; when named hosts ship, thread
> the key onto the artifact so the offline auditor mirrors the live persona.

## Problem

`personaForRegion(regionSlug)` in `generate.ts:272` derives the persona at generation time from
the region slug. This means the persona is implicit and coupled to region identity, contradicting
the CLAUDE.md principle that persona is "decoupled from region." If two regions ever share a
persona, or one region gets multiple personas, this breaks silently.

The data model is already correct: `segments.persona_id` freezes the persona on each segment at
generation time. The problem is only in the *authoring path*: how the generator picks a persona
for a brand-new tour.

## Goal

Persona becomes an **explicit column on `tours`** (`persona_key`), set when the tour is created
in the admin. The generator reads `shell.personaKey` directly. `personaForRegion` is deleted.

With one persona today the UX is invisible (it just defaults to `'skipper'`). The plumbing is
correct for M4 when named hosts arrive.

## Changes — implement in this order

### 1. DB schema: add `personaKey` to `tours`

`packages/db/src/schema.ts` — in the `tours` pgTable, after the `slug` column:

```ts
personaKey: text('persona_key').notNull().default('skipper'),
```

Then run:
```
bun run db:generate
bun run db:migrate
```

This is a destructive-OK migration (CLAUDE.md). Existing rows get `'skipper'` as default —
correct, since the Skipper is the only persona.

### 2. Persona index: rename resolver, delete region coupling

`packages/generator/src/persona/index.ts`:

- Add `personaFromKey(key: string): PersonaDef` — a simple lookup with SKIPPER fallback.
- Delete `personaForRegion` entirely (or gut it to a thin wrapper if anything still imports it,
  but prefer hard delete to force callers to update).

```ts
export const personaFromKey = (key: string): PersonaDef => PERSONAS[key] ?? SKIPPER
```

Remove the `personaForRegion` export.

### 3. Generator shell: add `personaKey` to `TourShell`, SELECT it in `loadTour`

`packages/generator/src/pipeline/persist.ts`:

- Add `personaKey: string` to the `TourShell` interface (after `regionSlug`).
- In `loadTour`'s `.select({...})` object add `personaKey: tours.personaKey`.

### 4. Generator pipeline: stop calling `personaForRegion`

`packages/generator/src/pipeline/generate.ts`:

- Change the import: replace `personaForRegion` with `personaFromKey`.
- Line 272: `const persona = personaForRegion(shell.regionSlug)` →
  `const persona = personaFromKey(shell.personaKey)`.

No other changes to `generate.ts` — the `persona` variable flows through unchanged.

### 5. Admin server: accept and store `personaKey` on create

`apps/admin/server/create-tour.ts` — in `freezeTour`:

- Read `raw.personaKey` (default `'skipper'`), validate it's a non-empty string.
- Pass it to the `db.insert(tours).values({...})` block as `personaKey`.

```ts
const personaKey = typeof raw.personaKey === 'string' && raw.personaKey.trim()
  ? raw.personaKey.trim()
  : 'skipper'
// ... in the insert values:
personaKey,
```

No validation against the PERSONAS map needed here — the generator will fall back to SKIPPER for
an unknown key, same as today.

### 6. Admin client: wire the default (no UI change yet)

`apps/admin/client/src/views/CreateTourView.tsx`:

In the `api.createTour(body)` call, include `personaKey: 'skipper'` in the body. No persona
picker UI yet — that's M4 when named hosts arrive. Just make the plumbing explicit.

### 7. Verify

```
bun run check
```

Must pass green. Also confirm `personaForRegion` has zero remaining usages:
```
grep -r "personaForRegion" packages/ apps/ --include="*.ts"
```

## What NOT to do

- Do **not** add a persona picker UI — just wire the default.
- Do **not** change how `segments.persona_id` is written — `resolvePersonaId(persona.personaKey)`
  in `persist.ts` already handles that and is correct.
- Do **not** touch the eval or test files unless typecheck forces it.
- Do **not** change the `personas` table — it already stores persona data correctly.
