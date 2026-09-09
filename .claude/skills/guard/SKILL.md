---
name: guard
description: Use to see what the STOP-list guard blocks and why, or when a command was denied by skipper-guard and you need the sanctioned alternative. For "why was that blocked", "what's guarded", "add a guard rule".
---

# Guard

`scripts/guard-hook.ts` runs as a `PreToolUse` hook on every Bash call (wired in
`.claude/settings.json`; Codex uses `.codex/hooks.json` with `--codex`). It turns the CLAUDE.md STOP list from prose an agent
can skim past into a mechanical gate.

Claude runs it automatically. Codex requires hook trust first (see the coding-agent
setup in `README.md`). Codex does not support the hook's `ask` decision yet, so its
mode returns authorization reminders for that tier; only `deny` is mechanically
enforced there. The founder-go rules still apply. This skill is the cheat-sheet
for what it does and how to change it.

## Two tiers

**⛔ deny — the "NEVER" list.** Not overridable by an agent. The tree *and* the
git index are shared, so these silently eat other agents' uncommitted work.

| Blocked | Do this instead |
|---|---|
| `git stash` (except `list`/`show`) | Leave the work; commit your own paths |
| `git reset --hard` | Revert your own files by explicit path |
| `git checkout -- .` · `git restore .` | Name the file: `git restore path/a` |
| `git clean` | Delete the specific files you created (`-n` / `--dry-run` is allowed) |
| `git rebase` | Don't. History on `main` is shared (`--abort` / `--continue` / `--skip` / `--quit` are allowed — they undo a rebase rather than write one) |
| `git add -A` · `git add .` | `git add path/a path/b` |
| `git commit -a` / `-am` | `git commit path/a path/b -m "…"` |
| `prettier --write .` · `bun run format` | Format the paths you touched |
| `eslint --fix` (repo-wide) | `eslint apps/mobile/src/x.tsx --fix` |

The rule binds **agents, not people** — if one of these is genuinely the right
move, ask the human to run it in their own shell.

**⚠ ask — spend and one-way doors.** Escalates to a prompt, because a founder
"go" *is* an in-session yes.

| Prompts | Why |
|---|---|
| any `--apply` | Spends real GCP credits; needs an explicit go, per run |
| `gcloud run jobs execute` · `run deploy` · `builds submit` | Spends, and can deploy |
| `db:push` · `drizzle-kit push` | Push **DROPS** to match the schema — and dev/prod share one Neon DB |
| `git switch` · `git checkout <branch>` | Never switch branches without confirming |
| `git checkout <path>` | Reverts that file's uncommitted changes |
| `dev:api` · `dev:admin` · `dev:site` | The human keeps these running; don't restart them |

Two rules — `git push` and `rm -rf` — are **mode-dependent**. Claude Code
already prompts for them in the default permission mode, and a second prompt for
the same action only trains click-through, which is the habit the deny tier
exists to prevent. So they stay silent by default and fire only when the
built-in gate is relaxed (`acceptEdits` / `bypassPermissions` / `dontAsk`) —
which is exactly where an ungated push or delete would otherwise slip through.
Everything else, both tiers, is mode-independent.

## When you get blocked

The denial text names the sanctioned alternative. Take it — do not look for a
spelling that slips past the pattern. A guard you can walk around is not a
guard, and working around one is a bigger problem than the command was.

If the block is genuinely wrong, say so in your report and let the human decide.
Do not edit `guard-hook.ts` to unblock yourself mid-task.

## Adding a rule

Rules live in one `RULES` array in `scripts/guard-hook.ts`: a regex, a tier, a
one-line `why`, and an optional `exempt`. Each segment of a command (split on
`&&`, `||`, `;`, `|`) is tested separately, so rules never handle chaining.

Two constraints:

- **Every rule must trace to a line in CLAUDE.md.** This file is not a second
  doctrine — if the rule isn't in the STOP list, add it there first and say why.
- **The hook fails open.** Any parse error or crash exits 0 and allows the call.
  A broken guard must never wedge the repo. Test accordingly: a rule that
  throws is a rule that does nothing.

Verify a change by feeding commands through the hook and asserting the tier —
both the cases it should catch and the ones it must not:

```bash
echo '{"tool_name":"Bash","tool_input":{"command":"git add -A"}}' | bun scripts/guard-hook.ts
```

Empty output means allowed.

## What it deliberately does not do

There is **no directory freeze** (gstack's `/freeze`). Repo-level hook state
would leak across agents on the shared tree — one agent locking edits to
`apps/mobile/` would block every other agent — which is the exact failure the
STOP list exists to prevent. Scope discipline is prose in `/investigate`
instead. A session-scoped freeze keyed on the hook's `session_id` would work;
it is not built.
