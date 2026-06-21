import { describe, expect, test } from 'bun:test'
import { applyLoudnessOutcomes, applyTailOutcomes, evaluateTts } from '../src/eval/tts'
import type { LoudnessOutcomeLike, TailOutcomeLike } from '../src/eval/tts'

const ev = (script: string) => evaluateTts({ seq: 0, script })

describe('evaluateTts — deterministic cleanliness gate', () => {
  test('clean spoken prose passes — em-dashes, ellipses, quotes, parens, apostrophes are fine', () => {
    const e = ev(
      'Coming up on the right — Emerald Bay, folks. It is, frankly, a beaut... and yes, ' +
        '"the jewel of the lake" (their words, not mine). Don\'t blink.',
    )
    expect(e.pass).toBe(true)
    expect(e.score).toBe(1)
    expect(e.dimension).toBe('tts')
    expect(e.findings).toHaveLength(0)
  })

  test('flags markdown emphasis / code', () => {
    expect(ev('it is **really** something').pass).toBe(false)
    expect(ev('a _quiet_ cove').pass).toBe(false)
    expect(ev('the `lighthouse`').pass).toBe(false)
  })

  test('flags a markdown link and a bare URL', () => {
    expect(ev('see [the bay](https://x.y)').findings.some((f) => f.includes('link'))).toBe(true)
    expect(ev('more at https://tahoe.example').findings.some((f) => f.includes('URL'))).toBe(true)
  })

  test('flags list markers at line start and headings', () => {
    expect(ev('Stops:\n- the bay\n- the castle').pass).toBe(false)
    expect(ev('## Emerald Bay\nhere we are').pass).toBe(false)
  })

  test('flags an SSML/HTML tag', () => {
    expect(ev('wait for it <break time="500ms"/> there').pass).toBe(false)
  })

  test('flags emoji (renders as tofu, TTS chokes)', () => {
    expect(ev('what a view 😍').pass).toBe(false)
  })

  test('a year like 1960 is NOT flagged (digits are intentionally not gated)', () => {
    const e = ev('back in 1960, the games came to Squaw Valley')
    expect(e.pass).toBe(true)
  })
})

describe('applyTailOutcomes — fold the TTS-phase tail verdicts into the tts dim', () => {
  const cleanEval = (seq: number) => evaluateTts({ seq, script: 'a clean spoken line' })
  const outcome = (over: Partial<TailOutcomeLike> = {}): TailOutcomeLike => ({
    firstDropDb: 5.2,
    keptDropDb: 1.1,
    retook: true,
    shippedCollapsed: false,
    ...over,
  })

  test('no outcome / unmeasured / clean first take → the script verdict stands, untouched', () => {
    const evals = [cleanEval(1), cleanEval(2)]
    const folded = applyTailOutcomes(
      evals,
      new Map<number, TailOutcomeLike | null>([
        [1, null],
        [2, outcome({ retook: false })],
      ]),
    )
    expect(folded[0]).toBe(evals[0]!) // seq 1: probe skipped
    expect(folded[1]).toBe(evals[1]!) // seq 2: measured clean, never retook
  })

  test('a retake that FIXED the collapse rides as detail, pass unchanged', () => {
    const [e] = applyTailOutcomes([cleanEval(3)], new Map([[3, outcome()]]))
    expect(e!.pass).toBe(true)
    expect(e!.findings).toHaveLength(0)
    expect((e!.detail as { tailRetake: TailOutcomeLike }).tailRetake.firstDropDb).toBe(5.2)
  })

  test('a shipped take that STILL collapses fails the stop tts row with a finding', () => {
    const [e] = applyTailOutcomes(
      [cleanEval(4)],
      new Map([[4, outcome({ keptDropDb: 4.4, shippedCollapsed: true })]]),
    )
    expect(e!.pass).toBe(false)
    expect(e!.score).toBe(0)
    expect(e!.findings.some((f) => f.includes('tail-collapse') && f.includes('4.4 dB'))).toBe(true)
  })

  test('non-tts dimensions pass through untouched', () => {
    const grounding = { seq: 5, dimension: 'grounding' as const, pass: true, score: 1, findings: [] }
    const [g] = applyTailOutcomes(
      [grounding],
      new Map([[5, outcome({ shippedCollapsed: true, keptDropDb: 9 })]]),
    )
    expect(g).toBe(grounding)
  })
})

