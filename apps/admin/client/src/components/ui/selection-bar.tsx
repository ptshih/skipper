import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The shared bulk-select scope bar — the muted rounded container shown above a list table once ≥1 row is
// selected, holding a selection summary + its bulk-action buttons (RegionsView, the POI CorpusTab). This is
// just the chrome; each caller fills it with its own summary + actions. Render it behind a `selected > 0` gate.
export function SelectionBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm', className)}>
      {children}
    </div>
  )
}
