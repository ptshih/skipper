import { describe, expect, test } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import {
  classifyFromMatches,
  classifyRegisterLLM,
  REGISTER_BY_ANCHOR,
} from '../src/pipeline/classify-register'

describe('classifyFromMatches — unanimous structural match, else abstain', () => {
  test('exactly one distinct register is trusted', () => {
    expect(classifyFromMatches(['landscape'])).toEqual({ register: 'landscape', basis: 'single' })
  })

  test('duplicate matches of the same register are still unanimous', () => {
    expect(classifyFromMatches(['town', 'town']).register).toBe('town')
  })

  test('no anchor match abstains (→ LLM fallback)', () => {
    expect(classifyFromMatches([])).toEqual({ register: null, reason: 'no-anchor-match', matched: [] })
  })

  test('a conflict (≥2 distinct registers) abstains rather than guessing', () => {
    const r = classifyFromMatches(['story', 'civic', 'story'])
    expect(r.register).toBeNull()
    expect(r).toMatchObject({ reason: 'conflict' })
    expect([...(r as { matched: string[] }).matched].sort()).toEqual(['civic', 'story'])
  })
})

describe('register anchors — the live-preview fixes are guarded', () => {
  test('reservoir is NOT civic (reads as a lake → landscape); only the dam is civic', () => {
    expect(REGISTER_BY_ANCHOR['Q131681']).toBeUndefined() // reservoir
    expect(REGISTER_BY_ANCHOR['Q12323']).toBe('civic') // dam
    expect(REGISTER_BY_ANCHOR['Q23397']).toBe('landscape') // lake
    expect(REGISTER_BY_ANCHOR['Q486972']).toBe('town') // human settlement
  })

  test('an event (Q9634 "1960 Winter Olympics" walks P279* → event) is story, not civic', () => {
    expect(REGISTER_BY_ANCHOR['Q1656682']).toBe('story') // event
    // the same anchor caught the misroute deterministically instead of the LLM tipping it to civic
    expect(classifyFromMatches(['story']).register).toBe('story')
  })
})

describe('classifyRegisterLLM — fallback over the fact sheet (injected call)', () => {
  const toolReply = (register: string): Anthropic.Message =>
    ({ content: [{ type: 'tool_use', name: 'register', id: 't', input: { register } }] }) as Anthropic.Message

  test('returns the register the model chose', async () => {
    const r = await classifyRegisterLLM({ name: 'Boca Dam', kind: 'dam', factSheet: '…' }, async () => toolReply('civic'))
    expect(r).toBe('civic')
  })

  test('defaults to story on a malformed / refused reply (the safe warm base)', async () => {
    const r = await classifyRegisterLLM(
      { name: 'X', kind: null, factSheet: '…' },
      async () => ({ content: [{ type: 'text', text: 'no tool', citations: null }] }) as Anthropic.Message,
    )
    expect(r).toBe('story')
  })
})
