import { type ComponentType, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type IconType = ComponentType<{ className?: string }>

/** The shared shell for the admin's NON-paid FORM dialogs (Add place, Grant credits): a shadcn Dialog with
 *  an icon header, a caller-owned body, and a standardized Cancel / pending-guarded-primary footer. The
 *  paid Preview+apply jobs use {@link JobActionDialog} instead, and the Sheet-based RegionDialog (a wide
 *  drawer with a map) keeps its own shell. Error Callouts stay in `children` because each dialog interleaves
 *  them differently (Add place surfaces a resolve error mid-body, before the result card). */
export function FormDialog({
  open,
  onOpenChange,
  icon: Icon,
  title,
  description,
  children,
  contentClassName,
  onSubmit,
  submitLabel,
  submitPendingLabel,
  submitIcon: SubmitIcon,
  submitDisabled = false,
  pending = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  icon?: IconType
  title: ReactNode
  description: ReactNode
  /** The form body — fields and the dialog's own error/info Callouts, whose placement varies per dialog. */
  children?: ReactNode
  /** Extra DialogContent classes (e.g. `sm:max-w-md` for a narrower modal). */
  contentClassName?: string
  onSubmit: () => void
  submitLabel: ReactNode
  /** Shown on the primary button while `pending` (e.g. "Adding…"). */
  submitPendingLabel: ReactNode
  submitIcon?: IconType
  /** Disable the primary action (e.g. an invalid form). `pending` disables it too. */
  submitDisabled?: boolean
  /** The submit mutation is in flight — disables Cancel + the primary and swaps the primary label. */
  pending?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={contentClassName}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4" />} {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {children}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={submitDisabled || pending}>
            {SubmitIcon && <SubmitIcon className="h-4 w-4" />} {pending ? submitPendingLabel : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
