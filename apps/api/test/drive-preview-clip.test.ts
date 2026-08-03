// The anonymous preview clip (1.1 step 8a — D14/INV-5): what the picker returns, and — the harder
// half — WHICH MAP it is handed.
//
// ⚠ STATE THE LIMITATION UP FRONT, because it shapes every test below. INV-5 is NOT a claim about
// `previewClipFor`. Hand the picker a staged row and it will happily presign it; that is correct and
// unavoidable, because the picker's job is to pick. The invariant lives one level up, in the call
// graph: the propose handler must pass the RELEASE-FILTERED build corpus (`loadCorpusForRoute`) and
// never the deliberately unfiltered, staged-inclusive replay map (`corpusForSelection` /
// `loadCorpusBySubjectIds`). Those two maps are structurally identical — same type, same rows, same
// response bytes — which is exactly why the mistake would typecheck clean, return 200, and publish
// unreleased work to a stranger with nothing failing. So this file attacks the call graph and the
// query, not just the function.
//
// Three layers, weakest last:
//   1. the picker's behaviour + the exact SHAPE it puts on an anonymous wire (runtime)
//   2. the sole staged bypass — an anonymous session can never obtain it (runtime)
//   3. source-level tripwires over the /propose handler and the `BuildCorpus` brand (text)
// Layer 3 is ugly on purpose. It is the only layer that survives a refactor that deletes the brand,
// and it fails loudly on precisely the edit INV-5 forbids.
//
// ⚠ NEEDS NO SECRET, NO DB AND NO R2. `../src/storage` is mocked (spread + delegate, per the
// process-wide `mock.module` landmine documented in plan-stream.test.ts) so presigning is a pure
// function here; nothing in this file issues a query or an S3 call.

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drivePreviewClip } from '@skipper/shared'
import type { DriveStop } from '@skipper/engine'
import { isAdmin } from '@skipper/shared'

/* ------------------------------- the presign ------------------------------ */

/** Non-null only inside a test that is driving. `presignGet` reaches for R2 env and throws without it,
 *  so at rest this delegates to the real one and any other file keeps the real behaviour. */
let presignImpl: ((key: string) => string) | null = null
const realStorage = { ...(await import('../src/storage')) }
mock.module('../src/storage', () => ({
  ...realStorage,
  presignGet: (key: string, ttl?: number) =>
    presignImpl ? presignImpl(key) : realStorage.presignGet(key, ttl),
}))

const { previewClipFor } = await import('../src/drives')

// The corpus row type, recovered from the exported brand rather than re-declared — `NarrationRow`
// itself is module-private, and duplicating it here would let a fixture drift from the real shape.
type Corpus = import('../src/drives').BuildCorpus
type CorpusRow = Corpus extends Map<string, infer R> ? R : never

afterEach(() => {
  presignImpl = null
})

/* ------------------------------- the fixtures ----------------------------- */

const stop = (seq: number, subjectId: string, extra: Partial<DriveStop> = {}): DriveStop => ({
  seq,
  poiId: subjectId, // DriveStop.poiId carries the SUBJECT id (a poi id or a cluster id)
  audioKey: `narrations/${subjectId}.m4a`,
  audioDurationMs: 60_000,
  triggerLat: 39.1,
  triggerLng: -120.1,
  approachHeadingDeg: 90,
  alongSec: seq * 300,
  ...extra,
})

const row = (subjectId: string, over: Partial<CorpusRow> = {}): CorpusRow =>
  ({
    narrationId: `narr-${subjectId}`,
    subjectId,
    subjectKind: 'poi',
    poiId: subjectId,
    form: 'story',
    key: `narrations/${subjectId}.m4a`,
    durationMs: 60_000,
    attribution: undefined,
    revisedAt: null,
    name: `Place ${subjectId}`,
    kind: 'landmark',
    lat: 39.1,
    lng: -120.1,
    anchored: true,
    varietyKey: 'landmark',
    ...over,
  }) as CorpusRow

/** ⚠ The `as unknown as Corpus` is the TEST's cast, and it is not a hole in the invariant. The brand
 *  exists so that PRODUCTION code cannot obtain a `BuildCorpus` from the unfiltered replay loader; a
 *  test constructing a fixture map is not that path. Layer 3 below pins that the brand is asserted in
 *  exactly one place in `src/drives.ts`. */
const corpusOf = (...rows: CorpusRow[]): Corpus =>
  new Map(rows.map((r) => [r.subjectId, r])) as unknown as Corpus

/* -------------------------------------------------------------------------- */
/*  Layer 1 — the picker                                                       */
/* -------------------------------------------------------------------------- */

