#!/usr/bin/env bun
// PostToolUse hook (matcher: Write|Edit) — shared by Claude and Codex.
// When the edited file is part of the docs truth system (docs/**/*.md, CLAUDE.md,
// TODO.md), run scripts/lint-docs.ts and feed any violations back to the agent
// (exit 2 → stderr returned as tool feedback). All other files: exit 0 silently.

import { join, resolve } from 'node:path'

type EditEvent = {
  cwd?: string
  tool_name?: string
  tool_input?: { file_path?: string; command?: string }
  tool_response?: { filePath?: string }
}

/** Route every file in a Codex patch, including deleted and renamed sources.
 * Claude edits carry a single path instead. Paths are resolved against the event
 * cwd because both agents can edit from a workspace below the repository root.
 */
export function lintsForEdit(event: EditEvent): string[] {
  const paths: string[] = []
  const file = event.tool_input?.file_path ?? event.tool_response?.filePath
  if (typeof file === 'string') paths.push(file)
  if (event.tool_name === 'apply_patch' && typeof event.tool_input?.command === 'string') {
    for (const match of event.tool_input.command.matchAll(
      /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm,
    )) {
      paths.push(match[1]!)
    }
  }

  const lints = new Set<string>()
  for (const path of paths) {
    const absolute = resolve(event.cwd ?? join(import.meta.dir, '..'), path)
    if (/\/\.(?:claude|agents)\/skills\/.+\.md$/.test(absolute)) lints.add('lint-skills.ts')
    else if (/\/docs\/.+\.md$/.test(absolute) || /\/(AGENTS|CLAUDE|TODO)\.md$/.test(absolute))
      lints.add('lint-docs.ts')
  }
  return [...lints]
}

if (import.meta.main) {
  try {
    const event = JSON.parse(await Bun.stdin.text())
    let failed = false
    for (const script of lintsForEdit(event)) {
      const lint = Bun.spawnSync(['bun', join(import.meta.dir, script)], {
        cwd: join(import.meta.dir, '..'),
      })
      if (lint.exitCode !== 0) {
        console.error(lint.stdout.toString() + lint.stderr.toString())
        failed = true
      }
    }
    process.exit(failed ? 2 : 0)
  } catch {
    // Never let hook plumbing break an unrelated tool call.
    process.exit(0)
  }
}
