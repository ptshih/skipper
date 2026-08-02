/**
 * Pins the terminal-status one-way latch in `beginJob`.
 *
 * A studio_jobs row that has gone terminal must never come back. That is enforced in five places:
 * the admin's `expireStuckJob`, its `reconcileJobFromExecution`, its cancel route, `finishJob`'s
 * `audit #4` WHERE — and, since 2026-08-02, `beginJob`. It was the only one of the five that wrote
 * `status: 'running'` unconditionally, which made it the single path that could UN-cancel a run.
 *
 * The failure it allowed was not cosmetic. Cloud Run cancellation is not instantaneous — a task
 * already scheduled still starts — so an operator who canceled a paid `enrich_pois --apply` or
 * `generate_narrations --apply` seconds after dispatch had their cancel overwritten by the container
 * as it booted. The row read 'running' again, `finishJob`'s guard then passed because 'running' is
 * non-terminal, and the run settled normally. They were told it was canceled; it billed in full.
 *
 * ⚠ WHY THIS IS A SOURCE ASSERTION AND NOT A BEHAVIOURAL TEST. `beginJob` writes through
 * `@skipper/db`, and studio's suite is zero-network by construction — every model call in this
 * package is an injected seam, but the db client is not one. Faking it would mean `mock.module`,
 * which this repo has been bitten by before (mocks are PROCESS-WIDE, so a file green in isolation
 * poisoned another and turned 96 pass into 9 fail). A source assertion is the honest instrument for
 * a guard that cannot be exercised here: it pins the exact line whose removal reopens the hole, and
 * it says out loud that it proves the code is WRITTEN correctly, not that it RUNS correctly.
 *
 * This is the same shape as apps/admin/server/jobs.test.ts, which greps each dispatch target off
 * disk for `runJob(`, and apps/api/test/auth-delete-hook.test.ts.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '..', 'src')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

/** Strip comments — the notes below quote the old behaviour to explain it, and a naive grep matches prose. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('studio_jobs terminal latch', () => {
  const progress = code(read('pipeline/job-progress.ts'))

  test("beginJob's upsert refuses to resurrect a terminal row", () => {
    const fn = progress.slice(progress.indexOf('export async function beginJob'))
    const body = fn.slice(0, fn.indexOf('export async function finishJob'))
    expect(body).toContain('onConflictDoUpdate')
    // the guard itself — without this, `set: { status: 'running' }` applies to ANY existing row
    expect(body).toMatch(/setWhere:\s*inArray\(studioJobs\.status,\s*\['queued',\s*'running'\]\)/)
  })

  test('beginJob reports whether the run may proceed, rather than returning void', () => {
    expect(progress).toMatch(/export async function beginJob\([^)]*\): Promise<boolean>/)
  })

  test('runJob does not run the work when beginJob refuses', () => {
    const fn = progress.slice(progress.indexOf('export async function runJob'))
    expect(fn).toMatch(/if \(beginFields && !\(await beginJob\(kind, beginFields\)\)\) return/)
  })

  test('every standalone beginJob caller honours the refusal too', () => {
    // These two call beginJob inside main() (they need parsed flags first) and pass `null` for
    // beginFields, so runJob's guard above does NOT cover them — they must check for themselves.
    for (const f of ['sweep-orphans.ts', 'refetch-poi.ts']) {
      const src = code(read(f))
      expect(src).toContain('await beginJob(')
      expect(src, `${f} calls beginJob without honouring its return`).toMatch(
        /if \(!\(await beginJob\([\s\S]*?\)\)\) return/,
      )
    }
  })

  test('finishJob still guards the same latch (the pre-existing audit #4 half)', () => {
    const fn = progress.slice(progress.indexOf('export async function finishJob'))
    expect(fn).toMatch(/inArray\(studioJobs\.status,\s*\['queued',\s*'running'\]\)/)
  })
})
