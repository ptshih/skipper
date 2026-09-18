# Agent Instructions

Read [CLAUDE.md](CLAUDE.md) before doing any work. It is the shared operating
truth for Claude and Codex; keep doctrine there rather than duplicating it here.

- Before changing `apps/api`, read [the current backend build design](docs/designs/drives-first-1-1.md).
- For native iOS, read [the conversion plan](docs/designs/native-ios-conversion.md),
  [native instructions](apps/ios/CLAUDE.md) and [design system](apps/ios/DESIGN.md).
- `apps/mobile` remains intact pending native acceptance. If explicitly assigned a legacy
  change, read that workspace's CLAUDE.md and DESIGN.md; preserve installed-client compatibility.
- Follow CLAUDE.md's STOP list and git rules; the tree and index are shared.
- Use Bun and the scripts in `package.json`. Run root `bun run check` before
  finishing; native changes also require relevant `bun run ios:check` coverage. Full native
  acceptance requires the complete suite and separate upgrade/device/release evidence.
  Explicit changes to the retained Expo client still require its workspace check.

Project skills are shared through `.agents/skills`, a symlink to `.claude/skills`.
Read the relevant `SKILL.md` when a task calls for it; edit the canonical Claude
path so both agents receive updates. Claude's `/skill-name` references mean the
same workflow as Codex's `$skill-name`. Use equivalent available tools when a
skill names a Claude-specific tool; never invent tool access or results.

Codex hooks live in `.codex/hooks.json`; see [setup and limitations](README.md#coding-agents).
The STOP rules apply even when hooks are unavailable or awaiting trust. In
particular, a paid operator run still needs an explicit founder go. Use absolute
paths and explicit working directories in every harness.
