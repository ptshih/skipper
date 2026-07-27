# Cut the WAVE form — v2 ships without the scenic tier's passing call-out

> **Status:** DECIDED + DONE 2026-07-26 (founder). The WAVE form is backed out of the tree ahead of the
> v2 release. Built 2026-07-24 (`fd2df45`, `81f6ca5`) and smoke-tested twice, but **never run at scale**:
> zero `form='wave'` narrations were ever written and no wave audio was ever synthesized. Supersedes the
> "A WAVE is ROAM-ONLY" hard invariant in CLAUDE.md and the roam-pass-2 wave item in TODO.md, both removed
> in the same change. The `'wave'` enum value REMAINS reserved vocabulary — see "What stayed".

## What a wave was

The scenic tier's ~15-second passing call-out: a clip that said a place's NAME and its KIND and stopped.

> "Gardner Mountain out there. Nice bit of high ground catching the light today."

It existed to cover the corpus asymmetry between the two POI tiers. `source='wikipedia'` pins have an
article behind them, get enriched into a fact sheet, and become ~2-minute **stories**.
`source='wikidata'` pins — 932 of them in Tahoe — are bare named points with no article and never will
have one. Before waves those places were silent; a wave was the honest floor for them.

## What was removed

The backout restored eleven files to their pre-`fd2df45` state. Because the three commits that landed in
between (`00f96bb`, `8042dcb`, `2ee23a4`) touched none of them, each file differed from the baseline by
wave changes ONLY, so this was an exact restore rather than hand-surgery over 281 grep hits.

| File | What went |
| --- | --- |
| `packages/studio/src/generate-narrations.ts` | the `--wave` mode: the `source='wikidata'` candidate query, the require-a-kind eligibility, wave costing, the `stopType:'scenic'` + `wave:true` routing |
| `packages/studio/src/pipeline/narrate.ts` | `wave`/`waveAngle` request fields, the WAVE fact-sheet branch, `WAVE_ANGLES` + `waveAngleFor`, the geology suppression guard |
| `packages/studio/src/models.ts` | `WAVE_LENGTH` + `lengthForWave()` (the form-level 15s/20s band) |
| `packages/studio/src/persona/skipper.ts` | the WAVE section of the system prompt (a fourth stop kind + 3 examples) |
| `packages/engine/src/roam.ts` | `RoamPinForm`, `bandM`, `formRank()`, the `beats()` comparator |
| `packages/engine/test/roam.test.ts` | the 5 distance-band-then-form tests |
| `packages/shared/src/schemas.ts` | the optional `roamPin.form` wire field |
| `apps/api/src/index.ts` | `/roam` selecting + projecting `narrations.form` |
| `apps/api/src/drives.ts` | the `ne(narrations.form, 'wave')` exclusion in `loadCorpusForRoute` |
| `apps/mobile/src/lib/useRoam.ts` | the `form` passthrough into `RoamEngine` |
| `CLAUDE.md` | the "A WAVE is ROAM-ONLY" invariant; `audio_url` note back to "story + scenic today" |

**The roam priority rule went with it.** `formRank()` demoted only `'wave'`, so with no waves in the
corpus the entire band comparator is provably inert — `beats()` degenerates to strict nearest-wins on
every input. Keeping it would have left dead machinery that a future dead-code sweep flags anyway
(cf. the prune policy from the 2026-06-22 sweep). Roam is back to strict nearest.

⚠ This means the founder's **distance-band-then-form** call (nearer beats form; form only breaks a
same-band tie — NOT strict story-over-wave) is no longer expressed anywhere in code. It was a good rule
and it is recorded here rather than lost: any future work that gives roam more than one form to choose
between should re-derive it, not reinvent strict form precedence.

## What stayed, deliberately

- **The `'wave'` enum value, in both `narrationForm` (Zod) and `narration_form` (Postgres).** It PREDATES
  the feature — it was reserved vocabulary alongside `bside`, added when the form column was designed, not
  by the build. Removing it would have meant a migration to delete an enum value for no benefit. So the
  status quo ante is: the vocabulary exists, nothing writes it.
- **The ~24 label/mapping sites that handle `'wave'`** (`apps/mobile/src/ui/stops.ts`, `labels.ts`,
  `apps/api/src/drives.ts`'s wire-form switch, etc.). These predate the build too and must stay exhaustive
  over the enum.
- **The `eval_runs`/`eval_scores` rows from the two smoke runs.** That table is explicitly "observability,
  never product state — nothing in the player/API reads these." The runs genuinely happened; deleting the
  record would falsify history for no gain.

## Why no migration or data cleanup was needed

`--scripts-only` narrates and prints but does not persist (`blast: ['SPENDS $']`, no `MUTATES DB` — it
writes only the eval record). Both smoke runs used it, so nothing reached `narrations` or R2. Verified
directly against the DB at backout time rather than assumed:

```
narrations by form: [ { form: 'story', n: 460 } ]
narrations WHERE form = 'wave': 0
wikidata (wave-tier) pois: 932
```

## Two traps worth keeping — they were the real yield of the build

Both are properties of **any narration form whose sheet is only a name + a kind**, so they will recur for
`break` (`detours`), b-sides, and scenic. Neither is wave-specific.

1. **Monotony in a low-input form is STRUCTURAL, not a weak prompt.** Roam clips are narrated in a vacuum:
   `narrate.ts` defines `recentOpeners`/`recentClosers`/`recentMotifs` but `generate-narrations` passes
   none of them, and `evaluateDiversity` is called with ONE clip, so it only catches within-clip tics.
   There is no cross-clip variety mechanism at all. A story varies for free because its facts differ; with
   two input fields the model converges hard — measured, 2 of the first 3 smoke clips were the same
   sentence template. What worked: **assign** the opening shape round-robin by queue index rather than
   maintaining a rolling recent-openers buffer, because a buffer leaves the first `NARRATION_CONCURRENCY`
   clips generating against an empty history and colliding with each other, while an index rotation holds
   at any concurrency with no shared mutable state. Verified by generating 6 pins of the SAME kind (the
   worst case) and confirming 6 distinct openers.

2. **The grounding gate CANNOT catch a claim derived from the place's own NAME.** A pin with a NULL kind
   produced "there's a peak out there" for "Cathedral Peak" — asserting a kind the card never gave. The
   gate passes it because the claim traces to the name, and the name IS legitimately on the grounding
   well. Harmless when the name is honest, a fabricated fact when it isn't (a "Castle Rock" that is no
   rock). So a low-fact form must **require** its sayable fields up front rather than trusting the gate to
   notice they are missing. Assume this blind spot exists for every future form.

Also worth remembering: `--scripts-only` SPENDS (`apply: apply || scriptsOnly`); only the no-flag dry run
is free. Two smoke runs at 3 and 6 clips cost $0.66 total and each found a real defect — that ratio makes
a small paid smoke worth it before any full-corpus run.

## If it comes back

The build is recoverable in full from `fd2df45` + `81f6ca5`. The pre-run state at cut time: 378 eligible
clips after the require-a-kind filter (9 pins dropped for a NULL kind), quoted at ~$29–31 and ≈95 minutes.
Read the two traps above first — both fixes are in `81f6ca5`.
