import { describe, expect, test } from 'bun:test'
import {
  buildGroundingWell,
  evaluateGrounding,
  normalizeClaims,
  type ClaimDecomposer,
  type GroundingInput,
} from '../src/eval/grounding'
import { buildScorecard } from '../src/eval/scorecard'
import type { ClaimVerdict, StopEval } from '../src/eval/types'

const input = (over: Partial<GroundingInput> = {}): GroundingInput => ({
  seq: 0,
  stopType: 'story',
  placeName: 'Emerald Bay',
  script: 'some script',
  well: ['Emerald Bay is a bay on Lake Tahoe.'],
  region: 'Lake Tahoe',
  corridor: 'Emerald Bay Run',
  ...over,
})

/** A decomposer that returns whatever verdicts you hand it — no model call. */
const fake = (verdicts: ClaimVerdict[]): ClaimDecomposer => async () => verdicts

describe('evaluateGrounding — the gate scoring', () => {
  test('all grounded → pass, score 1, no findings', async () => {
    const e = await evaluateGrounding(
      input(),
      fake([
        { claim: 'it is a bay on Lake Tahoe', status: 'grounded', evidence: 'Emerald Bay is a bay...' },
        { claim: 'on Lake Tahoe', status: 'ambient', evidence: 'names the region' },
      ]),
    )
    expect(e.pass).toBe(true)
    expect(e.score).toBe(1)
    expect(e.findings).toHaveLength(0)
    expect(e.dimension).toBe('grounding')
  })

  test('one ungrounded among grounded → FAIL, fractional score, finding surfaced', async () => {
    const e = await evaluateGrounding(
      input({ seq: 3 }),
      fake([
        { claim: 'a bay on Lake Tahoe', status: 'grounded', evidence: 'sheet line' },
        { claim: 'one of the deepest spots on the lake', status: 'ungrounded', evidence: null },
        { claim: 'mountain mornings are cold', status: 'ambient', evidence: 'world knowledge' },
      ]),
    )
    expect(e.pass).toBe(false)
    expect(e.seq).toBe(3)
    expect(e.score).toBeCloseTo(2 / 3, 5) // 2 of 3 claims are clean
    expect(e.findings).toHaveLength(1)
    expect(e.findings[0]).toContain('one of the deepest spots')
  })

  test('no factual claims → pass, score 1 (a pure-delivery scenic stop)', async () => {
    const e = await evaluateGrounding(input({ stopType: 'scenic', placeName: undefined }), fake([]))
    expect(e.pass).toBe(true)
    expect(e.score).toBe(1)
  })
})

describe('normalizeClaims — never trust the wire (the non-array crash regression)', () => {
  test('a proper array maps through, unknown status → ungrounded', () => {
    const out = normalizeClaims([
      { claim: 'a', status: 'grounded', evidence: 'x' },
      { claim: 'b', status: 'weird', evidence: null },
    ])
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ claim: 'a', status: 'grounded', evidence: 'x' })
    expect(out[1]!.status).toBe('ungrounded') // unrecognized status is a violation, never passed
  })

  test('a lone claim OBJECT (not wrapped in an array) is recovered, not crashed', () => {
    // The exact shape that threw `(call.input.claims ?? []).map is not a function`.
    const out = normalizeClaims({ claim: 'one fact', status: 'grounded', evidence: 'sheet' })
    expect(out).toEqual([{ claim: 'one fact', status: 'grounded', evidence: 'sheet' }])
  })

  test('null / undefined → empty list (the legitimate no-claims case)', () => {
    expect(normalizeClaims(null)).toEqual([])
    expect(normalizeClaims(undefined)).toEqual([])
  })

  test('a primitive (string/number) → empty list, never throws', () => {
    expect(() => normalizeClaims('nope')).not.toThrow()
    expect(normalizeClaims('nope')).toEqual([])
    expect(normalizeClaims(42)).toEqual([])
  })

  test('array entries missing fields get safe defaults', () => {
    const out = normalizeClaims([{}, { claim: 7, status: 'grounded', evidence: 9 }])
    expect(out[0]).toEqual({ claim: '(unspecified claim)', status: 'ungrounded', evidence: null })
    expect(out[1]).toEqual({ claim: '(unspecified claim)', status: 'grounded', evidence: null })
  })

  test('a coerced lone object flows through evaluateGrounding without crashing', async () => {
    const e = await evaluateGrounding(
      input(),
      async () => normalizeClaims({ claim: 'invented depth', status: 'ungrounded', evidence: null }),
    )
    expect(e.pass).toBe(false) // one ungrounded claim, surfaced — not a skipped audit
    expect(e.findings).toHaveLength(1)
  })
})

