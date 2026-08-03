---
name: investigate
description: Use when something is broken and the cause is not yet known — systematic root-cause debugging with a hard stop after three failed hypotheses. For "why is this broken", "debug this", "this test fails", "wtf", "it works locally".
---

# Investigate

## Iron Law

**No fixes without root cause first.**

A fix that does not address the root cause makes the next bug harder to find.
If you catch yourself editing code before you can state a testable claim about
*why* it is broken, stop and come back to Phase 1.

## Phase 1: Collect

1. **Read the actual error.** Full text, full stack trace. Not the summary
   someone gave you.
2. **Reproduce it deterministically.** If you cannot, you are not ready to form
   a hypothesis — gather more evidence.
3. **Check what changed:** `git log --oneline -20 -- <affected-paths>`. A
   regression means the cause is in the diff, which is the cheapest search space
   you will ever get.
4. **Read the definition, not just the call site.** An apparent gap is very
   often already accepted in a comment at the definition — this repo's comments
   carry the rationale. Read that block before asserting anything is missing.

## Phase 2: Check the known landmines FIRST

These have each bitten this repo at least once. Checking is seconds; missing one
costs an hour of confident wrong reasoning.

| Symptom | Likely cause |
|---|---|
| A check/typecheck "passes" but something is clearly broken | Output is ANSI-colored — `grep "error TS"` never matches. **Verify by exit code**, redirect and read `$?` (zsh: `$pipestatus`). |
| Test file green alone, red in the suite (or vice versa) | `bun mock.module` is **process-wide** and leaks across files. Spread the real module and delegate when idle. |
| `tsc --noEmit` green but `expo prebuild` / `expo export` dies | TS 7 drops the programmatic API that `@expo/require-utils` needs. A green typecheck **hides** this. Stay on TS 6. |
| Typecheck fails right after adding an `app/*.tsx` route | `.expo/types/router.d.ts` hasn't regenerated. ⚠ The inverse is silent: a **stale** file is a superset, so tsc stays green on a **deleted** route. |
| Dev redbox "Requiring unknown module N" | Metro lazy-bundling split a dynamic `import()` out. Fix = eager import in `index.js`. |
| `db:generate` hangs or errors on a rename | drizzle-kit **prompts**; non-TTY stdin fails. Needs a real terminal, or shape the change to have no rename. |
| A constant/function looks correct, tests around it pass, behavior never changes | **No production reader.** Orchestrator-owed wiring gets dropped — grep for a real call site, not just the definition. |
| "It worked in dev but prod is wrong" | There is **no staging**. `.env.development` and `.env.production` point at the **same** Neon DB and the **same** R2. Dev already wrote to prod. |
| A clip is factually fine but fires in the wrong place | The grounding gate scores "matches its sheet", **not** "is right". Bad Wikidata coords pass it. Detector = two QIDs at one lat/lng. |
| Anonymous rider state vanishes after signup | The anonymous user row is **hard-deleted** at link and a fresh user created. State that must survive lives on the client and is re-sent. |
| A signed-in check behaves oddly for anonymous users | `session` truthiness is **not** "signed in" — anonymous sessions are truthy. Go through the one helper that excludes `isAnonymous`. |
| A preview route suddenly requires auth (or a walled one doesn't) | `requireAccount` is **per-route**, never on the `driveRoutes.use('*', …)` mount. |
| A scratch DB query can't resolve `@skipper/db` | It must live in `packages/studio/.scratch/` (gitignored). |
| A shell command dies with `no matches found` | zsh aborts on an unmatched glob where bash passes it through. Guard globs, or use the Read/Grep/Glob tools. |

If none match, continue to the generic table:

| Pattern | Signature | Where to look |
|---|---|---|
| Race condition | Intermittent, timing-dependent | Shared mutable state, concurrent writes |
| Null propagation | TypeError on an optional | Missing guards at a boundary |
| Stale cache | Old data, fixed by a clear | R2, client store, facts TTL |
| Config drift | Works one place, not another | env vars, dotenvx decryption, `.env.keys` |
| Integration failure | Timeout, unexpected shape | Routes API, Anthropic, TTS, Neon |

Also grep `TODO.md` and `docs/decisions/` for the symptom's nouns — a known
issue or a deliberate tradeoff may already be written down.

## Phase 3: Scope discipline

Name the narrowest directory that could plausibly contain the cause, and say it
out loud: *"Investigating within `apps/api/src/` — I will not edit outside it
without saying why."* On a tree shared with other agents, an unannounced edit
three directories away is indistinguishable from a collision.

Add temporary instrumentation freely, but **track every line you add** and
remove it in Phase 5. Never leave a debug `console.log` in a commit.

## Phase 4: Test the hypothesis — 3 strikes and stop

State it as a falsifiable claim:

> **Root cause hypothesis:** `<specific thing>` is wrong because `<mechanism>`,
> which is why `<symptom>`.

Prove it *before* fixing — add an assertion or a log at the suspected point and
watch it fire. A hypothesis you did not test is a guess.

**If three hypotheses fail, STOP.** Do not try a fourth. Report:

- what you tested and precisely how each one was ruled out,
- what the evidence actually says,
- your best remaining guess and what it would take to check it.

Three failures usually means the model of the system is wrong, not that the
next guess is due. That is a conversation, not more edits.

## Phase 5: Fix and verify

1. Fix the **cause**, not the symptom.
2. Remove every piece of temporary instrumentation.
3. **Write a regression test** that fails without the fix. If the bug is in a
   React hook (unreachable by `bun test`), say so explicitly rather than
   pretending coverage exists.
4. Run `bun run check` — and `apps/mobile`'s own check if you touched it.
   Exit code, not grep.

## Phase 6: Capture what was learned

If the bug was **structural** — a trap the next agent would also fall into, not
a one-off typo — it earns a durable record:

- A guardrail belongs in `CLAUDE.md` (only if an agent must know it to avoid
  breaking something or burning money).
- A rationale or a dated decision belongs in `docs/decisions/`.
- Recurring bugs in the same files are an **architectural smell**, not
  coincidence. Say so.

Do not record what git history already tells you.

## Report

```
Root cause: <one sentence>
Evidence:   <what proved it>
Fix:        <what changed, and why there>
Test:       <the regression test, or an honest note that it isn't reachable>
check:      PASS (exit 0)
Learned:    <durable trap + where it was recorded> | nothing durable
```
