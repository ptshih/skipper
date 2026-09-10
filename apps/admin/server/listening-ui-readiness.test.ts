import { expect, test } from 'bun:test'
import { pendingListeningItems } from '../client/src/lib/listening-readiness'
const item = { narrationId: 'one', queue: 'reel', verdict: 'unreviewed', advisoryReason: '', technical: { ok: true } }
const clip = { narration: { id: 'one' }, findings: [] }
test('required listening blocks approval; untouched optional clips do not', () => {
  expect(pendingListeningItems([item], [clip])).toBe(1)
  expect(pendingListeningItems([{ ...item, verdict: 'good' }], [clip])).toBe(0)
  expect(pendingListeningItems([{ ...item, queue: 'additional' }], [clip])).toBe(0)
})
test('technical failures and Needs work block even optional clips', () => {
  expect(pendingListeningItems([{ ...item, queue: 'additional', technical: null }], [clip])).toBe(1)
  expect(pendingListeningItems([{ ...item, queue: 'additional', verdict: 'needs_work' }], [clip])).toBe(1)
})
test('advisories require a reason and technical advisories require Good', () => {
  const flagged = { ...clip, findings: [{ pass: false }] }
  const good = { ...item, verdict: 'good' }
  expect(pendingListeningItems([good], [flagged])).toBe(1)
  expect(pendingListeningItems([{ ...good, advisoryReason: '   ' }], [flagged])).toBe(1)
  expect(pendingListeningItems([{ ...good, advisoryReason: 'Reviewed' }], [flagged])).toBe(0)
  expect(pendingListeningItems([{ ...item, queue: 'additional', advisoryReason: 'Reviewed', technical: { ok: true, advisory: true } }], [clip])).toBe(1)
})
