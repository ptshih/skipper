# Agent delegation and model setup

**Status**: Configured and CLI smoke-tested 2026-09-09; both named helpers spawned and returned evidence.

The shared policy lives in [CLAUDE.md](../../CLAUDE.md#git-workflow).
This guide explains how to apply it. Skills remain the reusable workflows;
helpers supply bounded evidence while the parent carries the task to completion.

## Choose the work, then the helper

| Work | Execution |
| --- | --- |
| Small fix, clarification, or tightly dependent investigation | Parent alone |
| Independent code-path map or external documentation lookup | `skipper_scout` |
| Independent review of a substantial or sensitive diff | `skipper_reviewer` |
| Implementation, test execution, simulator interaction, integration, commit | Parent |

The parent may keep making independent progress while a helper works. Avoid
duplicating its assignment; wait for its result before a dependent decision.
Close completed helper threads before opening replacements.

A useful assignment includes the question, exact paths/diff, acceptance criteria,
known constraints, and the required report. For example: “Review only this auth
diff for anonymous-access regressions. Inspect callers and tests without editing
or executing tests. Return concrete findings with file:line and triggering input.”

## Model configuration

[Project config](../../.codex/config.toml) defines the parent model and reasoning
default, enables delegation for this repository, and caps concurrent helpers.
Each [helper file](../../.codex/agents/) pins its own model and reasoning effort:
the scout favors speed for bounded evidence gathering; the reviewer uses deeper
reasoning for correctness. Keep exact model IDs and effort values in those files.
Unconfigured helper roles inherit parent settings; use the named roles above.

For unusually difficult parent work, select higher reasoning in the client if
supported. Do not claim to have switched models or effort unless the runtime
confirms it. If a configured model is unavailable, report it and continue in the
parent instead of silently substituting an unverified model.

Claude follows the same shared delegation policy using its available tools and
session model; Codex TOML does not configure Claude. No application model changes
are involved. Personal Codex configuration remains outside this repository.

## Verify in a fresh Codex session

Start a fresh session in this trusted checkout after changing agent configuration.
Run this bounded trial:

> Spawn `skipper_scout` to identify the root validation command in package.json,
> and `skipper_reviewer` to check whether the scout/reviewer configuration keeps
> edits with the parent. Read only those files and applicable agent instructions.
> Do not edit, execute tests, read secrets, contact project services, or delegate
> further. Wait for both and report their evidence and any unavailable capabilities.

Confirm actual child threads and returned results, rather than accepting a
parent's statement that it delegated. Read-only sandbox defaults can be superseded
by live parent permission overrides; the role instructions still prohibit writes.
If tools are absent, complete the work locally and report the missing trial.
Hook trust is separate: use `/hooks` in the CLI when definitions need review.

The 2026-09-09 trial passed with Codex CLI 0.153.4 in a normal `codex exec`
session using `--sandbox read-only`. Both child threads returned the requested
evidence; child turn metadata matched their configured models and reasoning.
No write-denial probe was attempted. An initial `--ephemeral` trial failed to
spawn with `no thread with id`; use a normal session for this smoke test.
This verifies the CLI, not whether an already-open app conversation refreshes
its available tools. Start a fresh app conversation to load the project setup.

## Sources

Checked 2026-09-09 against official [subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[model guidance](https://learn.chatgpt.com/docs/models), and
[skill discovery](https://learn.chatgpt.com/docs/build-skills). Context7 was also
consulted; use the live official reference when its cached schema differs.
