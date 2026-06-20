import { describe, expect, test } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import { buildExciseUser, exciseUngrounded, type ExciseModelCall } from '../src/eval/excise'

const toolReply = (script: unknown): Anthropic.Message =>
  ({ content: [{ type: 'tool_use', name: 'repaired', id: 't', input: { script } }] }) as Anthropic.Message
const textReply = (): Anthropic.Message =>
  ({ content: [{ type: 'text', text: 'no tool', citations: null }] }) as Anthropic.Message

describe('exciseUngrounded — trim the flagged lines, keep the rest, never the model on a no-op', () => {
  test('nothing flagged → returns the script unchanged WITHOUT calling the model', async () => {
    let called = false
    const call: ExciseModelCall = async () => {
      called = true
      return toolReply('x')
    }
    const out = await exciseUngrounded('A grounded telling.', [], call)
    expect(out).toBe('A grounded telling.')
    expect(called).toBe(false)
  })

  test('returns the edited script the model produced (trimmed)', async () => {
    const out = await exciseUngrounded('full', ['ungrounded place-claim: "X"'], async () =>
      toolReply('  the body, minus the flourish.  '),
    )
    expect(out).toBe('the body, minus the flourish.')
  })

  test('malformed reply (no tool call) → NO-OP, returns the original (the loop then withholds)', async () => {
    const original = 'the original take.'
    const out = await exciseUngrounded(original, ['ungrounded place-claim: "X"'], async () => textReply())
    expect(out).toBe(original)
  })

  test('empty/whitespace edit → NO-OP, returns the original (never ships an emptied clip)', async () => {
    const original = 'the original take.'
    const out = await exciseUngrounded(original, ['ungrounded place-claim: "X"'], async () => toolReply('   '))
    expect(out).toBe(original)
  })
})

describe('buildExciseUser — the flagged claims then the script', () => {
  test('lists each flagged claim and includes the script', () => {
    const user = buildExciseUser('SCRIPT BODY', ['ungrounded place-claim: "A"', 'ungrounded place-claim: "B"'])
    expect(user).toContain('- ungrounded place-claim: "A"')
    expect(user).toContain('- ungrounded place-claim: "B"')
    expect(user).toContain('SCRIPT BODY')
    expect(user.indexOf('A"')).toBeLessThan(user.indexOf('SCRIPT BODY')) // claims before the script
  })
})
