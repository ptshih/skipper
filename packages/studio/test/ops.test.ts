import { describe, expect, test } from 'bun:test'
import { maxCostFlag, numericFlag, parseFlags } from '../src/pipeline/ops'
import { reapableKeys, SWEEP_MIN_AGE_MS } from '../src/pipeline/storage'

describe('parseFlags', () => {
  test('separates positionals from boolean flags', () => {
    const f = parseFlags(['abc123', '--apply'])
    expect(f.positionals).toEqual(['abc123'])
    expect(f.has('apply')).toBe(true)
    expect(f.has('yes')).toBe(false)
  })

  test('reads --name=value and --name value', () => {
    expect(parseFlags(['--find=hello']).value('find')).toBe('hello')
    expect(parseFlags(['--find', 'hello']).value('find')).toBe('hello')
    expect(parseFlags(['--apply']).value('find')).toBeUndefined()
  })

  test('value flags do not leak into positionals', () => {
    const f = parseFlags(['stop-1', '--find', 'x', '--replace', 'y', '--all'], {
      valueFlags: ['find', 'replace'],
    })
    expect(f.positionals).toEqual(['stop-1']) // NOT ['stop-1','x','y']
    expect(f.value('find')).toBe('x')
    expect(f.value('replace')).toBe('y')
    expect(f.has('all')).toBe(true)
  })

  test('a positional that equals a flag value still resolves by position', () => {
    const f = parseFlags(['y', '--replace', 'y'], { valueFlags: ['replace'] })
    expect(f.positionals[0]).toBe('y')
    expect(f.value('replace')).toBe('y')
  })

  test('an empty-string value is preserved (delete-by-replace)', () => {
    expect(parseFlags(['--replace', '']).value('replace')).toBe('')
  })

  test('a value flag followed by another flag has no value', () => {
    expect(parseFlags(['--find', '--apply']).value('find')).toBeUndefined()
  })
})

describe('reapableKeys — the age guard that keeps the sweep off a live generate', () => {
  const NOW = Date.parse('2026-08-02T12:00:00Z')
  const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString()

  test('an unreferenced object older than the window is reapable', () => {
    const { reap, heldBack } = reapableKeys(
      [{ key: 'narration/p/old.m4a', lastModified: at(120) }],
      new Set(),
      { now: NOW },
    )
    expect(reap).toEqual(['narration/p/old.m4a'])
    expect(heldBack).toEqual([])
  })

  test('several unreferenced objects come back in listed order', () => {
    const listed = [
      { key: 'narration/p/a.m4a', lastModified: at(120) },
      { key: 'narration/p/b.m4a', lastModified: at(120) },
      { key: 'narration/p/c.m4a', lastModified: at(120) },
    ]
    const { reap } = reapableKeys(listed, new Set(['narration/p/b.m4a']), { now: NOW })
    expect(reap).toEqual(['narration/p/a.m4a', 'narration/p/c.m4a'])
  })

  // THE bug this exists for: generate-narrations uploads the bytes, THEN writes the narrations row.
  // In between, a healthy clip is indistinguishable from an orphan — and deleting it leaves the row
  // pointing at a key that no longer exists, with audio_url NOT NULL so nothing complains.
  test('a just-uploaded object is held back, not deleted', () => {
    const { reap, heldBack } = reapableKeys(
      [{ key: 'narration/p/fresh.m4a', lastModified: at(2) }],
      new Set(),
      { now: NOW },
    )
    expect(reap).toEqual([])
    expect(heldBack).toEqual(['narration/p/fresh.m4a'])
  })

  test('a referenced key is never reaped, at any age', () => {
    const listed = [{ key: 'narration/p/live.m4a', lastModified: at(9999) }]
    const { reap, heldBack } = reapableKeys(listed, new Set(['narration/p/live.m4a']), { now: NOW })
    expect(reap).toEqual([])
    expect(heldBack).toEqual([]) // referenced ⇒ not an orphan at all, so not "held back" either
  })

  test('an UNKNOWN age is treated as too young — it must not authorise a delete', () => {
    const { reap, heldBack } = reapableKeys(
      [
        { key: 'narration/p/nodate.m4a', lastModified: null },
        { key: 'narration/p/garbage.m4a', lastModified: 'not-a-date' },
      ],
      new Set(),
      { now: NOW },
    )
    expect(reap).toEqual([])
    expect(heldBack).toEqual(['narration/p/nodate.m4a', 'narration/p/garbage.m4a'])
  })

  test('the boundary is inclusive-of-older: exactly the window old is reapable', () => {
    const exact = new Date(NOW - SWEEP_MIN_AGE_MS).toISOString()
    expect(reapableKeys([{ key: 'k', lastModified: exact }], new Set(), { now: NOW }).reap).toEqual(['k'])
  })
})

