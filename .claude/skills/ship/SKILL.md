---
name: ship
description: Use when work is finished and ready to land — verifies, checks docs and the admin Reference page ride along, then commits atomically by explicit path. For "ship it", "let's land this", "commit this", "we're done".
---

# Ship

The landing ritual, in order. Every step exists because skipping it has a
specific cost — the cost is named so you can judge, not just comply.

## Iron Law

**Never commit a file you do not solely own.** The working tree and the git
index are shared across agents. A file that has someone else's changes in it
gets left for its owner, every time, no exceptions — even if that means your
change lands in two commits.

## Phase 1: Scope — what is actually mine?

```bash
git status --short
```

List the paths you intend to commit. For each one:

```bash
git diff --stat <path>
```

Read the diff, not just the stat. If a file contains a change you did not make,
**drop it from the commit** and say so in your report: which file, whose change
it looks like, and what you left behind. Do not try to split a file's hunks.

Never `git add -A` / `git add .` / `git commit -a`. The guard hook blocks all
three, but the reason matters more than the block: they sweep up work in flight.

## Phase 2: Verify — by exit code, never by grep

```bash
bun run check
```

That is `lint:docs` + `lint:types` + `lint:enums` + `typecheck` + `test`.

**If you touched `apps/mobile`, also run its own check** — the real delta is
`lint:tokens` + `lint` (ESLint exists only there, only for `react-hooks`);
root `test`/`typecheck` already filter into the workspace:

```bash
cd apps/mobile && bun run check
```

⚠ **Capture the exit code. Do not grep the output.** Check output is
ANSI-colored, so `grep "error TS"` never matches and a broken typecheck reads
clean. Redirect to a file and read `$?` (in zsh, `$pipestatus` for a pipeline).

If it fails, fix it. Do not commit around a red check and do not report
"mostly passing."

## Phase 3: Docs ride along — same commit

If the change ships, supersedes, or invalidates anything in `docs/` or
`CLAUDE.md`, flip that doc's `**Status**` line **in the same commit**.

- **Statuses change in place. A doc file NEVER moves.** Maturity lives in the
  Status line, not the folder.
- Superseding something in CLAUDE.md means **deleting** it there and recording
  the history in `docs/decisions/` — no strikethrough graveyards.
- If your change makes a `TODO.md` item done, delete the item; git is the archive.
- ⚠ If a cleanup says "delete X" but a `docs/decisions/` entry still tells an
  operator to *use* X, **raise it** — never resolve it silently. Grep `docs/`
  for the basename.

`lint:docs` runs as a hook and first in `check`, so a missing Status line fails
loudly — but it cannot tell you a Status line is *stale*. That judgment is yours.

## Phase 4: The admin Reference page

If the change touched `apps/admin` and added or removed a console **page** or a
**run kind**, or changed what an action **SPENDS / DELETES / RELEASES**, then
`apps/admin/client/src/views/ReferenceView.tsx` must reflect it **in the same
commit**. It is static — nothing fails when it drifts, so the same-commit habit
is the only guard there is.

## Phase 5: Commit

Atomically, by explicit path, at the very end:

```bash
git commit path/a path/b -m "$(cat <<'EOF'
<type>(<scope>): <what changed, and why if it isn't obvious>

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- Re-check ownership immediately before committing — the tree may have moved
  under you while `check` ran.
- **Never leave anything staged.** Commit what you staged, or unstage it.
- One logical change per commit. Two unrelated fixes are two commits.
- Match the existing subject style: `git log --oneline -10`.
- Commit directly to `main`. Do not create or switch branches — that needs
  confirmation first, and the guard will prompt.

## Phase 6: Push — only if asked

**Do not push unless the human explicitly says to.** A push deploys the API to
Cloud Run at 100% with no canary. The guard prompts on `git push`; treat that
prompt as a real decision, not a formality.

Note the asymmetry out loud when it applies: **DB and R2 writes are live
whether or not you push** — dev and prod point at the same Neon database and
the same R2 bucket. "I didn't push" is not "nothing shipped."

## Report

This one lands on the human, so it takes the `/wrap-up` shape: plain English,
then the block, then the ask.

Open with two or three sentences a non-engineer could follow — what landed, and
what is now true that wasn't. Then the block, **verbatim**; it is already
scannable, so keep it as the detail layer rather than melting it into prose:

```
Committed: <sha> <subject>
  Files: path/a, path/b
  Left behind: path/c (mixed — has <other agent>'s change to <fn>)
  check: PASS (exit 0)   mobile check: PASS (exit 0) | n/a
  Docs: docs/designs/x.md Status → built | none needed
  Reference page: updated | n/a
  Pushed: no (not requested)
```

Then close with a `**Next:**` line. Three things belong there, and each is an
**action** that a field above can only imply:

- **The push decision.** `Pushed: no` states a fact; the human still has to make
  a call. Say so plainly — and if DB or R2 writes already went live, say that
  too, because "I didn't push" is not "nothing shipped."
- **Anything left behind.** A mixed file is someone else's move, not a footnote.
  Name who has to act before your change can finish landing.
- **Any judgment you could not make.** A Status line you suspect is stale, or a
  `docs/decisions/` conflict you raised rather than resolved.

When none of the three applies, say so out loud —
`**Next:** nothing — this is done.` An absent Next line reads as a forgotten
thought, not a finished task.
