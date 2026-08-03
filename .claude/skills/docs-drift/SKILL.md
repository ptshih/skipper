---
name: docs-drift
description: Use to find docs whose Status line or claims no longer match the code — the staleness lint:docs structurally cannot catch. For "are the docs still true", "docs drift", "audit docs", "is this doc stale".
---

# Docs Drift

`lint:docs` enforces **shape**: a kind folder, a `**Status**` line, no handoff
files, no bare `docs/<file>.md`, CLAUDE.md under its ceiling. It cannot tell you
a Status line is a lie. That is this skill's whole job.

## Iron Law

**Propose, never flip.** A Status line is a judgment about whether something is
built, superseded, or still an idea — and getting it wrong either erases real
work or claims work that does not exist. This skill produces a ranked list of
suspected drift with evidence. The human decides. The only exception is a
finding so mechanical it is not a judgment (a referenced path that no longer
exists), and even then you say what you changed.

## Phase 1: Rank by risk, don't sweep alphabetically

Reading every doc against every file is a waste. Drift concentrates where a doc
makes a **checkable claim** and the code under it has moved since.

For each doc, get its last touch and compare against its subject's:

```bash
git log -1 --format='%cI %h' -- docs/designs/<doc>.md
git log --oneline --since='<that date>' -- <the paths that doc is about>
```

Prioritise in this order:

1. **`docs/designs/` with a Status of built or greenlit.** These assert the code
   is a certain way. They are the most load-bearing and the most likely stale.
2. **`docs/guides/`** — an operator follows these literally. A wrong command
   here costs money or destroys data, which makes it worse than a wrong essay.
3. **`docs/decisions/`** — append-only by design, so the *decision* does not go
   stale. What goes stale is the **mechanism** it names.
4. **`CLAUDE.md`** — highest blast radius, since every agent loads it.

`docs/research/` is a snapshot of a moment and is allowed to age. Do not report
it as drift unless it is cited as current truth somewhere else.

## Phase 2: What actually counts as drift

Check claims, not prose. A claim is anything falsifiable at HEAD:

| Claim type | How to check |
|---|---|
| A file/dir path | Does it exist? `ls` / Glob |
| A function, table, column, or env var name | Grep for the definition, not a call site |
| A command or script name | Is it still in `package.json`? |
| A numeric value baked into prose | Find its ONE home (the constant, the schema, `cloudbuild`) and compare |
| "Today only X exists" | Count them |
| A Status of built | Does the thing exist in code? |
| A Status of deferred/idea | Has someone shipped it anyway? |

⚠ **The trap that has bitten twice:** a doc describing a *deliberate* tradeoff
reads like a gap. Read the definition and its comment before calling something
missing — this repo's rationale lives in comments at the definition, and an
apparent hole is usually already argued there.

⚠ **The inverse trap, also real:** a cleanup list says "delete X" while a
`docs/decisions/` entry still tells an operator to *use* X. That is a genuine
conflict and must be **raised, never resolved silently**. Grep `docs/` for the
basename of anything a sweep removed.

## Phase 3: Severity

Rank by what a reader would *do* wrong, not by how wrong the text is.

- **Dangerous** — a guide's command would spend money, delete data, or hit prod
  in a way the doc does not warn about. Report these first, always.
- **Misleading** — a Status says built and it is not, or names a mechanism that
  no longer exists. An agent will act on it.
- **Cosmetic** — a renamed file in an example, a stale count. Worth a line, not
  a paragraph.

A doc that is merely *old* is not drift. Say nothing about it.

## Phase 4: Report

```
Docs drift — <N> docs checked, <M> with suspected drift

DANGEROUS
  docs/guides/<x>.md:<line>  Status: <current>
    Claims:   <the quoted claim>
    Reality:  <what HEAD says, with file:line>
    Proposed: <the specific edit or Status flip>

MISLEADING
  ...

COSMETIC
  ...

Checked and still accurate: <list, so the next run can skip them>
```

Always include the last section. A drift audit that only ever lists problems
gives no way to tell "verified clean" from "never looked."

## Phase 5: If asked to fix

Then, and only then:

- **Statuses change in place. A doc file NEVER moves** — maturity lives in the
  Status line, not the folder.
- Superseding something in `CLAUDE.md` means **deleting** it there and recording
  the history in `docs/decisions/` — no strikethrough graveyards.
- Update `docs/README.md` if an entry's description no longer matches.
- Run `bun run lint:docs` afterwards and report the exit code. ⚠ CLAUDE.md has a
  hard line ceiling; adding to it can push it over, and the failure will name
  the count.
- Commit the doc changes by explicit path, and check the file is still solely
  yours first — several agents edit `CLAUDE.md`.
