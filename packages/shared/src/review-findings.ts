export interface ReviewFinding {
  pass: boolean
  withheld: boolean
  dimension: string
  findings: string[]
  detail?: unknown
}

/** Studio records post-synthesis advisories in the same TTS row as the script-safety gate.
 * Only recognize its known, measured advisory shapes. Unknown failures stay non-waivable;
 * a friendly-looking prefix alone must never turn an unsafe script into an advisory.
 */
export function isHardReviewFinding(finding: ReviewFinding): boolean {
  if (finding.withheld) return true
  if (finding.pass) return false
  if (finding.dimension === 'grounding') return true
  if (finding.dimension !== 'tts') return false
  if (!finding.findings.length || !finding.detail || typeof finding.detail !== 'object') return true
  const detail = finding.detail as Record<string, unknown>
  const loudness = detail.loudness as Record<string, unknown> | undefined
  const tail = detail.tailRetake as Record<string, unknown> | undefined
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  // Actual decoded clipping is a technical defect, even if another measurement was advisory.
  if (loudness && finite(loudness.truePeakDb) && loudness.truePeakDb > 0) return true
  return !finding.findings.every(message => {
    if (message.startsWith('tail-collapse:'))
      return tail?.retook === true && tail.shippedCollapsed === true && finite(tail.keptDropDb)
    if (message.startsWith('loudness:'))
      return loudness?.loudnessOk === false && finite(loudness.integratedLufs)
    if (message.startsWith('true-peak:'))
      return loudness?.truePeakOk === false && finite(loudness.truePeakDb) && loudness.truePeakDb <= 0
    return false
  })
}