describe('buildGroundingWell — the permitted well mirrors the narration sheet', () => {
  test('story: facts + side line + geology + wikidata + merged-feature facts (name-prefixed)', () => {
    const well = buildGroundingWell({
      stopType: 'story',
      name: 'Emerald Bay State Park',
      kind: 'park',
      sideOfRoad: 'right',
      facts: ['Emerald Bay State Park is a state park.'],
      geology: ['Bedrock here is granite.'],
      wikidata: ['Inception: 1953.'],
      mergedFeatures: [{ name: 'Fannette Island', facts: ['the only island in Lake Tahoe'] }],
    })
    expect(well).toContain('Emerald Bay State Park is a state park.')
    expect(well).toContain('Emerald Bay State Park is on the right side of the road.')
    expect(well).toContain('Bedrock here is granite.')
    expect(well).toContain('Inception: 1953.')
    expect(well).toContain('Fannette Island: the only island in Lake Tahoe')
  })

  test('NAMED scenic: one line licensing exactly name + kind + side, plus geology', () => {
    const well = buildGroundingWell({
      stopType: 'scenic',
      name: 'Sand Harbor',
      kind: 'beach',
      sideOfRoad: 'right',
      geology: ['Bedrock here is granodiorite.'],
    })
    expect(well).toHaveLength(2)
    expect(well[0]).toContain('Sand Harbor')
    expect(well[0]).toContain('beach')
    expect(well[0]).toContain('right')
    expect(well[1]).toBe('Bedrock here is granodiorite.')
  })

  test('UNNAMED scenic: geology only — no name line to bless', () => {
    const well = buildGroundingWell({ stopType: 'scenic', name: '', geology: ['Granite underfoot.'] })
    expect(well).toEqual(['Granite underfoot.'])
  })

  test('break: the spoken name + kind line only', () => {
    const well = buildGroundingWell({ stopType: 'break', name: 'Where We Met', kind: 'café' })
    expect(well).toHaveLength(1)
    expect(well[0]).toContain('Where We Met')
    expect(well[0]).toContain('café')
  })

  test('story facts never leak onto a scenic well (no-place-facts invariant)', () => {
    const well = buildGroundingWell({
      stopType: 'scenic',
      name: 'Sand Harbor',
      facts: ['should not appear'],
      wikidata: ['should not appear either'],
    })
    expect(well.join(' ')).not.toContain('should not appear')
    // wikidata is STORY-only by the enrichment contract, but the builder is defensive:
    // a scenic stop's well must never carry identifying place-facts.
  })
})

describe('buildScorecard — rollup + the gate', () => {
  const groundingEval = (seq: number, pass: boolean, score: number): StopEval => ({
    seq,
    dimension: 'grounding',
    pass,
    score,
    findings: pass ? [] : ['ungrounded place-claim: "..."'],
  })
  const charmEval = (seq: number, pass: boolean): StopEval => ({
    seq,
    dimension: 'charm',
    pass,
    score: pass ? 1 : 0.4,
    findings: pass ? [] : ['flat closer'],
  })

  test('a grounding (GATE) failure fails the whole tour', () => {
    const card = buildScorecard({
      slug: 'emerald-bay-run',
      runName: 'Emerald Bay',
      evaluatedAt: null,
      stops: [groundingEval(0, true, 1), groundingEval(1, false, 0.5), groundingEval(2, true, 1)],
    })
    expect(card.pass).toBe(false)
    const g = card.dimensions.find((d) => d.dimension === 'grounding')!
    expect(g.kind).toBe('gate')
    expect(g.stopsFailed).toBe(1)
    expect(g.stopsEvaluated).toBe(3)
    expect(g.score).toBeCloseTo((1 + 0.5 + 1) / 3, 5)
  })

  test('an ADVISORY (charm) failure does NOT fail the tour', () => {
    const card = buildScorecard({
      slug: 't',
      runName: 'T',
      evaluatedAt: null,
      stops: [groundingEval(0, true, 1), charmEval(0, false), charmEval(1, false)],
    })
    expect(card.pass).toBe(true) // only gate dimensions block
    const charm = card.dimensions.find((d) => d.dimension === 'charm')!
    expect(charm.kind).toBe('advisory')
    expect(charm.pass).toBe(false)
    expect(charm.stopsFailed).toBe(2)
    // (this same case proves the all-gates-clean → card.pass=true path: the grounding gate passes here)
  })
})
