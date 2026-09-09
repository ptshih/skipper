import { describe, expect, test } from 'bun:test'
import { lintsForEdit } from './docs-hook'

describe('shared documentation hook', () => {
  test('routes Claude absolute and nested relative edits', () => {
    expect(lintsForEdit({ tool_input: { file_path: '/repo/docs/guides/example.md' } })).toEqual([
      'lint-docs.ts',
    ])
    expect(
      lintsForEdit({ cwd: '/repo/apps/mobile', tool_input: { file_path: 'AGENTS.md' } }),
    ).toEqual(['lint-docs.ts'])
    expect(
      lintsForEdit({ tool_response: { filePath: '/repo/.claude/skills/ship/SKILL.md' } }),
    ).toEqual(['lint-skills.ts'])
  })

  test('checks both lints once for a mixed Codex patch, including moves and deletions', () => {
    expect(
      lintsForEdit({
        cwd: '/repo',
        tool_name: 'apply_patch',
        tool_input: {
          command: [
            '*** Begin Patch',
            '*** Delete File: docs/guides/old.md',
            '*** Update File: .claude/skills/ship/SKILL.md',
            '*** Move to: .agents/skills/ship/SKILL.md',
            '*** Add File: apps/mobile/AGENTS.md',
            '*** End Patch',
          ].join('\n'),
        },
      }),
    ).toEqual(['lint-docs.ts', 'lint-skills.ts'])
  })

  test('a move out of docs still lints the deleted source', () => {
    expect(
      lintsForEdit({
        tool_name: 'apply_patch',
        tool_input: {
          command: '*** Update File: docs/guides/old.md\n*** Move to: README.md',
        },
      }),
    ).toEqual(['lint-docs.ts'])
  })

  test('ignores unrelated code and patch-like text inside added content', () => {
    expect(
      lintsForEdit({
        tool_name: 'apply_patch',
        tool_input: {
          command: '*** Update File: apps/api/src/index.ts\n+*** Add File: docs/guides/example.md',
        },
      }),
    ).toEqual([])
    expect(lintsForEdit({})).toEqual([])
  })
})
