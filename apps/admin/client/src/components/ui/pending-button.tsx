import { type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

// A Button whose label swaps to a pending variant AND that disables itself while a mutation is in flight,
// so the "disable on submit" double-submit guard can't be forgotten at a call site. The leading icon is
// passed pre-sized (sizes vary across the app: h-3 / h-4 / size={14}) and stays through the pending state;
// `idleLabel` may be a node (e.g. a create-vs-edit ternary). Any extra `disabled` is OR'd with `pending`.
export function PendingButton({
  pending,
  idleLabel,
  pendingLabel,
  icon,
  disabled,
  ...props
}: {
  pending: boolean
  idleLabel: ReactNode
  pendingLabel: ReactNode
  icon?: ReactNode
} & Omit<ComponentProps<typeof Button>, 'children'>) {
  return (
    <Button disabled={pending || disabled} {...props}>
      {icon != null && <>{icon} </>}
      {pending ? pendingLabel : idleLabel}
    </Button>
  )
}
