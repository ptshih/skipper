export type CorrectionSource = 'wikipedia' | 'wikidata'
export interface CorrectionIdentity { source: CorrectionSource; sourceId: string }

/** Resolve identities from the stored POI, never from a client-supplied QID. The primary
 * identity stays first so older clients that omit a source retain their existing behavior.
 */
export function correctionSourcesFor(poi: CorrectionIdentity & { qid?: string | null }): CorrectionIdentity[] {
  const sources: CorrectionIdentity[] = [{ source: poi.source, sourceId: poi.sourceId }]
  if (poi.source === 'wikipedia' && poi.qid) sources.push({ source: 'wikidata', sourceId: poi.qid })
  return sources
}
export function resolveCorrectionSource(poi: CorrectionIdentity & { qid?: string | null }, requested: unknown): CorrectionIdentity | null {
  const sources = correctionSourcesFor(poi)
  return requested === undefined ? sources[0]! : sources.find((s) => s.source === requested) ?? null
}