describe('applyLoudnessOutcomes — fold the post-encode loudness verdicts into the tts dim', () => {
  const cleanEval = (seq: number) => evaluateTts({ seq, script: 'a clean spoken line' })
  const loud = (over: Partial<LoudnessOutcomeLike> = {}): LoudnessOutcomeLike => ({
    integratedLufs: -14.2,
    truePeakDb: -1.7,
    loudnessOk: true,
    truePeakOk: true,
    ...over,
  })

  test('unmeasured (ffmpeg miss) → the row stands untouched', () => {
    const evals = [cleanEval(1)]
    const folded = applyLoudnessOutcomes(evals, new Map<number, LoudnessOutcomeLike | null>([[1, null]]))
    expect(folded[0]).toBe(evals[0]!)
  })

  test('an in-spec clip rides along as detail, pass unchanged', () => {
    const [e] = applyLoudnessOutcomes([cleanEval(2)], new Map([[2, loud()]]))
    expect(e!.pass).toBe(true)
    expect(e!.findings).toHaveLength(0)
    expect((e!.detail as { loudness: LoudnessOutcomeLike }).loudness.integratedLufs).toBe(-14.2)
  })

  test('an off-target integrated loudness fails the tts row with a finding', () => {
    const [e] = applyLoudnessOutcomes([cleanEval(3)], new Map([[3, loud({ integratedLufs: -15.6, loudnessOk: false })]]))
    expect(e!.pass).toBe(false)
    expect(e!.score).toBe(0)
    expect(e!.findings.some((f) => f.includes('loudness') && f.includes('-15.6'))).toBe(true)
  })

  test('a true-peak ceiling breach (AAC overshoot) fails the row — the +1.4 dBTP defect', () => {
    const [e] = applyLoudnessOutcomes([cleanEval(4)], new Map([[4, loud({ truePeakDb: 1.4, truePeakOk: false })]]))
    expect(e!.pass).toBe(false)
    expect(e!.findings.some((f) => f.includes('true-peak') && f.includes('1.4'))).toBe(true)
  })

  test('both off-target AND clipping → both findings accumulate', () => {
    const [e] = applyLoudnessOutcomes(
      [cleanEval(5)],
      new Map([[5, loud({ integratedLufs: -16, loudnessOk: false, truePeakDb: 0.5, truePeakOk: false })]]),
    )
    expect(e!.findings.filter((f) => f.includes('loudness') || f.includes('true-peak'))).toHaveLength(2)
  })

  test('composes after applyTailOutcomes — a tail finding and a loudness finding stack on one row', () => {
    const collapsed: TailOutcomeLike = { firstDropDb: 6, keptDropDb: 4.4, retook: true, shippedCollapsed: true }
    const tailFolded = applyTailOutcomes([cleanEval(6)], new Map<number, TailOutcomeLike | null>([[6, collapsed]]))
    const [e] = applyLoudnessOutcomes(tailFolded, new Map([[6, loud({ truePeakDb: 0.2, truePeakOk: false })]]))
    expect(e!.pass).toBe(false)
    expect(e!.findings.some((f) => f.includes('tail-collapse'))).toBe(true)
    expect(e!.findings.some((f) => f.includes('true-peak'))).toBe(true)
  })

  test('non-tts dimensions pass through untouched', () => {
    const grounding = { seq: 7, dimension: 'grounding' as const, pass: true, score: 1, findings: [] }
    const [g] = applyLoudnessOutcomes([grounding], new Map([[7, loud({ loudnessOk: false })]]))
    expect(g).toBe(grounding)
  })
})
