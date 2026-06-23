import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TableSkeletonRows } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
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
//
// Pass `pageSize` to opt into client-side pagination: the caller still hands over the FULL (filtered)
// `rows` — selection/counts/quick-filters keep operating over the whole set — and the table just windows
// which rows it renders. The page resets to 1 whenever `rows` changes identity (a filter applied, data
// refetched), which also clamps an out-of-range page.
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  empty,
  onRowClick,
  rowClassName,
  skeletonRows = 6,
  pageSize,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  loading?: boolean
  empty?: ReactNode
  onRowClick?: (row: T) => void
  rowClassName?: (row: T) => string | undefined
  skeletonRows?: number
  pageSize?: number
}) {
  const [page, setPage] = useState(0)
  // `rows` is a fresh array on every filter change (the caller memoizes it on its filter deps), so a new
  // identity means "the result set changed" → jump back to the first page.
  useEffect(() => setPage(0), [rows])

  const paginated = pageSize != null && rows.length > pageSize
  const pageCount = paginated ? Math.ceil(rows.length / pageSize) : 1
  const safePage = Math.min(page, pageCount - 1)
  const start = paginated ? safePage * pageSize : 0
  const visibleRows = paginated ? rows.slice(start, start + pageSize!) : rows

  return (
    <div className="space-y-3">
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
              visibleRows.map((row) => (
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
      {paginated && !loading && (
        <div className="flex items-center justify-between px-1 text-sm text-muted-foreground">
          <span>
            {start + 1}–{Math.min(start + pageSize!, rows.length)} of {rows.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={safePage === 0}
              onClick={() => setPage(0)}
              aria-label="First page"
              title="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
              <ChevronLeft className="h-4 w-4" /> Prev
            </Button>
            <span className="tabular-nums">
              Page {safePage + 1} of {pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(pageCount - 1)}
              aria-label="Last page"
              title="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