describe('previewClipFor — the taste is the drive’s OPENING BEAT', () => {
  test('picks stops[0], NOT the longest clip — preview and product can never disagree', () => {
    // ⚠ This pins a charm decision, not an implementation detail. seq 0 is literally the first thing
    // the rider hears if they buy the drive, so the taste IS the product's opening beat; it also
    // manufactures the anticipate beat instead of spending it. Ranking by duration would override
    // buildDrive's own judgement (where length is only the LAST tiebreak inside a gap window) and is
    // the ranking that produced "3rd Street Flats over the Reno Arch". If someone "improves" the
    // picker to argmax-by-duration, this is the test that should stop them.
    presignImpl = (key) => `https://r2.example/${key}?sig=stub`
    // ⚠ The duration has to be long on BOTH sides of the join — `DriveStop.audioDurationMs` AND the
    // corpus row's `durationMs` — or the fixture only refutes one of the two ways someone would write
    // an argmax. Mutation-checked: with a uniform `audioDurationMs` a sort-by-stop-duration mutant
    // stayed GREEN, because a stable sort leaves equal keys in place. Keep them in step.
    const stops = [
      stop(0, 'a', { audioDurationMs: 30_000 }),
      stop(1, 'b', { audioDurationMs: 90_000 }),
      stop(2, 'c', { audioDurationMs: 240_000 }),
    ]
    const corpus = corpusOf(
      row('a', { durationMs: 30_000, name: 'The Opening Beat' }),
      row('b', { durationMs: 90_000, name: 'Middle' }),
      row('c', { durationMs: 240_000, name: 'The Longest Clip By Far' }),
    )
    expect(previewClipFor(stops, corpus)?.name).toBe('The Opening Beat')
  })

  test('a stop whose subject vanished from the corpus is SKIPPED, not fatal', () => {
    // Impossible today (stops are built FROM corpus entries) and cheap to survive — the `continue`
    // is defensive only. Worth pinning so nobody "simplifies" it into `stops[0]` + a bang.
    presignImpl = (key) => `https://r2.example/${key}`
    const clip = previewClipFor([stop(0, 'gone'), stop(1, 'here')], corpusOf(row('here', { name: 'Here' })))
    expect(clip?.name).toBe('Here')
  })

  test('an empty selection degrades to null — a 0-stop route is a valid 200', () => {
    // The zero-stop path (review §1.10): the route, the distance and the stop count are all still
    // true, and the wall is downstream, so there is nothing to 503 about. This is why the wire field
    // is nullable rather than a required object.
    presignImpl = () => 'https://r2.example/never-called'
    expect(previewClipFor([], corpusOf(row('a')))).toBeNull()
  })

  test('a presign FAILURE degrades to null — it never throws and never 503s', () => {
    // Contrast POST /drives (`audioUnavailable` → 503), where the credit is already spent and a 200
    // would strand the rider. Here the credit is unspent and the preview is free: taking down an
    // otherwise-valid free preview over a missing clip is the worse trade.
    // ⚠ Also mutation-checked: with the try/catch removed this test fails with a thrown error.
    const errs: unknown[] = []
    const realError = console.error
    console.error = (...a: unknown[]) => void errs.push(a)
    try {
      presignImpl = () => {
        throw new Error('R2_ACCESS_KEY_ID is not set (R2 access).')
      }
      expect(previewClipFor([stop(0, 'a')], corpusOf(row('a')))).toBeNull()
    } finally {
      console.error = realError
    }
    expect(errs.length).toBe(1) // logged once, non-fatal
    // INV-13: the log carries no body, no key and no URL — only a label and the error object.
    expect(JSON.stringify(errs[0])).not.toContain('narrations/a.m4a')
  })

  test('attribution rides along when the row has one (Wikipedia is CC BY-SA — legal, not decoration)', () => {
    presignImpl = (key) => `https://r2.example/${key}`
    const attribution = [
      { source: 'wikipedia' as const, sourceId: 'Q42', title: 'Somewhere', license: 'CC BY-SA 4.0' },
    ]
    const clip = previewClipFor([stop(0, 'a')], corpusOf(row('a', { attribution })))
    expect(clip?.attribution).toEqual(attribution)
    // …and the KEY is absent (not `undefined`) when there is nothing to credit, so the wire stays clean.
    const bare = previewClipFor([stop(0, 'a')], corpusOf(row('a')))
    expect('attribution' in (bare as object)).toBe(false)
  })

  test('contentType is derived from the R2 key, not hardcoded', () => {
    presignImpl = (key) => `https://r2.example/${key}`
    const clip = previewClipFor([stop(0, 'a')], corpusOf(row('a', { key: 'narrations/a.m4a' })))
    expect(clip?.contentType).toBe('audio/mp4')
  })
})

