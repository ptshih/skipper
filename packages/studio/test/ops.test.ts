import { describe, expect, test } from 'bun:test'
import { parseFlags } from '../src/pipeline/ops'
import { orphanKeys, reapableKeys, SWEEP_MIN_AGE_MS } from '../src/pipeline/storage'

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

describe('orphanKeys', () => {
  test('returns only unreferenced keys', () => {
    const listed = ['clips/t/a.mp3', 'clips/t/b.mp3', 'clips/t/c.mp3']
    const referenced = new Set(['clips/t/b.mp3'])
    expect(orphanKeys(listed, referenced)).toEqual(['clips/t/a.mp3', 'clips/t/c.mp3'])
  })

  test('never returns a referenced key', () => {
    const listed = ['clips/t/a.mp3', 'clips/t/b.mp3']
    expect(orphanKeys(listed, new Set(listed))).toEqual([])
  })

  test('empty listed → empty', () => {
    expect(orphanKeys([], new Set(['x']))).toEqual([])
  })

  test('empty referenced → everything is an orphan', () => {
    expect(orphanKeys(['a', 'b'], new Set())).toEqual(['a', 'b'])
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
