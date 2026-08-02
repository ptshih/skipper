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
  /** Set for a kind whose PREVIEW also spends (today only `generate_cluster_narrations`, which
   *  narrates + scores before deciding what to keep). buildJobArgs returns `spends: true` for it
   *  unconditionally and the server 412s any spending run without `confirm:true` — so without this
   *  the Preview button is structurally unreachable and 412s for every input. The explicit click is
   *  the gate either way; what the operator must not get is a rung that silently does not exist. */
  confirmOnPreview?: boolean
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
  confirmOnPreview = false,
}: JobActionDialogProps) {
  const qc = useQueryClient()
  // Hard spend ceiling for paid runs (forwarded as --max-cost): the run aborts before billing
  // if the estimate exceeds it and stops mid-fan-out once actual spend crosses it. Blank = no cap.
  const [costCap, setCostCap] = useState('')
  const cap = Number(costCap)
  // ⚠ "typed something unparseable" and "deliberately no cap" produced BYTE-IDENTICAL requests: an
  // omitted --max-cost resolves to Infinity in the CLI (maxCostFlag), so a fat-fingered "1O" silently
  // dispatched an UNCAPPED paid run with no message anywhere. They are now distinguishable, and the
  // ambiguous one is refused rather than guessed at.
  const capInvalid = costCap.trim() !== '' && !(Number.isFinite(cap) && cap > 0)
  const capBody = costCap.trim() && Number.isFinite(cap) && cap > 0 ? { maxCostUsd: cap } : {}
  const submitMut = useMutation({
    // Every apply here is a paid/destructive run → always sends confirm:true (the server-side gate).
    // `confirmOnPreview` extends that to the preview branch for kinds that spend on a dry run too.
    mutationFn: (apply: boolean) =>
      api.createJob({
        ...buildBody(),
        ...capBody,
        apply,
        ...(apply || confirmOnPreview ? { confirm: true } : {}),
      }),
    // Refresh the runs cache so the just-created job shows on the Jobs page (not after the 15s poll).
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.runs() }); onSubmitted() },
  })
  const busy = submitMut.isPending
  const shownError = submitMut.error

  return (
    // ⚠ Guard the dismiss while a dispatch is in flight. The Cancel BUTTON is disabled on `busy`,
    // but Radix's Esc, overlay click and the built-in X all call onOpenChange unconditionally — and
    // closing unmounts the only place submitMut.error renders. There is no toast layer, so a 409
    // ("a run for this target is already in progress") or a 502 trigger_failed after dismissal was
    // completely invisible: the operator believes a PAID run started and walks away. DiscoverPoisDialog
    // already guards exactly this; this shell, which every paid dispatch goes through, did not.
    <Dialog open={open} onOpenChange={(o) => { if (!submitMut.isPending) onOpenChange(o) }}>
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
          {capInvalid ? (
            <p className="text-xs font-medium text-destructive">
              “{costCap.trim()}” isn’t a positive number. Clear it to run with NO cap, or enter an amount —
              an unreadable value would otherwise mean no cap.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Hard ceiling — the run aborts before billing if the estimate exceeds this, and stops
              mid-run once actual spend crosses it.{' '}
              {capBody.maxCostUsd != null ? (
                <>Resolved: aborts above <span className="font-medium text-foreground">${capBody.maxCostUsd.toFixed(2)}</span>.</>
              ) : (
                <span className="font-medium text-foreground">Blank = NO cap.</span>
              )}
            </p>
          )}
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
          <Button variant="outline" disabled={busy || capInvalid} onClick={() => submitMut.mutate(false)}>
            {busy ? 'Triggering…' : 'Preview'}
          </Button>
          <Button disabled={busy || capInvalid} onClick={() => submitMut.mutate(true)}>
            {ApplyIcon && <ApplyIcon className="h-4 w-4" />} {busy ? 'Triggering…' : applyLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
