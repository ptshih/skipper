// Pins the founder's rule "always run gemini on high" (2026-09-23) where it can actually drift: at the
// call sites. LLM_THINKING_LEVEL is the one constant every Gemini call reads; this test fails the moment
// any production source file hard-codes a thinking level instead — the way a "this call is simple, LOW
// is enough" edit would reintroduce exactly what the founder ruled out.

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { LLM_THINKING_LEVEL, PLANNER_THINKING_LEVEL } from '../src'

const ROOT = join(import.meta.dir, '..', '..', '..')
/** Every source tree that calls a model. Tests are excluded — they assert on levels on purpose. */
const TREES = ['apps/api/src', 'apps/api/eval', 'apps/admin/server', 'packages/studio/src']

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' || name.startsWith('.') ? [] : sources(p)
    return p.endsWith('.ts') && !p.endsWith('.test.ts') ? [p] : []
  })
}

/** A file's non-comment lines, trimmed — what a scan for USE (not mention) should read. */
function codeLines(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
}

/** A thinking level written down anywhere but the shared constant: the enum member, or a string
 *  literal handed to a `thinkingLevel` field. */
const HARD_CODED = /thinkingLevel\s*:\s*(?:ThinkingLevel\.\w+|['"](?:LOW|MEDIUM|HIGH|MINIMAL)['"])/

describe('thinking level — always HIGH (founder, 2026-09-23)', () => {
  test('the one shared level is HIGH', () => {
    expect(LLM_THINKING_LEVEL).toBe('HIGH')
  })

  // The single founder-approved exception (2026-09-23, after measuring LOW/MEDIUM/HIGH on the planner).
  // Pinned so it cannot quietly spread: it is the planner's alone, read only by apps/api/src/planner.ts.
  test('the planner is the one exception, at LOW, and only the planner reads it', () => {
    expect(PLANNER_THINKING_LEVEL).toBe('LOW')
    // CODE that reads it — comment lines that merely mention the constant are documentation, not readers.
    const readers = TREES.flatMap((t) => sources(join(ROOT, t)))
      .filter((f) => codeLines(f).some((line) => line.includes('PLANNER_THINKING_LEVEL')))
      .map((f) => relative(ROOT, f))
    expect(readers).toEqual(['apps/api/src/planner.ts'])
  })

  test('no call site hard-codes a thinking level — every one reads LLM_THINKING_LEVEL', () => {
    const offenders = TREES.flatMap((t) => sources(join(ROOT, t)))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, i) => ({ line: line.trim(), at: `${relative(ROOT, file)}:${i + 1}` }))
          .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*') && HARD_CODED.test(line)),
      )
      .map(({ at, line }) => `${at}  ${line}`)
    expect(offenders).toEqual([])
  })
})
