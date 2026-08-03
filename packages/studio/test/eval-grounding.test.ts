import { describe, expect, test } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import {
  buildGroundingWell,
  claimsFromResponse,
  evaluateGrounding,
  makeVotingDecomposer,
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

/** A base decomposer that returns a different verdict-set on each successive call (simulating the
 *  judge's run-to-run noise), and counts how many times it was called. */
const sequenceFake = (sets: ClaimVerdict[][]) => {
  let calls = 0
  const decompose: ClaimDecomposer = async () => sets[Math.min(calls++, sets.length - 1)] ?? []
  return { decompose, calls: () => calls }
}
const ungrounded = (claim: string): ClaimVerdict => ({ claim, status: 'ungrounded', evidence: null })
const grounded = (claim: string): ClaimVerdict => ({ claim, status: 'grounded', evidence: 'sheet' })

describe('makeVotingDecomposer — union k samples for fail-closed recall', () => {
  test('k ≤ 1 returns the base decomposer unchanged (identity)', () => {
    const base: ClaimDecomposer = async () => []
    expect(makeVotingDecomposer(base, 1)).toBe(base)
    expect(makeVotingDecomposer(base, 0)).toBe(base)
  })

  test('a claim flagged by ANY sample is ungrounded (union — the recall win)', async () => {
    // Sample 1 clean, sample 2 catches "tallest", sample 3 clean — exactly the noise calibration saw.
    const { decompose } = sequenceFake([
      [grounded('a Queen Anne')],
      [grounded('a Queen Anne'), ungrounded('tallest turret in the state')],
      [grounded('a Queen Anne')],
    ])
    const out = await makeVotingDecomposer(decompose, 3)(input())
    expect(out.filter((c) => c.status === 'ungrounded').map((c) => c.claim)).toContain(
      'tallest turret in the state',
    )
  })

  test('calls the base exactly k times', async () => {
    const sf = sequenceFake([[grounded('x')]])
    await makeVotingDecomposer(sf.decompose, 3)(input())
    expect(sf.calls()).toBe(3)
  })

  test('the same violation across samples is deduped to one finding (case-insensitive)', async () => {
    const { decompose } = sequenceFake([
      [ungrounded('three hundred feet deep')],
      [ungrounded('Three Hundred Feet Deep')],
      [ungrounded('three hundred feet deep')],
    ])
    const out = await makeVotingDecomposer(decompose, 3)(input())
    expect(out.filter((c) => c.status === 'ungrounded')).toHaveLength(1)
  })

  test('all samples clean → passes through evaluateGrounding clean', async () => {
    const { decompose } = sequenceFake([
      [grounded('a'), { claim: 'b', status: 'ambient', evidence: 'region' }],
    ])
    const e = await evaluateGrounding(input(), makeVotingDecomposer(decompose, 3))
    expect(e.pass).toBe(true)
    expect(e.findings).toHaveLength(0)
  })

  test('a claim grounded in sample 0 but flagged by another → kept ONCE as ungrounded (fail-closed, no dupe)', async () => {
    const { decompose } = sequenceFake([
      [grounded('the span'), grounded('safe fact')],
      [grounded('the span'), grounded('safe fact')],
      [ungrounded('the span'), grounded('safe fact')],
    ])
    const out = await makeVotingDecomposer(decompose, 3)(input())
    const theSpan = out.filter((c) => c.claim.toLowerCase() === 'the span')
    expect(theSpan).toHaveLength(1)
    expect(theSpan[0]!.status).toBe('ungrounded')
    expect(out.some((c) => c.claim === 'safe fact' && c.status === 'grounded')).toBe(true)
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

// ── claimsFromResponse — the gate must FAIL CLOSED on an untrustworthy verdict ───────────────────
// evaluateGrounding scores an empty claim list `pass: true, score: 1`. That is correct for a clip
// that genuinely speaks no place-claims, and catastrophic for a judge reply that was cut short: the
// two used to be the same shape. These pin the distinction. A throw is the fail-closed direction —
// both generators catch a gate throw per clip and record it WITHHELD.
describe('claimsFromResponse — a truncated audit is never a clean audit', () => {
  const toolCall = (input: unknown, stop: string | null = 'tool_use'): Anthropic.Message =>
    ({
      content: [{ type: 'tool_use', id: 't1', name: 'report', input }],
      stop_reason: stop,
      usage: { input_tokens: 10, output_tokens: 10 },
    }) as unknown as Anthropic.Message

  test('a well-formed verdict passes through and normalizes', () => {
    const out = claimsFromResponse(
      toolCall({ claims: [{ claim: 'a bay on Lake Tahoe', status: 'grounded', evidence: 'sheet' }] }),
      0,
    )
    expect(out).toHaveLength(1)
    expect(out[0]!.status).toBe('grounded')
  })

  test('claims: [] is a LEGITIMATE zero-claim verdict and still passes', async () => {
    // The distinction that matters: present-and-empty is a real answer, absent is a missing one.
    const out = claimsFromResponse(toolCall({ claims: [] }), 0)
    expect(out).toEqual([])
    const e = await evaluateGrounding(input(), async () => out)
    expect(e.pass).toBe(true)
    expect(e.score).toBe(1)
  })

  test('stop_reason max_tokens THROWS — a cut-off verdict must not score 1.0', () => {
    expect(() => claimsFromResponse(toolCall({ claims: [] }, 'max_tokens'), 7)).toThrow(/truncated/i)
    // ...even when the partial call still carries some claims: the rest of them are unknown.
    expect(() =>
      claimsFromResponse(toolCall({ claims: [{ claim: 'x', status: 'grounded' }] }, 'max_tokens'), 7),
    ).toThrow(/truncated/i)
  })

  test('a tool call with NO claims key THROWS rather than reading as "nothing wrong"', () => {
    // The tool schema marks `claims` required, so its absence means malformed/cut-short — the exact
    // shape that used to reach normalizeClaims(undefined) → [] → pass, score 1, clip ships.
    expect(() => claimsFromResponse(toolCall({}), 3)).toThrow(/claims/)
  })

  test('no tool call at all still throws', () => {
    const textOnly = {
      content: [{ type: 'text', text: 'I think it is fine' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    } as unknown as Anthropic.Message
    expect(() => claimsFromResponse(textOnly, 1)).toThrow(/no tool call/)
  })

  test('a non-array claims value is still COERCED, not thrown on (the old crash regression)', () => {
    expect(claimsFromResponse(toolCall({ claims: null }), 0)).toEqual([])
    expect(claimsFromResponse(toolCall({ claims: { claim: 'one', status: 'grounded' } }), 0)).toHaveLength(1)
  })

  // ⚠ A PRIMITIVE is the half of "coerce it" that was dangerous, and it is not hypothetical: it fired
  // TWICE in the first three-clip paid scenic run (2026-08-03). A lone OBJECT is recoverable as a
  // one-element list (above); a string or number is NOT, so it fell through to [] — and an empty claim
  // list scores `pass: true, score: 1`. That is a PERFECT grounding verdict on a clip nobody audited,
  // out of a fail-CLOSED gate.
  //
  // ⚠ Most likely on the SCENIC path specifically: that well is one line, so the judge has almost
  // nothing to decompose and is the most prone to answering with a bare string.
  test('a PRIMITIVE claims value THROWS — coercing it to [] scored an unaudited clip 1.0', () => {
    expect(() => claimsFromResponse(toolCall({ claims: 'no claims found' }), 0)).toThrow(/primitive/i)
    expect(() => claimsFromResponse(toolCall({ claims: 42 }), 0)).toThrow(/primitive/i)
    // The control: the shapes either side of it must still behave as before.
    expect(claimsFromResponse(toolCall({ claims: [] }), 0)).toEqual([])
    expect(claimsFromResponse(toolCall({ claims: null }), 0)).toEqual([])
  })
})
