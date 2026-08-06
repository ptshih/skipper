/**
 * The admin SPA bundles workspace SOURCE — so a VALUE import needs that package's `src` in the image.
 *
 * ⚠ WHY A TEST AND NOT A COMMENT. `apps/admin/Dockerfile` stage 1 copies each workspace package's
 * `package.json` but not its `src/`, and for a long time that was invisible: every `@skipper/*` import
 * in `client/` was `import type`, which TypeScript ERASES before the bundler resolves anything. The
 * first value import (`parseRegionBboxes` in `google-map.tsx`, 2026-08-06) failed with
 * `Rolldown failed to resolve import "@skipper/engine"` — and it failed ONLY INSIDE THE IMAGE. Locally
 * the whole monorepo is on disk, so `bun run build`, `tsc --noEmit` and the root `check` all passed and
 * the break surfaced at deploy, after the API had already shipped.
 *
 * That is the failure mode this file exists to end: a green local build proving nothing about the
 * container. The check is cheap and structural — it reads the two files and compares them.
 *
 * ⚠ It does NOT check the Cloud Build trigger's `includedFiles`, which must ALSO name the package
 * (GCP-side config, not in this repo — see docs/guides/gcp-cloud-run-deploy.md). Nothing here can see
 * that, so the guide is the only record; adding a value import means doing both.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '../../..')
const CLIENT_SRC = join(ROOT, 'apps/admin/client/src')
const DOCKERFILE = readFileSync(join(ROOT, 'apps/admin/Dockerfile'), 'utf8')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') || p.endsWith('.tsx') ? [p] : []
  })
}

/** `@skipper/*` packages the client imports as VALUES (a bare `import type` line does not count). */
function valueImportedPackages(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const file of walk(CLIENT_SRC)) {
    if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue
    const src = readFileSync(file, 'utf8')
    // `import ... from '@skipper/x'` where the clause does not begin with `type`. A mixed clause
    // (`import { a, type B }`) DOES import a value, so only a leading `import type` is exempt.
    // ⚠ THE CLAUSE MUST NOT CONTAIN ANOTHER `from` — a plain `[\s\S]*?` spans newlines, so an earlier
    // `import … from 'react'` matched all the way down to the next `@skipper` line and reported every
    // type-only import as a value one. Caught by this file's own "not vacuously green" sibling test.
    for (const m of src.matchAll(/^import\s+(?!type\b)((?:(?!from\s)[\s\S])*?)from\s+'(@skipper\/[a-z-]+)'/gm)) {
      const pkg = m[2]!.replace('@skipper/', '')
      out.set(pkg, [...(out.get(pkg) ?? []), file.slice(ROOT.length + 1)])
    }
  }
  return out
}

/** Stage 1 of the Dockerfile — everything before the second `FROM`, i.e. the SPA build. */
const webStage = DOCKERFILE.split(/^FROM /m)[1] ?? ''

describe('admin SPA image — a value import from a workspace package needs its src COPYed', () => {
  test('every @skipper/* package the client imports as a VALUE has its src in stage 1', () => {
    const missing: string[] = []
    for (const [pkg, files] of valueImportedPackages()) {
      if (!webStage.includes(`COPY packages/${pkg}/src`)) {
        missing.push(`@skipper/${pkg} (imported by ${files.join(', ')})`)
      }
    }
    expect(missing).toEqual([])
  })

  // Guards the guard: if the regex stopped matching anything, the test above would pass vacuously and
  // this whole file would be decoration. `google-map.tsx` is the reason it exists, so it must be seen.
  test('the scan actually finds the known value import (not vacuously green)', () => {
    const found = valueImportedPackages()
    expect(found.has('engine')).toBe(true)
    expect(found.get('engine')?.some((f) => f.includes('google-map'))).toBe(true)
  })

  test('a bare `import type` is NOT treated as a value import', () => {
    // @skipper/shared is type-only in the client today; if that ever changes this flips and the first
    // test starts requiring its src, which is exactly the intended behaviour.
    const typeOnly = readFileSync(join(CLIENT_SRC, 'lib/api.ts'), 'utf8')
    expect(typeOnly).toMatch(/import type \{[^}]*\} from '@skipper\/shared'/)
  })
})
