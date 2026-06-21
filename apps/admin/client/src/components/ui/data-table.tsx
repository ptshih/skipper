import type { ReactNode } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TableSkeletonRows } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

export type Column<T> = {
  header: ReactNode
  cell: (row: T) => ReactNode
  headClassName?: string
  cellClassName?: string
  /** Stop this cell's clicks from bubbling to `onRowClick` — for an interactive cell (a checkbox, a
   *  button) inside a row that is itself clickable, so toggling the control never also triggers the row. */
  cellStopPropagation?: boolean
}

// A column-config list table that owns the whole scaffold + lifecycle: the bordered wrapper, the header
// row, the loading skeleton, the empty state, and the row map. `colSpan` (empty state) and `cols`
// (skeleton) are DERIVED from columns.length — so they can't drift from the header column count, the
// hand-synced-number bug class every list view used to carry (one already had colSpan 9 vs 8 columns).
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  rowClassName,
  skeletonRows = 6,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  empty?: ReactNode
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
  skeletonRows?: number
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c, i) => (
              <TableHead key={i} className={c.headClassName}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading && <TableSkeletonRows rows={skeletonRows} cols={columns.length} />}
          {!loading &&
            rows.map((row) => (
              <TableRow
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(onRowClick && 'cursor-pointer', rowClassName?.(row))}
              >
                {columns.map((c, i) => (
                  <TableCell
                    key={i}
                    className={c.cellClassName}
                    onClick={c.cellStopPropagation ? (e) => e.stopPropagation() : undefined}
                  >
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          {!loading && rows.length === 0 && empty != null && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length}>{empty}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
