import type { BadgeProps } from '@/components/ui/badge'
import type { JobStatus, RunEvent } from '@/lib/api'

// All status/verdict → Badge-variant maps (and the predicates that compute them) live here, so a hue
// decision is made in one place rather than inlined per view.

// Cloud Run job status → badge variant (Jobs page + job drawer).
export const JOB_STATUS_VARIANT: Record<JobStatus, BadgeProps['variant']> = {
  succeeded: 'success',
  failed: 'destructive',
  running: 'info',
  queued: 'secondary',
  canceled: 'secondary',
}

// Eval verdict → badge variant (Evals page + drawer).
export const VERDICT_VARIANT: Record<'pass' | 'partial' | 'fail', BadgeProps['variant']> = {
  pass: 'success',
  partial: 'warning',
  fail: 'destructive',
}

// pass / partial / fail from a run's tallies — the single source of truth for both the row badge and
// the drawer header. An eval "passes" when nothing was withheld; a run that gated some clips but
// SHIPPED the rest is a PARTIAL success (amber); a TRUE fail shipped nothing at all (red).
export function verdictOf(t: { withheld: number | null; shipped: number | null }): 'pass' | 'partial' | 'fail' {
  if ((t.withheld ?? 0) === 0) return 'pass'
  return (t.shipped ?? 0) > 0 ? 'partial' : 'fail'
}

export const isPartial = (r: RunEvent) => r.pass === false && (r.shipped ?? 0) > 0
export const isTrueFail = (r: RunEvent) => r.pass === false && (r.shipped ?? 0) === 0 && (r.total ?? 0) > 0
