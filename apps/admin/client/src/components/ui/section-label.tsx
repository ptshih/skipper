import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Small uppercase section heading used inside cards, drawers, and the create flow.
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('text-xs font-semibold uppercase tracking-wide text-muted-foreground', className)}>
      {children}
    </div>
  )
}
