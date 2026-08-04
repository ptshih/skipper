# A b-side gets its own table — `narrations_poi_uq` is NOT loosened

> **Status:** DECIDED 2026-08-03 (founder), NOT BUILT. Supersedes
> [tell-me-more-spec](../designs/tell-me-more-spec.md) §3, which recommended the opposite (relax the
> uniqueness to `UNIQUE(poi_id, form)` and let a b-side be a second `narrations` row). No schema and no
> migration exist yet — deliberately; see "Why not build it now" below.

## What

The "Tell me more" deeper cut ([tell-me-more-spec](../designs/tell-me-more-spec.md)) does **not** land in
`narrations`. It gets its **own table**, anchored to a **poi XOR a cluster** the way `narrations` is —
not to a `narrations.id`.

`narrations_poi_uq` (UNIQUE `poi_id`) and `narrations_cluster_uq` (UNIQUE `cluster_id`) stay exactly as
they are. **One telling per place remains true.**

## Why

1. **The one-telling-per-place rule is LOAD-BEARING, and loosening it is not a schema change — it is an
   audit of every reader.** Every query that resolves "the telling for this place" is correct today only
   because the constraint guarantees one row. Loosening it silently changes what each of them returns
   unless every one is updated to name the form it wants. The readers are not few: the drive corpus
   loaders in `apps/api/src/drives.ts` (including the one that resolves a rider's FROZEN selection), the
   admin console in several places, and `resynth-narration.ts`. The failure mode is not a crash — it is a
   rider rolling past Vikingsholm and hearing the deep cut instead of the introduction, on a drive they
   paid a non-refundable credit for. A constraint that prevents that is worth more than the row it saves.

2. **The precedent already exists and points here.** Break audio is NOT a `narrations` row — it lives
   1:1 in the place-anchored `detours` table, and CLAUDE.md states that as an invariant. Same situation,
   same shape: a different KIND of audio attached to a place gets its own home instead of contending for
   the one-telling slot. ⚠ Note `detours` anchors to `place_id` **directly**, not to another audio row —
   which is why anchoring the b-side to its SUBJECT rather than to its main telling is the consistent
   choice, and the `narration_id` variant would have been the novel one.

3. **A b-side is about a PLACE, not about a row.** It is grounded in the same fact sheet, and it would
   still be the right deeper cut if the main telling were rewritten. Coupling it to a row's identity
   models something narrower than what it is.

4. **It is ADDITIVE.** A new table touches no existing data, so this does not trip the destructive-change
   gate (snapshot-before-destructive-work). That is a real and deliberate consequence of the choice, not
   a happy accident — the same feature via `UNIQUE(poi_id, form)` would have altered a live constraint on
   the whole released corpus, in a database that has no staging copy. (This read "458 released clips"
   when it was written on 2026-08-03; the scenic tier released 309 more the same day. Count it, don't
   quote it — that is exactly why the number is gone from this sentence.)

## What it must carry (none of these optional)

- **`attribution`** — a b-side is fact-grounded, and Wikipedia is CC BY-SA. Shipping derived audio with
  no credit is a licence violation, so this is a legal floor, mirrored from the
  `narrations_story_attribution` CHECK rather than left to the writer.
- **`facts_hash`** — it grounds on the same sheet as the main telling, so a re-fetch that materially
  changes the facts makes it stale exactly as it does the main clip. Without this, a renamed or corrected
  place keeps a stale deeper cut forever. (`detours` needs neither of these — a break bakes no facts — so
  this table is NOT a pure copy of that pattern.)
- **`released_at`** — the region release gate applies. Release is MONOTONIC; a regen never clears it.
- **The subject XOR** — exactly one of `poi_id` / `cluster_id`, as a CHECK, not a convention.

## The cost, accepted with open eyes

The exactly-one-subject rule now exists in **two** tables, and "two copies of the same set drifting" is
this repo's most-repeated bug class. The mitigation is not care, it is a **test that pins BOTH tables'
XOR behaviour in one place**, so a change to one that skips the other fails. Write that test with the
table, not after.

## Open, and owed before anyone builds this

- **The `'bside'` value in `narrationFormEnum`.** It was reserved for the rejected same-table design and
  now has no home. Either retire it as reserved vocabulary (the `'wave'` precedent —
  [cut-wave-form](cut-wave-form.md)) or make it the new table's own form marker. Pick one; leaving a live
  enum value that nothing can legally hold is how the next agent re-derives the rejected design.
- **Does a b-side ride the fused-cluster path at all?** The XOR makes it *possible*; nobody has decided
  whether a fused telling should have one. Decide deliberately — a change that serves solo places and is
  silently blind to clusters is a documented failure pattern here.

## Why not build it now

Nothing writes a b-side yet: generation exists (`narrateDeeperCut` + `generate-bside-narrations.ts`) but
persists nothing, and the corpus run is an unspent operator paid run. An empty table with no writer is
exactly the shape of the "constant with no production reader" trap this repo keeps hitting. Create it in
the same change that first writes to it.

⚠ When that happens: `db:generate` PROMPTS on renames and needs a real TTY, so a piped/non-TTY run errors
out and reads as a broken migration step. A brand-new table involves no rename, so it should not prompt —
but the founder runs it in a terminal either way.
