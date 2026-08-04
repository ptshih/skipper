// One drive, opened from the /drives table: its frozen route, every frozen stop resolved against the
// LIVE corpus, the provenance trail for how the route was chosen — and the console's only destructive
// action over rider-owned data, behind a typed confirmation.
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Sparkles, Trash2, X } from 'lucide-react'
import { api, type DriveStop } from '@/lib/api'
import { errMsg, fmtDate, fmtDuration, fmtMiles } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DataTable, type Column } from '@/components/ui/data-table'
import { DetailList, DetailRow } from '@/components/ui/detail-list'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { ErrorCallout } from '@/components/ui/error-callout'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionLabel } from '@/components/ui/section-label'
import { FormDialog } from '@/components/ui/form-dialog'
import { RouteMap } from '@/components/ui/google-map'
import { driveRoute, driveTitle, ownerLabel } from '../DrivesView'

/** How a frozen stop stands against the CURRENT corpus. Exactly one verdict per stop, worst-first —
 *  a stop that can't resolve at all is not also "staged". */
type StopState = 'unreadable' | 'silent' | 'staged' | 'replaced' | 'live'

/** ⚠ ONE expression, read by the badge, the map pin and the header count alike — the three used to be
 *  three separate conditions, which is exactly how a summary comes to disagree with the rows under it. */
function stopStateOf(s: DriveStop): StopState {
  if (!s.subjectId) return 'unreadable'
  if (!s.narration) return 'silent'
  if (!s.narration.releasedAt) return 'staged'
  if (s.frozenNarrationId && s.frozenNarrationId !== s.narration.id) return 'replaced'
  return 'live'
}

const STOP_STATE: Record<StopState, { label: string; variant: 'success' | 'secondary' | 'warning' | 'destructive' | 'info'; title: string }> = {
  live: { label: 'live', variant: 'success', title: 'Released, and still the same clip this drive froze.' },
  replaced: {
    label: 'replaced',
    variant: 'info',
    title:
      'The telling was regenerated since this drive was frozen. Not a defect — content resolves live by subject, by design — but this drive now says something different from what the rider bought.',
  },
  staged: {
    label: 'staged',
    variant: 'warning',
    title:
      'The clip exists but is not released. The owner still hears it: a saved drive replays its frozen selection without the release filter.',
  },
  silent: {
    label: 'silent',
    variant: 'destructive',
    title: 'Nothing resolves for this subject any more — the player DROPS this stop.',
  },
  unreadable: {
    label: 'unreadable',
    variant: 'destructive',
    title: 'The frozen item names no subject at all (a pre-fused-telling shape with no id). Unplayable.',
  },
}

