import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  count?: number
  alert?: boolean
}

// The pill-style segmented control used for page tabs and list filters.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={cn('inline-flex h-9 items-center gap-1 rounded-lg border bg-muted/30 p-1', className)}>
      {options.map((o) => {
        const on = value === o.value
        return (
          <Button
            key={o.value}
            variant={on ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onChange(o.value)}
            className={cn('h-7 gap-1.5', on && 'shadow-sm')}
          >
            {o.label}
            {o.count != null && (
              <span
                className={cn(
                  'rounded px-1.5 text-xs',
                  o.alert ? 'bg-destructive/15 text-destructive' : 'bg-muted text-muted-foreground',
                )}
              >
                {o.count}
              </span>
            )}
          </Button>
        )
      })}
    </div>
  )
}
