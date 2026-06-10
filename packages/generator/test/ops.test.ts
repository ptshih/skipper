import { describe, expect, test } from 'bun:test'
import { parseFlags } from '../src/pipeline/ops'
import { orphanKeys } from '../src/pipeline/storage'

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