export function DriveDetailSheet({
  driveId,
  open,
  onOpenChange,
}: {
  driveId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const { data, error: err } = useQuery({
    queryKey: qk.drive(driveId),
    queryFn: () => api.drive(driveId),
    enabled: open,
  })

  const drive = data?.drive
  const stops = data?.stops ?? []
  const states = stops.map(stopStateOf)
  const unplayable = states.filter((s) => s === 'silent' || s === 'unreadable').length

  const columns: Column<DriveStop>[] = [
    {
      header: '#',
      headClassName: 'w-10',
      cellClassName: 'font-mono text-xs text-muted-foreground tabular-nums',
      cell: (s) => s.seq + 1,
    },
    {
      header: 'Stop',
      cell: (s) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">
            {/* A null name means the place row is gone, not that it was nameless — say which. */}
            {s.name ?? <span className="text-muted-foreground">place deleted</span>}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {s.subjectKind === 'cluster' ? 'fused telling' : (s.detail ?? '—')}
            {s.narration && ` · ${s.narration.form}`}
          </div>
        </div>
      ),
    },
    {
      header: 'State',
      headClassName: 'w-28',
      cell: (s) => {
        const meta = STOP_STATE[stopStateOf(s)]
        return (
          <Badge variant={meta.variant} title={meta.title}>
            {meta.label}
          </Badge>
        )
      },
    },
    {
      header: <span title="How far along the route this stop triggers">At</span>,
      headClassName: 'w-16 text-right',
      cellClassName: 'text-right font-mono text-xs tabular-nums',
      cell: (s) => fmtDuration(s.alongSec),
    },
    {
      header: 'Length',
      headClassName: 'w-16 text-right',
      cellClassName: 'text-right font-mono text-xs tabular-nums',
      cell: (s) => (s.narration ? fmtDuration(s.narration.durationMs / 1000) : '—'),
    },
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[820px] max-w-full flex-col gap-0 p-0 sm:max-w-[820px]">
        <SheetHeader className="justify-between px-6 py-4">
          <SheetTitle className="leading-snug">{drive ? driveTitle(drive) : 'Drive'}</SheetTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="mt-0.5 shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </SheetHeader>

        {drive?.deletedAt && (
          <div className="border-y border-border bg-muted/50 px-6 py-2.5 text-xs">
            <span className="font-semibold">Removed by the rider</span>{' '}
            <span className="text-muted-foreground">
              {fmtDate(drive.deletedAt)} — it no longer appears in their list. The row and the credit
              they spent both stay; a delete never refunds.
            </span>
          </div>
        )}

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-4">
          {err && <ErrorCallout error={err} className="rounded-lg px-3 py-2" />}

          {!drive && !err && (
            <div className="space-y-4" aria-hidden>
              <Skeleton className="h-64 w-full rounded-lg" />
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          )}

          {drive && (
            <>
              <RouteMap
                className="h-64"
                polyline={drive.polyline}
                stops={stops.flatMap((s, i) =>
                  s.triggerLat != null && s.triggerLng != null
                    ? [{
                        lat: s.triggerLat,
                        lng: s.triggerLng,
                        label: s.name ?? 'stop',
                        // Same one expression the badge reads — a pin can't claim live while its row says silent.
                        live: states[i] === 'live' || states[i] === 'replaced',
                      }]
                    : [],
                )}
              />

              <DetailList>
                <DetailRow label="Owner">
                  <span className="flex items-center gap-1.5">
                    {ownerLabel(drive.owner)}
                    {drive.owner?.isAnonymous && <Badge variant="secondary">anon</Badge>}
                    {!drive.owner && <Badge variant="warning">orphan</Badge>}
                  </span>
                </DetailRow>
                <DetailRow label="Route">{driveRoute(drive) ?? '—'}</DetailRow>
                <DetailRow label="Region">
                  {drive.regionNames.length ? drive.regionNames.join(', ') : 'outside every region bbox'}
                </DetailRow>
                <DetailRow label="Distance" mono>
                  {fmtMiles(drive.distanceMeters)} · {fmtDuration(drive.durationSeconds)}
                </DetailRow>
                <DetailRow label="Created">{fmtDate(drive.createdAt)}</DetailRow>
                <DetailRow label="Drive id" mono breakAll>
                  {drive.id}
                </DetailRow>
                <DetailRow label="Route sig" mono breakAll>
                  {/* WRITE-ONLY today (the M4 dedup/cache key) — shown because it is the only handle on
                      "these two drives are the same shape", which is the question it exists to answer. */}
                  {drive.routeSig}
                </DetailRow>
              </DetailList>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <SectionLabel>
                    Stops ({stops.length})
                  </SectionLabel>
                  {unplayable > 0 && (
                    <span className="text-xs font-medium text-destructive">
                      {unplayable} won’t play
                    </span>
                  )}
                </div>
                {/* ⚠ A stop is resolved LIVE by subject id, so this table is the current truth, not the
                    frozen one: what the rider hears today is what these rows say. */}
                <DataTable columns={columns} rows={stops} rowKey={(s) => `${s.seq}-${s.subjectId ?? 'none'}`} />
              </div>

              {drive.routeProvenance && (
                <div className="space-y-2">
                  <SectionLabel>How this route was chosen</SectionLabel>
                  <DetailList>
                    <DetailRow label="Source" mono>
                      {drive.routeProvenance.source}
                    </DetailRow>
                    <DetailRow label="Waypoints">
                      {drive.routeProvenance.waypoints.map((w) => w.label).join(' → ') || '—'}
                    </DetailRow>
                    <DetailRow label="Frozen">{fmtDate(drive.routeProvenance.materializedAt)}</DetailRow>
                  </DetailList>

                  {drive.routeProvenance.authoring && (
                    <Callout variant="info" className="space-y-2 text-xs">
                      <div className="flex items-center gap-1.5 font-medium text-foreground">
                        <Sparkles className="h-3.5 w-3.5" /> Planned by {drive.routeProvenance.authoring.model}
                      </div>
                      <div className="text-muted-foreground">
                        “{drive.routeProvenance.authoring.prompt.roughStart}” →{' '}
                        “{drive.routeProvenance.authoring.prompt.roughEnd}” ·{' '}
                        {drive.routeProvenance.authoring.prompt.loopOrDirection}
                        {drive.routeProvenance.authoring.prompt.vibe && ` · ${drive.routeProvenance.authoring.prompt.vibe}`}
                      </div>
                      {/* The model's proposal BEFORE any edit — the approved set is `waypoints` above.
                          Worth showing side by side: a drive that went somewhere odd usually shows why here. */}
                      <ul className="space-y-1">
                        {drive.routeProvenance.authoring.proposed.map((p, i) => (
                          <li key={`${p.label}-${i}`}>
                            <span className="font-medium text-foreground">{p.label}</span>
                            {p.rationale && <span className="text-muted-foreground"> — {p.rationale}</span>}
                          </li>
                        ))}
                      </ul>
                    </Callout>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {drive && (
          <div className="border-t px-6 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="h-4 w-4" /> Delete drive
              </Button>
              <span className="text-xs text-muted-foreground">
                Permanent, and it is someone’s drive — you’ll be asked to type its id.
              </span>
            </div>
          </div>
        )}

        {confirming && drive && (
          <DeleteDriveDialog
            driveId={drive.id}
            title={driveTitle(drive)}
            owner={ownerLabel(drive.owner)}
            onClose={() => setConfirming(false)}
            onDeleted={() => {
              setConfirming(false)
              onOpenChange(false)
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

/* ── DELETE (typed confirmation) ── */

/** How much of the id the operator must type. Short enough to type from the dialog, long enough that
 *  it names THIS drive — the point of the gate is that muscle memory can't clear it. */
const CONFIRM_LEN = 8

// The console's only hard delete of rider-owned data, so it asks for more than a click: the operator
// types the drive's id prefix, and the request carries the full id back to the server, which refuses
// any DELETE whose body doesn't match its path. Two gates, one value — the id the dialog NAMES is the
// id that gets deleted.
//
// ⚠ What this does NOT do, stated in the dialog because an operator has to decide with it in view:
// it does not touch the shared audio (other drives play those tellings), and it does not refund the
// credit (the ledger is append-only — a make-good is a grant on the Users page, a separate visible act).
function DeleteDriveDialog({
  driveId,
  title,
  owner,
  onClose,
  onDeleted,
}: {
  driveId: string
  title: string
  owner: string
  onClose: () => void
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const [typed, setTyped] = useState('')
  const expected = driveId.slice(0, CONFIRM_LEN)
  const matches = typed.trim().toLowerCase() === expected.toLowerCase()

  const deleteMut = useMutation({
    mutationFn: () => api.deleteDrive(driveId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.drives() })
      qc.removeQueries({ queryKey: qk.drive(driveId) })
      onDeleted()
    },
  })

  return (
    <FormDialog
      open
      onOpenChange={(o) => { if (!o && !deleteMut.isPending) onClose() }}
      icon={Trash2}
      tone="destructive"
      title="Delete this drive?"
      description={
        <>
          Permanently deletes <span className="font-medium text-foreground">{title}</span>, owned by{' '}
          <span className="font-medium text-foreground">{owner}</span>. It disappears from their list and
          cannot be restored.
        </>
      }
      contentClassName="sm:max-w-md"
      onSubmit={() => deleteMut.mutate()}
      submitIcon={Trash2}
      submitLabel="Delete drive"
      submitPendingLabel="Deleting…"
      submitDisabled={!matches}
      pending={deleteMut.isPending}
    >
      <div className="space-y-4">
        <Callout variant="warning" className="space-y-1 rounded-lg px-3 py-2 text-xs">
          <div>
            <span className="font-medium text-foreground">Audio is untouched.</span> Narrations are shared
            corpus rows this drive only referenced.
          </div>
          <div>
            <span className="font-medium text-foreground">The credit is not refunded.</span> The ledger is
            append-only — grant credits on the Users page if you mean to make the rider whole.
          </div>
        </Callout>

        <div className="space-y-1.5">
          <Label htmlFor="delete-confirm">
            Type <span className="font-mono font-semibold text-foreground">{expected}</span> to confirm
          </Label>
          {/* The placeholder is deliberately NOT the expected value: a greyed hint identical to what you
              must type reads as a field that is already filled, which is the opposite of what a
              confirmation gate wants. The value to type is in the label above, where it's legible. */}
          <Input
            id="delete-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="type the id to confirm"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">
            The first {CONFIRM_LEN} characters of this drive’s id ({driveId}).
          </p>
        </div>
      </div>

      {deleteMut.error && (
        <Callout variant="error" className="rounded-lg px-3 py-2 text-xs">{errMsg(deleteMut.error)}</Callout>
      )}
    </FormDialog>
  )
}
