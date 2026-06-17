import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface ConfirmOptions {
  /** The headline — phrase it as the question, e.g. "Delete POI?". */
  title: string
  /** Optional supporting line: the consequence + cost. Plain text or rich nodes. */
  body?: ReactNode
  /** Primary button label. Default "Confirm". */
  confirmLabel?: string
  /** Secondary button label. Default "Cancel". */
  cancelLabel?: string
  /** `destructive` paints the confirm button red — for deletes / byte-destroying ops. */
  tone?: 'default' | 'destructive'
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

/** The standardized replacement for `window.confirm` across the admin. Renders ONE shadcn Dialog at
 *  the app root; `useConfirm()` returns an async predicate so call sites keep the terse
 *  `if (!(await confirm(...))) return` flow but get a styled, on-brand dialog (Esc / overlay / Cancel
 *  all resolve false). Mounted in main.tsx under the query provider. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  // Keep the last options mounted through the dismiss so text doesn't blank mid-close.
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const settle = useCallback((value: boolean) => {
    setOpen(false)
    resolver.current?.(value)
    resolver.current = null
  }, [])

  const confirm = useCallback<ConfirmFn>(
    (next) =>
      new Promise<boolean>((resolve) => {
        // A confirm fired while one is already open: resolve the previous as cancelled.
        resolver.current?.(false)
        resolver.current = resolve
        setOpts(next)
        setOpen(true)
      }),
    [],
  )

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={open} onOpenChange={(next) => { if (!next) settle(false) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{opts?.title}</DialogTitle>
            {opts?.body != null && <DialogDescription>{opts.body}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => settle(false)}>
              {opts?.cancelLabel ?? 'Cancel'}
            </Button>
            <Button
              variant={opts?.tone === 'destructive' ? 'destructive' : 'default'}
              onClick={() => settle(true)}
            >
              {opts?.confirmLabel ?? 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  )
}

/** Returns an async `confirm(opts) => Promise<boolean>`. Throws if used outside `<ConfirmProvider>`. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within <ConfirmProvider>')
  return ctx
}
