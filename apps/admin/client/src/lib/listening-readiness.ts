type ListeningItem = {
  narrationId: string; queue: string; verdict: string; advisoryReason: string
  technical: { ok: boolean; advisory?: boolean } | null
}
type ClipFindings = { narration: { id: string }; findings: { pass: boolean }[] }

/** Presentation only: the server's atomic approval query remains the authority.
 * Count clips needing attention, rather than making an enabled button invite a known rejection.
 */
export function pendingListeningItems(items: ListeningItem[], clips: ClipFindings[]): number {
  const flagged = new Set(clips.filter(c => c.findings.some(f => !f.pass)).map(c => c.narration.id))
  return items.filter(i => i.verdict === 'needs_work'
    || (i.queue !== 'additional' && i.verdict !== 'good')
    || !i.technical?.ok
    || (i.technical.advisory && i.verdict !== 'good')
    || ((i.technical.advisory || flagged.has(i.narrationId)) && !i.advisoryReason.trim())).length
}
