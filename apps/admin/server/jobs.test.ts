import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, buildJobArgs } from './jobs'

// Every gen-job entrypoint MUST record its status AND capture its own logs through the
// job-progress hook (beginJob/finishJob — packages/generator/src/pipeline/job-progress.ts).
// A kind that skips it records no status and shows NO logs in the admin console (which no
// longer reads Cloud Logging). This guard makes "always capture the same way" enforced, not
// aspirational: add a kind to SCRIPTS without wiring the hook and this fails. (run.ts is the
// canonical main()+begin/finish shape to copy.)
const repoRoot = join(import.meta.dir, '..', '..', '..')

for (const [kind, scriptPath] of Object.entries(SCRIPTS)) {
  test(`gen-job '${kind}' wires the job-progress hook (${scriptPath})`, () => {
    const src = readFileSync(join(repoRoot, scriptPath), 'utf8')
    expect(src).toContain('beginJob(')
    expect(src).toContain('finishJob(')
  })
}

describe('buildJobArgs — enrich_region (the corpus enrich op)', () => {
  test('dry run by default: no --apply, spends:false (no model calls)', () => {
    const r = buildJobArgs({ kind: 'enrich_region' })
    expect(r.dryRun).toBe(true)
    expect(r.spends).toBe(false)
    expect(r.args).not.toContain('--apply')
    expect(r.targetId).toBe('region-corpus')
  })

  test('--apply SPENDS (Anthropic) → confirm gate', () => {
    const r = buildJobArgs({ kind: 'enrich_region', apply: true })
    expect(r.dryRun).toBe(false)
    expect(r.spends).toBe(true)
    expect(r.args).toContain('--apply')
  })

  test('threads thin-only / model / bbox / limit flags', () => {
    const r = buildJobArgs({
      kind: 'enrich_region',
      apply: true,
      thinOnly: true,
      model: 'opus',
      bbox: '-120,38,-119,39',
      limit: 5,
    })
    expect(r.args).toContain('--thin-only')
    expect(r.args).toContain('--model=opus')
    expect(r.args).toContain('--bbox=-120,38,-119,39')
    expect(r.args).toContain('--limit=5')
  })
})
