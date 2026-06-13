import type { BadgeProps } from '@/components/ui/badge'
import type { JobStatus } from '@/lib/api'

// Tour lifecycle status → badge variant (shared by the Tours list + Tour detail header).
export const TOUR_STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  ready: 'success',
  draft: 'secondary',
  generating: 'info',
  failed: 'destructive',
}

// Cloud Run job status → badge variant (Runs list + run drawer).
export const JOB_STATUS_VARIANT: Record<JobStatus, BadgeProps['variant']> = {
  succeeded: 'success',
  failed: 'destructive',
  running: 'info',
  queued: 'secondary',
  canceled: 'secondary',
}
