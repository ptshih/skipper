import type { ElementType, ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The centered "nothing here" placeholder — used inside table cells and bordered boxes.
export function EmptyState({
  icon: Icon,
  iconClassName,
  children,
  className,
}: {
  icon?: ElementType
  iconClassName?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground', className)}>
      {Icon && <Icon className={cn('h-6 w-6', iconClassName)} />}
      <div>{children}</div>
    </div>
  )
}
