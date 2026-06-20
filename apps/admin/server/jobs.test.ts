import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SCRIPTS, buildJobArgs } from './jobs'

// Every gen-job entrypoint MUST record its status AND capture its own logs through the
// job-progress hook (the runJob() wrapper — packages/studio/src/pipeline/job-progress.ts —
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

  test('threads model / region / limit flags', () => {
    const r = buildJobArgs({
      kind: 'enrich_pois',
      apply: true,
      model: 'opus',
      region: 'lake-tahoe',
      limit: 5,
    })
    expect(r.args).toContain('--model=opus')
    expect(r.args).toContain('--region=lake-tahoe')
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
      region: 'lake-tahoe',
      source: 'wikipedia',
      query: 'emerald',
      excludeIds: ['x', 'y'],
    })
    expect(r.args).toContain('--region=lake-tahoe')
    expect(r.args).toContain('--source=wikipedia')
    expect(r.args).toContain('--query=emerald')
    expect(r.args).toContain('--exclude-ids=x,y')
  })
})

describe('buildJobArgs — spend classification across ALL kinds (the confirm-gate input)', () => {
  // build.spends is exactly what index.ts gates the confirm:true requirement on (`if build.spends &&
  // body.confirm !== true → 412`). A kind mislabeled spends:false would skip the gate on a real paid
  // run, so pin every kind's classification — incl. the two deliberate free exceptions. (audit #6)
  test('FREE kinds never spend (no confirm gate), with or without --apply', () => {
    for (const apply of [false, true]) {
      expect(buildJobArgs({ kind: 'discover_pois', apply }).spends).toBe(false)
      expect(buildJobArgs({ kind: 'refetch_facts', poiId: 'p1', apply }).spends).toBe(false)
    }
  })

  test('PAID kinds spend IFF --apply (dry run = free preview; apply = confirm-gated spend)', () => {
    const paid = [
      { kind: 'enrich_pois' },
      { kind: 'generate_narrations' },
      { kind: 'offline_audit' },
      { kind: 'sweep_orphans' },
      { kind: 'resynth_narration', poiId: 'p1' },
    ]
    for (const body of paid) {
      const dry = buildJobArgs({ ...body, apply: false })
      expect(dry.spends).toBe(false)
      expect(dry.dryRun).toBe(true)
      expect(dry.args).not.toContain('--apply')

      const applied = buildJobArgs({ ...body, apply: true })
      expect(applied.spends).toBe(true)
      expect(applied.dryRun).toBe(false)
      expect(applied.args).toContain('--apply')
    }
  })

  test('an unknown / removed-legacy kind is rejected, never dispatched', () => {
    expect(() => buildJobArgs({ kind: 'nope' })).toThrow()
    expect(() => buildJobArgs({ kind: 'generate' })).toThrow() // legacy enum member, no dispatchable script
  })

  test('poi-targeted kinds require a poiId', () => {
    expect(() => buildJobArgs({ kind: 'resynth_narration' })).toThrow()
    expect(() => buildJobArgs({ kind: 'refetch_facts' })).toThrow()
  })
})

describe('buildJobArgs — numeric flag validation (the server is the trust boundary — audit #7)', () => {
  test('a valid positive limit / max-cost is threaded', () => {
    const r = buildJobArgs({ kind: 'enrich_pois', limit: 5, maxCostUsd: 12.5 })
    expect(r.args).toContain('--limit=5')
    expect(r.args).toContain('--max-cost=12.5')
  })

  test('REJECTS a non-numeric max-cost instead of emitting --max-cost=NaN (which would disable the cap)', () => {
    expect(() => buildJobArgs({ kind: 'enrich_pois', maxCostUsd: 'abc' })).toThrow()
    expect(() => buildJobArgs({ kind: 'generate_narrations', maxCostUsd: 'lots' })).toThrow()
  })

  test('REJECTS a negative / zero-or-less limit or max-cost', () => {
    expect(() => buildJobArgs({ kind: 'enrich_pois', maxCostUsd: -5 })).toThrow()
    expect(() => buildJobArgs({ kind: 'offline_audit', limit: -1 })).toThrow()
  })

  test('an absent (falsy/0) numeric flag stays a no-op — no flag emitted, no throw', () => {
    const r = buildJobArgs({ kind: 'enrich_pois' })
    expect(r.args.some((a) => a.startsWith('--limit'))).toBe(false)
    expect(r.args.some((a) => a.startsWith('--max-cost'))).toBe(false)
    expect(() => buildJobArgs({ kind: 'enrich_pois', limit: 0, maxCostUsd: 0 })).not.toThrow()
  })
})
