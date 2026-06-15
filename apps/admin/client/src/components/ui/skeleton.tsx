import * as React from 'react'
import { cn } from '@/lib/utils'
import { TableCell, TableRow } from '@/components/ui/table'

// Loading placeholder — a muted, pulsing block that stands in for content while a query is
// pending. Replaces the bare "Loading…" text (and the misleading "no rows" empty state the
// list tables flashed while their first fetch was still in flight).
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="skeleton" className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
  )
}

// Skeleton body rows for a shadcn <Table> while its data loads. The first column carries a
// two-line stack (the name + a mono sub-line most tables show there); the rest are single
// bars at deterministic widths so the grid doesn't read as uniform. `aria-hidden` keeps the
// placeholder out of the a11y tree — the surrounding region is what announces "loading".
const CELL_WIDTHS = ['w-16', 'w-24', 'w-12', 'w-20', 'w-14', 'w-16'] as const

function TableSkeletonRows({ rows = 6, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <TableRow key={r} className="hover:bg-transparent" aria-hidden>
          {Array.from({ length: cols }).map((_, c) => (
            <TableCell key={c}>
              {c === 0 ? (
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ) : (
                <Skeleton className={cn('h-4', CELL_WIDTHS[c % CELL_WIDTHS.length])} />
              )}
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  )
}

export { Skeleton, TableSkeletonRows }
