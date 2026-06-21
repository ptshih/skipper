import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// "auto-refresh · Ns" label + a manual refresh button (the icon spins while a fetch is in flight). The
// label is DERIVED from the same interval the query polls on, so the displayed cadence can't drift from
// the actual `refetchInterval` (they used to be a hardcoded string + a separate magic number).
export function AutoRefreshControl({
  intervalMs,
  isFetching,
  onRefresh,
}: {
  intervalMs: number
  isFetching: boolean
  onRefresh: () => void
}) {
  return (
    <>
      <span className="text-xs text-muted-foreground">auto-refresh · {Math.round(intervalMs / 1000)}s</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground"
        onClick={onRefresh}
        title="Refresh now"
        aria-label="Refresh"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
      </Button>
    </>
  )
}
