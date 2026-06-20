import { describe, expect, test } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import { buildExciseUser, exciseUngrounded, type ExciseModelCall } from '../src/eval/excise'

const toolReply = (script: unknown): Anthropic.Message =>
  ({ content: [{ type: 'tool_use', name: 'repaired', id: 't', input: { script } }] }) as Anthropic.Message
const textReply = (): Anthropic.Message =>
  ({ content: [{ type: 'text', text: 'no tool', citations: null }] }) as Anthropic.Message

const WELL = ['The zoo housed big cats.']

describe('exciseUngrounded — repair the flagged claims, keep the rest, never the model on a no-op', () => {
  test('nothing flagged → returns the script unchanged WITHOUT calling the model', async () => {
    let called = false
    const call: ExciseModelCall = async () => {
      called = true
      return toolReply('x')
    }
    const out = await exciseUngrounded('A grounded telling.', [], [], call)
    expect(out).toBe('A grounded telling.')
    expect(called).toBe(false)
  })

  test('returns the edited script the model produced (trimmed or generalized)', async () => {
    const out = await exciseUngrounded('full', ['ungrounded place-claim: "X"'], WELL, async () =>
      toolReply('  the body, minus the flourish.  '),
    )
    expect(out).toBe('the body, minus the flourish.')
  })

  test('malformed reply (no tool call) → NO-OP, returns the original (the loop then withholds)', async () => {
    const original = 'the original take.'
    const out = await exciseUngrounded(original, ['ungrounded place-claim: "X"'], WELL, async () => textReply())
    expect(out).toBe(original)
  })

  test('empty/whitespace edit → NO-OP, returns the original (never ships an emptied clip)', async () => {
    const original = 'the original take.'
    const out = await exciseUngrounded(original, ['ungrounded place-claim: "X"'], WELL, async () =>
      toolReply('   '),
    )
    expect(out).toBe(original)
  })
})

describe('buildExciseUser — the fact sheet, then the flagged claims, then the script', () => {
  test('lists each flagged claim and includes the script', () => {
    const user = buildExciseUser(
      'SCRIPT BODY',
      ['ungrounded place-claim: "A"', 'ungrounded place-claim: "B"'],
      WELL,
    )
    expect(user).toContain('- ungrounded place-claim: "A"')
    expect(user).toContain('- ungrounded place-claim: "B"')
    expect(user).toContain('SCRIPT BODY')
    expect(user.indexOf('A"')).toBeLessThan(user.indexOf('SCRIPT BODY')) // claims before the script
  })

  test('includes the fact sheet (what a fix may generalize toward) ahead of the script', () => {
    const user = buildExciseUser('SCRIPT BODY', ['ungrounded place-claim: "lions"'], WELL)
    expect(user).toContain('The zoo housed big cats.') // the sheet the editor generalizes toward
    expect(user.indexOf('big cats')).toBeLessThan(user.indexOf('SCRIPT BODY')) // sheet before the script
  })

  test('an empty well renders a placeholder, never a bare label', () => {
    const user = buildExciseUser('S', ['ungrounded place-claim: "A"'], [])
    expect(user).toContain('(empty')
  })
})
