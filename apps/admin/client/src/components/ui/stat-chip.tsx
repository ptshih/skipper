import type { ReactNode } from 'react'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { PulseDot } from '@/components/ui/pulse-dot'

// A count + label pill that doubles as a quick-filter. When `onClick` is given the pill ITSELF is the
// button (Badge asChild — per the Badge primitive's own guidance) rather than a button wrapping a
// Badge. A zero count drops to the neutral `secondary` variant so empty states read as muted.
export function StatChip({
  count,
  label,
  variant = 'secondary',
  onClick,
  pulse,
}: {
  count: number
  label: ReactNode
  variant?: BadgeProps['variant']
  onClick?: () => void
  pulse?: boolean
}) {
  const v = count ? variant : 'secondary'
  const body = (
    <>
      {pulse && count > 0 && <PulseDot />}
      {count} {label}
    </>
  )
  if (!onClick) return <Badge variant={v}>{body}</Badge>
  return (
    <Badge asChild variant={v} className="cursor-pointer">
      <button type="button" onClick={onClick}>
        {body}
      </button>
    </Badge>
  )
}

// The list header KPI strip: a flex-wrap row of StatChips on the left, with an optional control
// (e.g. <AutoRefreshControl>) floated to the right via `aside`.
export function StatChipRow({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {children}
      {aside && <div className="ml-auto flex items-center gap-2">{aside}</div>}
    </div>
  )
}
