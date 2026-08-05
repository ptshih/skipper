---
name: todo
description: Use to work the engineering backlog in TODO.md — show what is open, add an item, close one, or groom the file. For "what's on the todo list", "add a todo", "what should I pick up", "mark that done", "anything blocked".
---

# Todo

The backlog is ONE file: `TODO.md` at the repo root. No database, no CLI — the
**format is the interface and `grep` is the query engine**. That is deliberate:
an item earns its place only if a human can read it in a diff, and every tool
that could have held this instead would have hidden it from code review.

## The item format

```
- [ ] #12 (mobile, low, device) **Prove it renders on SDK 57, on a device.** Then as much
      context as it takes, wrapped and indented six spaces.
```

| Field | Values | Rule |
|---|---|---|
| `#id` | `#1`, `#2`, … | Stable, and **never reused**. Source is `next-id:` in TODO.md's header — not the highest id in the file, because deleting the newest item would then hand its id to the next one. Take the max of the two. |
| area | `api` `mobile` `studio` `corpus` `ops` `admin` `site` `store` | Closed set. Adding one is fine but do it deliberately: this table AND TODO.md's legend, same commit. |
| priority | `high` `med` `low` | `high` = it blocks something or someone is waiting. Most items are `low`; a file where everything is high sorts nothing. |
| tags | `paid` `founder` `device` `doing` `blocked: <why or #id>` | Optional, in that order. |

The tags are the ones this project actually gates on: **`paid`** spends real GCP
or model credits (STOP list — never run one on inference), **`founder`** is
founder-owned or needs an explicit go, **`device`** cannot be settled from a
desk, **`blocked:`** names what would unblock it — prefer `blocked: #18` over
prose when another item is the blocker, so closing one surfaces the other.

⚠ **Sections are TOPICS, not areas, and a section's preamble is shared context
for every item beneath it.** Several preambles carry the thing that stops you
re-deriving a paid conclusion ("read this before the run-1 notes below"). Read
the preamble before acting on an item, and file a new item under the section
whose preamble already applies. Area lives in the item's metadata precisely so
grouping by topic stays free.

⚠ `#7` inside an item's prose is usually an eval-scenario turn index, not an
item id. Ids only mean an id **at the start of a line**, right after the
checkbox — every command below anchors with `^`.

## Reading

```bash
grep -n '^- \[ \] #' TODO.md              # every open item, one line each
grep -c '^- \[ \] #' TODO.md              # how many are open
grep -n '^## \|^- \[' TODO.md             # the map: sections + items, in order
```

Filters — anchor inside the metadata parens so a word in the prose can't match:

```bash
grep -nE '^- \[ \] #[0-9]+ \(mobile,' TODO.md               # one area
grep -nE '^- \[ \] #[0-9]+ \([a-z]+, high' TODO.md          # high priority
grep -nE '^- \[ \] #[0-9]+ \([^)]*founder[^)]*\)' TODO.md   # a tag
grep -nE '^- \[ \] #[0-9]+ \([^)]*blocked[^)]*\)' TODO.md   # what is stuck, and on what
```

To show one item in full, get its line number, then Read that range **plus the
`## ` heading above it** — the preamble is part of the item's meaning. Reading
the item alone is how an agent re-litigates something the preamble already
settled.

When the ask is "what should I pick up", the answer is the items carrying **no
tags at all** — every tag names something an agent cannot supply on its own (a
person, real hardware, money, or another item):

```bash
grep -nE '^- \[ \] #[0-9]+ \([a-z]+, (high|med|low)\) ' TODO.md
```

The trailing `\) ` is what does the work: it matches only a closed metadata
paren, so anything tagged drops out. Offering a `founder` or `paid` item as the
next move wastes the turn — those wait on a decision, not on effort.

## Adding

1. **Next id** — `next-id:` in TODO.md's header vs. `grep -oE '^- \[[ x]\] #[0-9]+' TODO.md`;
   take the max. Bump `next-id:` in the same edit.
2. **Pick the section** whose preamble already applies. If none does, add a new
   `## ` section **with a preamble** — a heading with no shared context is how a
   file full of orphan items starts. Append the item at the end of that section.
3. **Write the item the way this repo writes them**: a bolded headline clause,
   then enough context to act without re-deriving the reasoning — what was
   already ruled out and why, the ⚠ that would trip the next agent, a link to
   the `docs/` record that holds the full argument. An item that just names a
   task is worth less than the two minutes it took to file.

Never invent metadata to look thorough. If the priority is genuinely unknown,
`low` is the honest default; if you are guessing at `founder`, ask instead.

## Closing — `done` means DELETE the item

The file's own rule, and it is not a style preference: **delete items when done —
git history is the archive.** A `- [x]` tombstone costs every future reader the
work of deciding whether it still matters.

Before deleting, ask one question: **does this item carry a durable lesson?** A
trap, a measured number, a rejected approach with its reason. If it does, that
belongs in `docs/` in the SAME commit — `docs/decisions/` for why something is
the way it is, `docs/guides/` for how to run something — and only then does the
item go. This repo has lost traps exactly this way; the fix is the co-commit,
not a longer TODO.md.

⚠ A handful of `- [x]` items exist in the file on purpose — findings kept
because the diagnosis, not the fix, is the reusable part. They are a **temporary
state, not a category**: each one is owed a relocation into `docs/` and then a
delete. `groom` chases them.

## Grooming

A consistency pass over the whole file. Report, don't silently fix anything that
needs a judgment call:

- **Ids** — duplicates, or an id above `next-id:` (both mean two agents added at once).
- **Malformed metadata** — an unknown area, a missing priority, tags out of order.
- **`- [x]` items** — relocate the lesson to `docs/`, then delete.
- **Dangling `blocked: #N`** where `#N` no longer exists — either it closed and
  this item is now free, or the blocker was deleted without checking who waited on it.
- **Dead links** — a `docs/` path that no longer resolves.
- **Superseded items** — TODO.md's own header says anything assuming roam, the
  client capability channel, or per-drive-only offline is superseded by the 1.1
  spec. An item that survived that sweep is a finding, not a fix to make quietly.
- **Items that outgrew the file** — a "todo" carrying three paragraphs of
  argument is a design doc wearing a checkbox. Propose moving it to `docs/designs/`
  and leaving a one-line item pointing there.

## Landing the change

TODO.md is shared across agents and is one of the most-edited files in the repo,
so it is the likeliest file in the tree to already hold someone else's work:

```bash
git diff --stat TODO.md
```

Read the diff, not the stat. If it contains an item you did not touch, that is
another agent's — leave the file for its owner and say so. Otherwise commit it
by explicit path (`git commit TODO.md -m "…"`), never `git add -A`. `/ship` is
the full landing ritual if this rides along with code.
