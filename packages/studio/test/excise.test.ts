import { describe, expect, test } from 'bun:test'
import { buildExciseUser, exciseUngrounded, type ExciseModelCall } from '../src/eval/excise'
import type { ReplyLike } from '../src/pipeline/tool-call'

const reply = (parts: unknown[], finishReason = 'STOP'): ReplyLike => ({ candidates: [{ content: { role: 'model', parts }, finishReason }] }) as ReplyLike
const toolReply = (script: unknown, finishReason = 'STOP'): ReplyLike =>
  reply([{ functionCall: { id: 't', name: 'repaired', args: { script } } }], finishReason)
const textReply = (): ReplyLike => reply([{ text: 'no tool' }])

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

describe('exciseUngrounded — a truncated edit', () => {
  // ⚠ A truncated edit is a script that stops mid-sentence, and the grounding re-gate cannot see that —
  // fewer claims only reads as CLEANER. So a MAX_TOKENS reply is a no-op, never an edit.
  test('a TRUNCATED reply is a NO-OP even when it carries a script', async () => {
    const original = 'Up ahead is Vikingsholm. It had forty rooms.'
    const out = await exciseUngrounded(original, ['It had forty rooms.'], WELL, async () => toolReply('Up ahead is Vikings', 'MAX_TOKENS'))
    expect(out).toBe(original)
  })
})
