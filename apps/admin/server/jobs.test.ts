import { test, expect, describe } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { jobKind } from '@skipper/shared'
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
    const r = buildJobArgs({ kind: 'enrich_pois', region: 'lake-tahoe' })
    expect(r.dryRun).toBe(true)
    expect(r.spends).toBe(false)
    expect(r.args).not.toContain('--apply')
    expect(r.targetId).toBe('region-corpus')
  })

  test('--apply SPENDS (Anthropic) → confirm gate', () => {
    const r = buildJobArgs({ kind: 'enrich_pois', region: 'lake-tahoe', apply: true })
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
      expect(buildJobArgs({ kind: 'discover_pois', region: 'lake-tahoe', apply }).spends).toBe(false)
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

  // The fused CLI gained a freshness skip, so the console needs a way to re-narrate a region whose
  // clusters are all fresh — otherwise "Fuse clusters" would report "nothing to narrate" forever with
  // no override. Off by default: a re-narration overwrites the script with no history to roll back to.
  test('generate_cluster_narrations threads --force, and omits it unless asked', () => {
    expect(buildJobArgs({ kind: 'generate_cluster_narrations', region: 'lake-tahoe', force: true }).args)
      .toContain('--force')
    expect(buildJobArgs({ kind: 'generate_cluster_narrations', region: 'lake-tahoe' }).args)
      .not.toContain('--force')
  })

  test('PAID kinds spend IFF --apply (dry run = free preview; apply = confirm-gated spend)', () => {
    const paid = [
      { kind: 'enrich_pois', region: 'lake-tahoe' },
      { kind: 'generate_narrations', region: 'lake-tahoe' },
      { kind: 'curate_places', region: 'lake-tahoe' },
      { kind: 'offline_audit', region: 'lake-tahoe' },
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

  test('an unknown kind is rejected, never dispatched', () => {
    expect(() => buildJobArgs({ kind: 'nope' })).toThrow()
    // The V1 tour kinds left the enum on 2026-08-02, so they are now unknown strings like any other.
    // Still asserted by name: the reason they must never dispatch has not changed, and a future
    // "restore the legacy kinds" edit should fail here rather than silently wire a missing script.
    for (const gone of ['generate', 'patch_clip', 'resynth']) {
      expect(() => buildJobArgs({ kind: gone })).toThrow()
    }
  })

  test('EVERY declared jobKind has a dispatchable script', () => {
    // The invariant the sediment used to prevent. `SCRIPTS` is typed `Partial` because the LOOKUP key
    // is untrusted (buildJobArgs casts an untrusted body), NOT because kinds may legitimately be
    // missing — so nothing but this test stands between "declared in the enum" and "actually
    // dispatchable". Add a kind without wiring a script and it fails here.
    for (const kind of jobKind.options) {
      expect(SCRIPTS[kind], `jobKind '${kind}' has no script in SCRIPTS`).toBeTruthy()
    }
  })

  test('poi-targeted kinds require a poiId', () => {
    expect(() => buildJobArgs({ kind: 'resynth_narration' })).toThrow()
    expect(() => buildJobArgs({ kind: 'refetch_facts' })).toThrow()
  })
})

describe('buildJobArgs — numeric flag validation (the server is the trust boundary — audit #7)', () => {
  test('a valid positive limit / max-cost is threaded', () => {
    const r = buildJobArgs({ kind: 'enrich_pois', region: 'lake-tahoe', limit: 5, maxCostUsd: 12.5 })
    expect(r.args).toContain('--limit=5')
    expect(r.args).toContain('--max-cost=12.5')
  })

  test('REJECTS a non-numeric max-cost instead of emitting --max-cost=NaN (which would disable the cap)', () => {
    expect(() => buildJobArgs({ kind: 'enrich_pois', region: 'lake-tahoe', maxCostUsd: 'abc' })).toThrow()
    expect(() => buildJobArgs({ kind: 'generate_narrations', region: 'lake-tahoe', maxCostUsd: 'lots' })).toThrow()
  })

  test('REJECTS a negative / zero-or-less limit or max-cost', () => {
    expect(() => buildJobArgs({ kind: 'enrich_pois', region: 'lake-tahoe', maxCostUsd: -5 })).toThrow()
    expect(() => buildJobArgs({ kind: 'offline_audit', region: 'lake-tahoe', limit: -1 })).toThrow()
  })

  test('an absent (falsy/0) numeric flag stays a no-op — no flag emitted, no throw', () => {
    const r = buildJobArgs({ kind: 'enrich_pois', region: 'lake-tahoe' })
    expect(r.args.some((a) => a.startsWith('--limit'))).toBe(false)
    expect(r.args.some((a) => a.startsWith('--max-cost'))).toBe(false)
    expect(() => buildJobArgs({ kind: 'enrich_pois', region: 'lake-tahoe', limit: 0, maxCostUsd: 0 })).not.toThrow()
  })
})

describe('a trigger whose outcome is UNKNOWN must not free the target', () => {
  const jobsSrc = readFileSync(join(import.meta.dir, 'jobs.ts'), 'utf8')
  const indexSrc = readFileSync(join(import.meta.dir, 'index.ts'), 'utf8')

  // runJob threw the same Error for "Cloud Run refused" and "we never read the response", and the
  // route settled the row 'failed' either way — releasing the in-flight lock with a NULL execution
  // name and telling the operator nothing had started. The obvious retry then ran the same PAID work
  // a second time, concurrently with the first.
  test('a definite non-2xx throws a distinct error type', () => {
    expect(jobsSrc).toContain('export class TriggerRejected extends Error')
    expect(jobsSrc).toContain('throw new TriggerRejected')
  })

  test('only a definite refusal settles the row failed; the ambiguous case stays queued', () => {
    expect(indexSrc).toContain('if (e instanceof TriggerRejected)')
    const from = indexSrc.indexOf('if (e instanceof TriggerRejected)')
    const branch = indexSrc.slice(from, from + 1600)
    expect(branch).toContain('trigger_unknown')
    // everything after the refusal branch returns must not write a terminal status
    const ambiguous = branch.slice(branch.indexOf('AMBIGUOUS'))
    expect(ambiguous).not.toContain("status: 'failed'")
    expect(ambiguous.length).toBeGreaterThan(0)
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

  test('an explicit-id generate run spans no single region — the SLUG is NULL (shown as "All")', () => {
    const r = buildJobArgs({ kind: 'generate_narrations', includeIds: ['a', 'b'] })
    expect(r.targetSlug).toBeUndefined() // → stored NULL, never the old 'roam-corpus' sentinel
    // ⚠ targetId is NO LONGER null here (changed 2026-08-03). It keys on the SELECTION, because a
    // null target_id cannot collide on `studio_jobs_active_target_uq` at all — Postgres treats NULLs
    // as distinct in a unique index — so the "atomic backstop against a double-submit / retry" the
    // schema promises did not exist for exactly these runs. See scopeTarget.
    expect(r.targetId).toMatch(/^ids:[0-9a-f]{16}$/)
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
    // ⚠ hand-picked still does not lock the REGION — but it now locks its own SELECTION (2026-08-03).
    // The display label is not a lock key: two different hand-picked runs carry different labels, so
    // keying the check on it let them both proceed while `target_id` stayed NULL and the unique index
    // could never fire. Same selection ⇒ same key ⇒ the retry 409s.
    expect(r.targetId).toMatch(/^ids:[0-9a-f]{16}$/)
    expect(r.args.join(' ')).not.toContain('scopeLabel')
    expect(r.args.join(' ')).not.toContain('2 hand-picked')
  })

  test('the selection lock is order-invariant, exclusion-aware, and distinguishes selections', () => {
    // The three properties the retry guard actually rests on. Order-invariance matters because the
    // console builds the id list from a Set: the same 40 rows can serialize in a different order on a
    // retry, and a second key for one selection is exactly the double-spend this closes.
    const key = (b: Record<string, unknown>) => buildJobArgs({ kind: 'generate_narrations', ...b }).targetId
    expect(key({ includeIds: ['b', 'a'] })).toBe(key({ includeIds: ['a', 'b'] })!)
    expect(key({ includeIds: ['a', 'b'] })).not.toBe(key({ includeIds: ['a', 'c'] })!)
    // A select-all-minus-a-few run that carries no region lock is a DIFFERENT selection from the same
    // include set with nothing excluded.
    expect(key({ includeIds: ['a', 'b'], excludeIds: ['b'] })).not.toBe(key({ includeIds: ['a', 'b'] })!)
    // ⚠ An explicit region lock still WINS — select-all must keep colliding with a CLI run of the same
    // region, which is what keeps admin- and CLI-triggered runs on one lock (audit #9).
    expect(key({ includeIds: ['a', 'b'], lockRegion: 'lake-tahoe' })).toBe('lake-tahoe')
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

  // ⚠ REPLACES "a region-less run falls back to the default region slug" (founder, 2026-08-03). The
  // fallback was 'lake-tahoe' hardcoded here AND in studio's config.ts — two copies, one comment
  // holding them together — and once a second region existed it meant a run typed for Yosemite would
  // bill Tahoe's corpus and settle green. Both copies are deleted; a region-less run is now a 400 on
  // this side and a thrown `requireRegionKey` on the CLI side.
  test('a region-less run is REJECTED, never defaulted to a region nobody named', () => {
    expect(() => buildJobArgs({ kind: 'generate_narrations' })).toThrow(/region is required/)
    expect(() => buildJobArgs({ kind: 'discover_pois' })).toThrow(/region is required/)
    expect(() => buildJobArgs({ kind: 'curate_places' })).toThrow(/region is required/)
    expect(() => buildJobArgs({ kind: 'generate_scenic_narrations' })).toThrow(/region is required/)
    expect(() => buildJobArgs({ kind: 'generate_cluster_narrations' })).toThrow(/region is required/)
  })

  // The one exemption, and it is the same one the CLIs make: a hand-picked id list already names its
  // rows, spans no single region, and locks on its SELECTION instead (see `selectionLock`).
  test('an explicit-id run needs no region — it locks on its selection', () => {
    expect(() => buildJobArgs({ kind: 'generate_narrations', includeIds: ['a', 'b'] })).not.toThrow()
    expect(() =>
      buildJobArgs({ kind: 'generate_cluster_narrations', includeIds: ['c1'] }),
    ).not.toThrow()
  })

  test('discover_pois keys on the region; sweep_orphans matches its script target', () => {
    expect(buildJobArgs({ kind: 'discover_pois', region: 'yosemite' }).targetId).toBe('yosemite')
    expect(buildJobArgs({ kind: 'sweep_orphans' }).targetId).toBe('narration') // audit #11 (was 'roam')
  })

  test('curate_places keys on the region (required) and threads model/target/max-cost', () => {
    expect(buildJobArgs({ kind: 'curate_places', region: 'yosemite' }).targetId).toBe('yosemite')
    const r = buildJobArgs({ kind: 'curate_places', apply: true, region: 'lake-tahoe', model: 'opus', target: 24, maxCostUsd: 2 })
    expect(r.args).toContain('--region=lake-tahoe')
    expect(r.args).toContain('--model=opus')
    expect(r.args).toContain('--target=24')
    expect(r.args).toContain('--max-cost=2')
    expect(r.args).toContain('--apply')
  })
})
