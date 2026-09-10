import { pendingListeningItems } from './listening-readiness'
export type ReviewFilter = 'review' | 'needs_work' | 'all'
type QueueItem = { id: string; narrationId: string; verdict: string; queue: string; advisoryReason: string; technical: { ok: boolean; advisory?: boolean } | null }
type Clip = { narration: { id: string }; findings: { pass: boolean }[] }
export function listeningQueue<T extends QueueItem>(items: T[], clips: Clip[], filter: ReviewFilter): T[] {
  return items.filter(i => filter === 'all' || (filter === 'needs_work' ? i.verdict === 'needs_work'
    : i.verdict !== 'needs_work' && pendingListeningItems([i], clips) > 0))
    .sort((a, b) => a.narrationId.localeCompare(b.narrationId))
}
/** Capture before saving; accepted/flagged items can disappear when the refreshed queue arrives. */
export function nextListeningItem(items: { id: string }[], id: string): string {
  const index = items.findIndex(i => i.id === id)
  return items[index + 1]?.id ?? items.find(i => i.id !== id)?.id ?? ''
}
export const DEFAULT_ACCEPTANCE_REASON = 'I accept the displayed editorial and advisory findings for this clip.'

/** A failed save must leave the current decision on screen, never silently skip it. */
export async function saveListeningDecision(items: { id: string }[], id: string, persist: () => Promise<unknown>): Promise<string> {
  const next = nextListeningItem(items, id)
  await persist()
  return next
}
