import type { BadgeProps } from '@/components/ui/badge'
import type { JobStatus } from '@/lib/api'

// Cloud Run job status → badge variant (Runs list + run drawer).
export const JOB_STATUS_VARIANT: Record<JobStatus, BadgeProps['variant']> = {
  succeeded: 'success',
  failed: 'destructive',
  running: 'info',
  queued: 'secondary',
  canceled: 'secondary',
}
