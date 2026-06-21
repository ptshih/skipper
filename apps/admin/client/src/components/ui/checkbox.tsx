import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Minimal checkbox (no Radix dep — none is installed): a button with `aria-checked`, supporting an
 *  indeterminate ("mixed") state for a header select-all. Stops click propagation so checking a row
 *  never also fires the row's onClick (e.g. opening a detail sheet). */
export function Checkbox({
  checked,
  indeterminate = false,
  onCheckedChange,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  indeterminate?: boolean
  onCheckedChange: (next: boolean) => void
  className?: string
  'aria-label'?: string
}) {
  const active = checked || indeterminate
  return (
    <button
      type="button"
      role="checkbox"
      data-slot="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation()
        onCheckedChange(!checked)
      }}
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-[4px] border outline-none transition-colors',
        'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-input bg-background hover:border-primary/60',
        className,
      )}
    >
      {indeterminate ? (
        <Minus data-slot="checkbox-indicator" className="h-3 w-3" strokeWidth={3} />
      ) : checked ? (
        <Check data-slot="checkbox-indicator" className="h-3 w-3" strokeWidth={3} />
      ) : null}
    </button>
  )
}