describe('⚠ the SERVER’s object carries no geometry and no corpus key', () => {
  test('exactly {name, url, contentType, durationMs} (+ attribution) — nothing else', () => {
    // ⚠ ASSERTED ON THE OBJECT THE SERVER CONSTRUCTS, never on a parsed one. `drivePreviewClip` is a
    // plain `z.object`, which STRIPS unknown keys — so a schema-side assertion would stay green while
    // the handler leaked. (packages/shared owns the schema-shape tests; this is the other half.)
    presignImpl = (key) => `https://r2.example/${key}`
    const clip = previewClipFor([stop(0, 'a')], corpusOf(row('a')))
    expect(clip).not.toBeNull()
    expect(new Set(Object.keys(clip as object))).toEqual(
      new Set(['name', 'url', 'contentType', 'durationMs']),
    )
    // Named individually as well, so a failure says WHICH corpus key or trigger coordinate escaped:
    // a stable subject id lets a stranger correlate a POI across routes, and lat/lng/triggerRadiusM
    // is exact trigger geometry for a place nobody paid for. This is why the DTO is deliberately NOT
    // `driveClip` — reusing it would put all of them on an anonymous wire.
    for (const forbidden of [
      'subjectId',
      'subjectKind',
      'poiId',
      'narrationId',
      'lat',
      'lng',
      'triggerRadiusM',
      'seq',
      'alongSec',
      'approachHeadingDeg',
      'revisedAt',
      'form',
      'key',
      'audioKey',
    ]) {
      expect(clip).not.toHaveProperty(forbidden)
    }
  })

  test('the constructed object satisfies the shared wire schema', () => {
    // The server's object and the DTO agree — a handler-side field rename can't quietly stop parsing.
    presignImpl = (key) => `https://r2.example/${key}`
    const clip = previewClipFor([stop(0, 'a')], corpusOf(row('a')))
    expect(drivePreviewClip.safeParse(clip).success).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/*  Layer 2 — the sole staged bypass                                           */
/* -------------------------------------------------------------------------- */

describe('⚠ INV-5: an ANONYMOUS session can never obtain the staged bypass', () => {
  // `POST /propose` widens the corpus to staged clips iff `isAdmin(c.get('session'))`. The general
  // contract for isAdmin lives in entitlements.test.ts; this pins the one case the anonymous front
  // door depends on — because after the mint (D16) every rider carries a real `user` row, and the
  // question "could a minted row ever read staged content?" is now asked on every anonymous request.
  test('a minted anonymous row is not an admin, even if its role column said so', () => {
    expect(isAdmin({ user: { isAnonymous: true, role: 'admin' } })).toBe(false)
    expect(isAdmin({ user: { isAnonymous: true, role: 'user' } })).toBe(false)
    expect(isAdmin(null)).toBe(false) // the fail-open degradation — a false NEGATIVE, the safe direction
    expect(isAdmin({ user: { isAnonymous: false, role: 'user' } })).toBe(false)
    expect(isAdmin({ user: { isAnonymous: false, role: 'admin' } })).toBe(true)
  })
})

/* -------------------------------------------------------------------------- */
/*  Layer 3 — source tripwires over the call graph                             */
/* -------------------------------------------------------------------------- */

const SRC = readFileSync(join(import.meta.dir, '../src/drives.ts'), 'utf8')

/** Comments stripped, so a tripwire fires on CODE and not on a comment that legitimately names the
 *  forbidden loader (drives.ts's own ⚠ blocks name all of them, on purpose). */
const codeOnly = (s: string) =>
  s
    .split('\n')
    .filter((l) => {
      const t = l.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
    })
    .join('\n')

/** The `POST /propose` handler body: from its registration to the next top-level declaration. */
function proposeHandler(): string {
  const start = SRC.indexOf("driveRoutes.post('/propose'")
  expect(start).toBeGreaterThan(-1)
  const end = SRC.indexOf('\nconst createDriveLimiter', start)
  expect(end).toBeGreaterThan(start)
  return codeOnly(SRC.slice(start, end))
}

describe('⚠ INV-5: the anonymous preview is fed the RELEASE-FILTERED build corpus', () => {
  test('the /propose handler takes its corpus from selectStopsForRoute and hands it straight to the picker', () => {
    const body = proposeHandler()
    expect(body).toContain('const { corpus, stops } = await selectStopsForRoute(')
    expect(body).toContain('previewClipFor(stops, corpus)')
  })

  test('the /propose handler NEVER mentions the unfiltered replay loaders', () => {
    // The one edit INV-5 forbids, and the reason a test has to say it out loud: swapping in
    // `corpusForSelection` here hands a stranger a presigned, downloadable URL to STAGED work — with
    // an identical response shape, status, duration and attribution, so nothing else in this repo
    // would notice. It would additionally bypass the `excluded_reason` and cluster-supersession
    // filters, i.e. serve the WORST clip in the corpus as the taste.
    const body = proposeHandler()
    for (const forbidden of [
      'corpusForSelection',
      'loadCorpusBySubjectIds',
      'manifestForStoredDrive',
      'manifestClips',
      'includeStaged',
    ]) {
      expect(body).not.toContain(forbidden)
    }
  })

  test('the staged bypass is wired as isAdmin(session) — never a literal, never the tier', () => {
    const body = proposeHandler()
    expect(body).toContain("isAdmin(c.get('session'))")
    expect(body).not.toContain('selectStopsForRoute(route, true)')
    expect(body).not.toContain("c.get('tier')")
  })
})

describe('⚠ INV-5: the BuildCorpus brand is asserted in exactly ONE place', () => {
  test('`as BuildCorpus` appears once, inside loadCorpusForRoute', () => {
    // The brand is ASSERTED, not proven — the loader's cast is trusted. That trust is only worth
    // anything while there is exactly one cast: a second `as BuildCorpus` anywhere else is the only
    // way to hand the picker an unfiltered map without a compile error, so count them.
    const code = codeOnly(SRC)
    const casts = code.match(/as BuildCorpus\b/g) ?? []
    expect(casts.length).toBe(1)
    const loader = code.slice(
      code.indexOf('async function loadCorpusForRoute('),
      code.indexOf('const candidateOf ='),
    )
    expect(loader).toContain('as BuildCorpus')
  })

  test('previewClipFor takes a BuildCorpus, not a plain Map', () => {
    // What makes the forbidden swap a COMPILE error rather than a silent publication. Verified by
    // mutation at build time (pointing the handler at `corpusForSelection(...)` → TS2345); this test
    // is the cheap standing guard that the signature has not been widened back to `Map<...>`.
    expect(codeOnly(SRC)).toContain('corpus: BuildCorpus')
  })

  // ⚠ THE BRAND'S OWN DELETION IS THE GAP THE TWO TEXT TESTS ABOVE CANNOT SEE. Both of them keep
  // passing if someone "simplifies" `Map<…> & { readonly [releaseFiltered]: true }` down to a bare
  // `Map<…>`: the string `corpus: BuildCorpus` is still there, the single `as BuildCorpus` is still
  // there (merely redundant, which tsc does not complain about), and `bun run check` stays green —
  // while INV-5's compile-time guard has quietly become a comment. This is the only assertion that
  // notices, and it is a COMPILE-time one: if the intersection goes, a plain Map becomes assignable
  // to BuildCorpus, the conditional resolves to 'BRAND DELETED', and this file stops typechecking.
  // ⚠ It is deliberately not a runtime `expect` — the property is nominal typing, which has no
  // runtime representation to assert on.
  // The value type is INFERRED from the brand itself rather than written out, so the probe stays an
  // exact match: with the intersection present a plain `Map<string, V>` lacks the symbol and does not
  // extend it; without it the two are the same type and the conditional flips.
  type CorpusValue = Corpus extends Map<string, infer V> ? V : never
  const _brandIsNominal: Map<string, CorpusValue> extends Corpus ? 'BRAND DELETED' : 'ok' = 'ok'
  void _brandIsNominal

  test('the unfiltered replay loaders cannot produce the brand', () => {
    const code = codeOnly(SRC)
    expect(code).toContain(
      'async function loadCorpusBySubjectIds(subjectIds: string[]): Promise<Map<string, NarrationRow>>',
    )
    expect(code).toContain(
      'async function corpusForSelection(selection: DriveSelectionItem[]): Promise<Map<string, NarrationRow>>',
    )
  })

  test('the release predicate is on the BUILD query, and keyed on includeStaged', () => {
    // Both halves of the build corpus carry it: the poi query here, and the fused-telling query in
    // ../src/clusters. Drizzle's `and()` DROPS an undefined operand, so `includeStaged === true`
    // removes the predicate entirely rather than replacing it with a tautology.
    expect(codeOnly(SRC)).toContain('includeStaged ? undefined : isNotNull(narrations.releasedAt)')
    const clusters = codeOnly(readFileSync(join(import.meta.dir, '../src/clusters.ts'), 'utf8'))
    expect(clusters).toContain('includeStaged ? undefined : isNotNull(narrations.releasedAt)')
  })
})
