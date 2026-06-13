import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type CalloutVariant = 'error' | 'warning' | 'info'

const VARIANT: Record<CalloutVariant, string> = {
  error: 'border-destructive/40 bg-destructive/10 text-destructive',
  warning: 'border-warning/40 bg-warning/10 text-warning',
  info: 'border-border bg-muted/30 text-muted-foreground',
}

// The standard bordered banner used across views (load errors, integrity warnings, info notes).
// `className` wins via tailwind-merge, so callers can soften/restyle (e.g. integrity bands).
export function Callout({
  variant = 'info',
  className,
  children,
}: {
  variant?: CalloutVariant
  className?: string
  children: ReactNode
}) {
  return <div className={cn('rounded-xl border px-4 py-3 text-sm', VARIANT[variant], className)}>{children}</div>
}