// ── numericFlag / maxCostFlag — the spend brakes must FAIL CLOSED ────────────────────────────────
// These parsers guard real money. Every caller gates as `if (cap !== Infinity && …)`, so a value the
// parser rejects does not tighten the cap, it REMOVES it — which is why "reject" has to mean throw,
// not fall back. The cases below are the literal operator typos that used to buy an uncapped run.
describe('numericFlag — a rejected value never becomes "no limit"', () => {
  const f = (...argv: string[]) => parseFlags(argv, { valueFlags: ['limit', 'max-cost'] })

  test('ABSENT → the fallback, untouched', () => {
    expect(numericFlag(f('--apply'), 'limit', { fallback: Infinity })).toBe(Infinity)
    expect(numericFlag(f('--apply'), 'limit', { fallback: 1 })).toBe(1)
  })

  test('a good value parses, in both flag forms', () => {
    expect(numericFlag(f('--limit', '5'), 'limit', { fallback: Infinity })).toBe(5)
    expect(numericFlag(f('--limit=5'), 'limit', { fallback: Infinity })).toBe(5)
    expect(numericFlag(f('--limit=2.5'), 'limit', { fallback: 1 })).toBe(2.5)
  })

  test('a TYPO throws — it must not silently read as no limit', () => {
    // `5o` (letter O) is the fat-finger that produced NaN, and NaN disables a comparison rather
    // than bounding it: `queue.length >= NaN` is never true, so audit-corpus swept the whole corpus.
    expect(() => numericFlag(f('--limit', '5o'), 'limit', { fallback: Infinity })).toThrow(/--limit/)
    expect(() => numericFlag(f('--limit', 'abc'), 'limit', { fallback: Infinity })).toThrow()
  })

  test('a value-less flag throws rather than inheriting the fallback', () => {
    // `--limit --apply`: parseFlags yields undefined when the next token is itself a flag, so this
    // used to be indistinguishable from "flag absent" — the operator asked for a bound and got none.
    expect(() => numericFlag(f('--limit', '--apply'), 'limit', { fallback: Infinity })).toThrow()
    expect(() => numericFlag(f('--limit='), 'limit', { fallback: Infinity })).toThrow()
  })

  test('zero and negatives throw — "spend nothing" must never mean "spend anything"', () => {
    expect(() => numericFlag(f('--limit', '0'), 'limit', { fallback: Infinity })).toThrow()
    expect(() => numericFlag(f('--limit', '-5'), 'limit', { fallback: Infinity })).toThrow()
  })
})

describe('maxCostFlag — the cost ceiling', () => {
  const f = (...argv: string[]) => parseFlags(argv, { valueFlags: ['max-cost'] })

  test('unset → Infinity (no cap is the documented default)', () => {
    expect(maxCostFlag(f('--apply'))).toBe(Infinity)
  })

  test('a real cap parses', () => {
    expect(maxCostFlag(f('--max-cost', '12.5'))).toBe(12.5)
    expect(maxCostFlag(f('--max-cost=2'))).toBe(2)
  })

  test('every shape that used to silently uncap a PAID run now throws', () => {
    for (const argv of [['--max-cost', '0'], ['--max-cost', '-5'], ['--max-cost', '5usd'], ['--max-cost', '--apply'], ['--max-cost=']]) {
      expect(() => maxCostFlag(f(...argv))).toThrow()
    }
  })
})
