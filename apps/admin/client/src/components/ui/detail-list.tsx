import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The labeled key/value band used in detail drawers: a 120px label column + value column on a
// hairline (gap-px on bg-border) grid. Replaces the per-view `Def` + `<dl>` copies that were
// duplicated verbatim across the Jobs and Evals drawers.
export function DetailList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[120px_1fr] gap-px overflow-hidden rounded-lg border bg-border', className)}>
      {children}
    </dl>
  )
}

export function DetailRow({
  label,
  children,
  mono,
  breakAll,
}: {
  label: ReactNode
  children: ReactNode
  mono?: boolean
  breakAll?: boolean
}) {
  return (
    <>
      <dt className="bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('bg-card px-3 py-2 text-xs', mono && 'font-mono', breakAll && 'break-all')}>{children}</dd>
    </>
  )
}
