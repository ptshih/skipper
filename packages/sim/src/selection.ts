import { selectionSubject, type DriveSelection } from '@skipper/db/schema'
import { candidateTriggerRadiusM, type DriveStopRef } from '@skipper/engine'

export interface SimSubject {
  subjectId: string
  subjectKind: 'poi' | 'cluster'
  name: string
  form: string
  durationMs: number
  key: string
  lat: number
  lng: number
  kind?: string | null
  anchored: boolean
  triggerRadiusM?: number
}

/** Structure belongs to the saved drive; only content and the app's radius policy resolve live. */
export function resolveSelection(selection: DriveSelection, subjects: SimSubject[]) {
  const bySubject = new Map(subjects.map(s => [`${s.subjectKind}:${s.subjectId}`, s]))
  const stops: { anchored: boolean; ref: DriveStopRef }[] = []
  const missing: { seq: number; subject: string; reason: string }[] = []
  for (const item of [...selection].sort((a, b) => a.seq - b.seq)) {
    const subject = selectionSubject(item)
    const key = subject ? `${subject.kind}:${subject.id}` : 'unknown'
    const n = bySubject.get(key)
    if (!n || !n.key || !Number.isFinite(n.durationMs) || n.durationMs <= 0) {
      missing.push({ seq: item.seq, subject: key, reason: 'Missing playable narration' })
      continue
    }
    // Legacy selections predate frozen coordinates; retain their current-coordinate fallback.
    const lat = item.triggerLat ?? n.lat
    const lng = item.triggerLng ?? n.lng
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      missing.push({ seq: item.seq, subject: key, reason: 'Invalid trigger coordinates' })
      continue
    }
    stops.push({ anchored: n.anchored, ref: {
      seq: item.seq, lat, lng, name: n.name, stopType: n.form,
      durationMs: n.durationMs, triggerRadiusM: candidateTriggerRadiusM(n),
    } })
  }
  return { stops, missing }
}

export function assertReleaseAudit(result: ReturnType<typeof resolveSelection>) {
  if (result.missing.length) throw new Error(`Release audit has unresolved subjects: ${JSON.stringify(result.missing)}`)
  if (!result.stops.length) throw new Error('Release audit has no playable clips')
}
