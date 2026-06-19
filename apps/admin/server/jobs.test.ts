import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, buildJobArgs } from './jobs'

// Every gen-job entrypoint MUST record its status AND capture its own logs through the
// job-progress hook (the runJob() wrapper — packages/generator/src/pipeline/job-progress.ts —
// which owns begin → run → finish → exit). A kind that skips it records no status and shows NO
// logs in the admin console (which no longer reads Cloud Logging). This guard makes "always
// capture the same way" enforced, not aspirational: add a kind to SCRIPTS without wiring the
// hook and this fails. (generate-narrations.ts is the canonical main()+runJob shape to copy.)
const repoRoot = join(import.meta.dir, '..', '..', '..')

for (const [kind, scriptPath] of Object.entries(SCRIPTS)) {
  test(`gen-job '${kind}' wires the job-progress hook (${scriptPath})`, () => {
    const src = readFileSync(join(repoRoot, scriptPath), 'utf8')
    expect(src).toContain('runJob(')
  })
}

describe('buildJobArgs — enrich_pois (the corpus enrich op)', () => {
  // NOTE: this asserts the ADMIN labels the run free (dryRun/spends/no --apply) — NOT that the script
  // makes zero model calls. That guarantee lives in enrich-pois.ts's `if (!apply) return` BEFORE the
  // buildCorpusFactSheet loop (the script self-executes on import, so it can't be unit-imported to assert here).
  test('dry run by default: no --apply, spends:false (admin labels it free; script early-returns before any model call)', () => {
    const r = buildJobArgs({ kind: 'enrich_pois' })
    expect(r.dryRun).toBe(true)
    expect(r.spends).toBe(false)
    expect(r.args).not.toContain('--apply')
    expect(r.targetId).toBe('region-corpus')
  })

  test('--apply SPENDS (Anthropic) → confirm gate', () => {
    const r = buildJobArgs({ kind: 'enrich_pois', apply: true })
    expect(r.dryRun).toBe(false)
    expect(r.spends).toBe(true)
    expect(r.args).toContain('--apply')
  })

  test('threads model / bbox / limit flags', () => {
    const r = buildJobArgs({
      kind: 'enrich_pois',
      apply: true,
      model: 'opus',
      bbox: '-120,38,-119,39',
      limit: 5,
    })
    expect(r.args).toContain('--model=opus')
    expect(r.args).toContain('--bbox=-120,38,-119,39')
    expect(r.args).toContain('--limit=5')
  })

  test('threads an explicit poi-id selection (hand-picked rows)', () => {
    const r = buildJobArgs({ kind: 'enrich_pois', apply: true, includeIds: ['a', 'b', 'c'] })
    expect(r.args).toContain('--include-ids=a,b,c')
    expect(r.args.some((a) => a.startsWith('--exclude-ids'))).toBe(false)
  })

  test('threads a filter + exclude-ids selection ("select all matching, minus a few")', () => {
    const r = buildJobArgs({
      kind: 'enrich_pois',
      apply: true,
      bbox: '-120,38,-119,39',
      source: 'wikipedia',
      query: 'emerald',
      excludeIds: ['x', 'y'],
    })
    expect(r.args).toContain('--bbox=-120,38,-119,39')
    expect(r.args).toContain('--source=wikipedia')
    expect(r.args).toContain('--query=emerald')
    expect(r.args).toContain('--exclude-ids=x,y')
  })
})
