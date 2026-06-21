import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Mono preformatted payload block for logs / JSON / scripts inside drawers. Replaces the per-view
// `LogBlock` helper (byte-identical copies in the Jobs and Evals drawers).
export function CodeBlock({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'overflow-x-auto whitespace-pre-wrap break-words rounded-lg border bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed',
        className,
      )}
    >
      {children}
    </div>
  )
}
