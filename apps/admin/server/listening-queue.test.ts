import { expect, test } from 'bun:test'
import { listeningQueue, nextListeningItem, saveListeningDecision } from '../client/src/lib/listening-queue'
const base = { queue: 'flagged', advisoryReason: '', technical: { ok: true } }
const items = ['unreviewed', 'needs_work', 'good'].map((verdict, i) => ({ ...base, id: String(i), narrationId: String(i), verdict }))
test('triage excludes deliberate flags and accepted clips; each remains browseable', () => {
  expect(listeningQueue(items, [], 'review').map(i => i.id)).toEqual(['0'])
  expect(listeningQueue(items, [], 'needs_work').map(i => i.id)).toEqual(['1'])
  expect(listeningQueue(items, [], 'all')).toHaveLength(3)
})
test('advance captures the next identity, wraps remaining decisions, and ends an exhausted queue', () => {
  expect(nextListeningItem(items, '0')).toBe('1')
  expect(nextListeningItem(items, '2')).toBe('0')
  expect(nextListeningItem([items[0]!], '0')).toBe('')
})
test('a cosmetic Good with missing technical checks still needs review', () => {
  expect(listeningQueue([{ ...items[2]!, technical: null }], [], 'review')).toHaveLength(1)
})

test('save failure cannot advance, and successful save keeps the captured successor', async () => {
  await expect(saveListeningDecision(items, '0', async () => { throw Error('conflict') })).rejects.toThrow('conflict')
  const queue = [...items]
  expect(await saveListeningDecision(queue, '0', async () => { queue.splice(0, 1) })).toBe('1')
})
