# Agent Instructions

Read [CLAUDE.md](CLAUDE.md) before doing any work. It is the shared operating
truth for Claude and Codex; keep doctrine there rather than duplicating it here.

- Before changing `apps/api` or `apps/mobile`, read
  [the current build design](docs/designs/drives-first-1-1.md).
- For anything under `apps/mobile`, also read [its instructions](apps/mobile/CLAUDE.md)
  and [design system](apps/mobile/DESIGN.md), even when starting from the repo root.
- Inspect `git status --short` before editing. The tree and index are shared;
  preserve other agents' work and use explicit paths. Follow CLAUDE.md's git rules.
- Use Bun and the scripts in `package.json`. Run root `bun run check` before
  finishing; changes under `apps/mobile` also require that workspace's `bun run check`.
- Before implementing external library/API features, search Context7 for current
  documentation; use official vendor documentation if Context7 has no coverage.

Project skills are shared through `.agents/skills`, a symlink to `.claude/skills`.
Read the relevant `SKILL.md` when a task calls for it; edit the canonical Claude
path so both agents receive updates. Claude's `/skill-name` references mean the
same workflow as Codex's `$skill-name`. Use equivalent available tools when a
skill names a Claude-specific tool; never invent tool access or results.

Codex hooks live in `.codex/hooks.json`; see [setup and limitations](README.md#coding-agents).
The STOP rules apply even when hooks are unavailable or awaiting trust. In
particular, a paid operator run still needs an explicit founder go. Shell behavior
notes about Claude's persistent Bash cwd and `CLAUDECODE` are Claude-specific;
in Codex, set the command working directory explicitly when needed.
