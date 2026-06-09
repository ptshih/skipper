#!/usr/bin/env bun
// PostToolUse hook (matcher: Write|Edit) — wired in .claude/settings.json.
// When the edited file is part of the docs truth system (docs/**/*.md, CLAUDE.md,
// TODO.md), run scripts/lint-docs.ts and feed any violations back to the agent
// (exit 2 → stderr returned as tool feedback). All other files: exit 0 silently.

import { join } from 'node:path'

try {
  const input = await Bun.stdin.text()
  let filePath = ''
  try {
    const parsed = JSON.parse(input)
    filePath = parsed?.tool_input?.file_path ?? parsed?.tool_response?.filePath ?? ''
  } catch {
    process.exit(0)
  }

  const isDocsSystemFile = /\/docs\/.+\.md$/.test(filePath) || /\/(CLAUDE|TODO)\.md$/.test(filePath)
  if (!isDocsSystemFile) process.exit(0)

  const lint = Bun.spawnSync(['bun', join(import.meta.dir, 'lint-docs.ts')])
  if (lint.exitCode !== 0) {
    console.error(lint.stdout.toString() + lint.stderr.toString())
    process.exit(2)
  }
  process.exit(0)
} catch {
  // Never let hook plumbing break an unrelated tool call.
  process.exit(0)
}
