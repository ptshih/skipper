import { useState, type ComponentType, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/lib/api'
import { qk } from '@/lib/queryKeys'
import { errMsg } from '@/lib/format'

type IconType = ComponentType<{ className?: string }>

interface JobActionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after a job is queued (Preview OR apply) — usually navigate to /jobs. */
  onSubmitted: () => void
  icon: IconType
  title: string
  description: ReactNode
  /** Per-dialog scope/body content (a region Select, a selection summary, …), above the footer. */
  children?: ReactNode
  /** The muted "Preview vs apply" explainer box; omit for none. */
  note?: ReactNode
  /** Build the `createJob` body (everything EXCEPT `apply`/`confirm`, which this adds). */
  buildBody: () => Record<string, unknown>
  /** Primary (apply) button label + icon, e.g. "Discover" / Compass. */
  applyLabel: string
  applyIcon?: IconType
}

/** The shared shell for the corpus/run Preview+apply dialogs (Enrich, Generate narration, Re-score corpus): a
 *  shadcn Dialog with an icon header, a per-dialog body, a muted note, a standardized error Callout,
 *  and a Cancel / Preview / apply footer wired to ONE `createJob` mutation (dry-run on Preview, apply
 *  + confirm on the primary). Each call site stays a thin wrapper that owns its local state + builds
 *  the job body — the boilerplate (shell, footer, mutation, runs-invalidation) lives here once. */
export function JobActionDialog({
  open,
  onOpenChange,
  onSubmitted,
  icon: Icon,
  title,
  description,
  children,
  note,
  buildBody,
  applyLabel,
  applyIcon: ApplyIcon,
}: JobActionDialogProps) {
  const qc = useQueryClient()
  // Hard spend ceiling for paid runs (forwarded as --max-cost): the run aborts before billing
  // if the estimate exceeds it and stops mid-fan-out once actual spend crosses it. Blank = no cap.
  const [costCap, setCostCap] = useState('')
  const cap = Number(costCap)
  const capBody = costCap.trim() && Number.isFinite(cap) && cap > 0 ? { maxCostUsd: cap } : {}
  const submitMut = useMutation({
    // Every apply here is a paid/destructive run → always sends confirm:true (the server-side gate).
    mutationFn: (apply: boolean) =>
      api.createJob({ ...buildBody(), ...capBody, apply, ...(apply ? { confirm: true } : {}) }),
    // Refresh the runs cache so the just-created job shows on the Jobs page (not after the 15s poll).
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.runs() }); onSubmitted() },
  })
  const busy = submitMut.isPending
  const shownError = submitMut.error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4" /> {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {children}

        <div className="space-y-1.5">
          <Label htmlFor="job-cost-cap">Spend cap (USD) — optional</Label>
          <Input
            id="job-cost-cap"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.5"
            placeholder="e.g. 10"
            value={costCap}
            onChange={(e) => setCostCap(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Hard ceiling — the run aborts before billing if the estimate exceeds this, and stops
            mid-run once actual spend crosses it. Blank = no cap.
          </p>
        </div>

        {note && (
          <Callout variant="info" className="rounded-lg px-3 py-2 text-xs">
            {note}
          </Callout>
        )}

        {shownError != null && (
          <Callout variant="error" className="rounded-lg px-3 py-2">
            {errMsg(shownError)}
          </Callout>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => submitMut.mutate(false)}>
            {busy ? 'Triggering…' : 'Preview'}
          </Button>
          <Button disabled={busy} onClick={() => submitMut.mutate(true)}>
            {ApplyIcon && <ApplyIcon className="h-4 w-4" />} {busy ? 'Triggering…' : applyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
