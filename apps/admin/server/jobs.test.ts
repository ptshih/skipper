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
  // The console now always dispatches an EXPLICIT id list rather than a server-resolvable filter, so
  // this arg grows with the corpus. Cloud Run publishes only an argument COUNT limit (1000/container),
  // which one --include-ids= flag never approaches; no per-arg byte limit is documented. Bounded here
  // so the failure is a clean 400 instead of an undocumented cliff during a paid run.
  test('an id list is bounded, and the ceiling is a 400 rather than a truncation', () => {
    const ok = Array.from({ length: 5000 }, (_, i) => `id-${i}`)
    expect(() => buildJobArgs({ kind: 'enrich_pois', includeIds: ok })).not.toThrow()
    const tooMany = [...ok, 'one-too-many']
    expect(() => buildJobArgs({ kind: 'enrich_pois', includeIds: tooMany })).toThrow(/ceiling is 5000/)
    // ⚠ Truncating would be the dangerous alternative: a paid run silently acting on a subset of what
    // the operator authorised is precisely the class of bug the id-list change was made to remove.
  })

  test('non-string ids are dropped, never stringified into a selector that matches nothing', () => {
    const r = buildJobArgs({ kind: 'enrich_pois', includeIds: ['a', 42, null, { id: 'b' }, 'c'] })
    expect(r.args).toContain('--include-ids=a,c')
  })

  test('FREE kinds never spend (no confirm gate), with or without --apply', () => {
    for (const apply of [false, true]) {
      expect(buildJobArgs({ kind: 'discover_pois', apply }).spends).toBe(false)
      expect(buildJobArgs({ kind: 'refetch_facts', poiId: 'p1', apply }).spends).toBe(false)
    }
  })

  // ⚠ The one kind in NEITHER list above until 2026-08-02, which is how its Preview button shipped
  // permanently broken: spends:true unconditionally + a client that only sent confirm on apply = a
  // 412 for every preview. The classification is CORRECT and must not be weakened to match the
  // client; the client was fixed to send confirm on preview for this kind.
  test('generate_cluster_narrations spends on PREVIEW too — its dry run narrates and scores', () => {
    for (const apply of [false, true]) {
      const r = buildJobArgs({ kind: 'generate_cluster_narrations', region: 'lake-tahoe', apply })
      expect(r.spends).toBe(true)
      expect(r.dryRun).toBe(!apply)
    }
  })

  test('PAID kinds spend IFF --apply (dry run = free preview; apply = confirm-gated spend)', () => {
    const paid = [
      { kind: 'enrich_pois' },
      { kind: 'generate_narrations' },
      { kind: 'curate_places' },
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

describe('buildJobArgs — targetId is per-region, aligned with the studio beginJob (audit #9 / #11)', () => {
  // The in-flight lock + the studio_jobs_active_target_uq unique index key on targetId. A constant
  // per-kind targetId would over-block two REGIONS (a spurious 409); region-specific keying lets them
  // run concurrently AND matches the studio script's beginJob so admin/CLI runs of the same target agree.
  test('generate_narrations / offline_audit key on the region (slug + lock)', () => {
    const r = buildJobArgs({ kind: 'generate_narrations', region: 'lake-tahoe' })
    expect(r.targetId).toBe('lake-tahoe')
    expect(r.targetSlug).toBe('lake-tahoe') // the display region == the lock target for a region run
    expect(buildJobArgs({ kind: 'generate_narrations', region: 'yosemite' }).targetId).toBe('yosemite')
    expect(buildJobArgs({ kind: 'offline_audit', region: 'yosemite' }).targetId).toBe('yosemite')
  })

  test('two different regions get DISTINCT targetIds (no spurious cross-region 409)', () => {
    const a = buildJobArgs({ kind: 'generate_narrations', region: 'lake-tahoe' }).targetId
    const b = buildJobArgs({ kind: 'generate_narrations', region: 'yosemite' }).targetId
    expect(a).not.toBe(b)
  })

  test('an explicit-id generate run spans no single region — slug + target are NULL (shown as "All")', () => {
    const r = buildJobArgs({ kind: 'generate_narrations', includeIds: ['a', 'b'] })
    expect(r.targetId).toBeUndefined() // → stored NULL, never the old 'roam-corpus' sentinel
    expect(r.targetSlug).toBeUndefined()
  })

  // ⚠ Added 2026-08-02 with the id-list change. The console now ALWAYS sends includeIds, so the
  // region-derived target above is undefined for every corpus run — which made the Jobs page label a
  // one-clip regenerate "All", and silently dropped the per-region lock that select-all used to take.
  // The display label and the lock key are therefore sent explicitly, and are NEVER CLI flags.
  test('an explicit scope label becomes the display target without touching the args', () => {
    const r = buildJobArgs({
      kind: 'generate_narrations',
      includeIds: ['a', 'b'],
      scopeLabel: '2 hand-picked',
    })
    expect(r.targetSlug).toBe('2 hand-picked')
    expect(r.targetId).toBeUndefined() // hand-picked deliberately does NOT lock
    expect(r.args.join(' ')).not.toContain('scopeLabel')
    expect(r.args.join(' ')).not.toContain('2 hand-picked')
  })

  test('a select-all run carries its region as the LOCK key while the ids stay the selection', () => {
    const r = buildJobArgs({
      kind: 'generate_narrations',
      includeIds: ['a', 'b'],
      scopeLabel: '137 POIs · Lake Tahoe',
      lockRegion: 'lake-tahoe',
    })
    expect(r.targetId).toBe('lake-tahoe') // per-region lock restored
    expect(r.targetSlug).toBe('137 POIs · Lake Tahoe')
    // ⚠ the lock region must never narrow the run — that is the ids' job, and re-adding --region
    // would drop every selected id outside it (the bug this whole change removed)
    expect(r.args.join(' ')).not.toContain('--region')
    expect(r.args.join(' ')).toContain('--include-ids=a,b')
  })

  test('a region-less run falls back to the default region slug (= studio DEFAULT_REGION_SLUG)', () => {
    expect(buildJobArgs({ kind: 'generate_narrations' }).targetId).toBe('lake-tahoe')
    expect(buildJobArgs({ kind: 'discover_pois' }).targetId).toBe('lake-tahoe')
  })

  test('discover_pois keys on the region; sweep_orphans matches its script target', () => {
    expect(buildJobArgs({ kind: 'discover_pois', region: 'yosemite' }).targetId).toBe('yosemite')
    expect(buildJobArgs({ kind: 'sweep_orphans' }).targetId).toBe('narration') // audit #11 (was 'roam')
  })

  test('curate_places keys on the region (default lake-tahoe) and threads model/target/max-cost', () => {
    expect(buildJobArgs({ kind: 'curate_places' }).targetId).toBe('lake-tahoe')
    expect(buildJobArgs({ kind: 'curate_places', region: 'yosemite' }).targetId).toBe('yosemite')
    const r = buildJobArgs({ kind: 'curate_places', apply: true, region: 'lake-tahoe', model: 'opus', target: 24, maxCostUsd: 2 })
    expect(r.args).toContain('--region=lake-tahoe')
    expect(r.args).toContain('--model=opus')
    expect(r.args).toContain('--target=24')
    expect(r.args).toContain('--max-cost=2')
    expect(r.args).toContain('--apply')
  })
})
