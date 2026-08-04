// /drives — the rider-owned artifact, for DIAGNOSIS. A drive is minted by a rider at POST /drives
// against a credit they spent, and its selection is FROZEN at that moment, so this page authors
// nothing: it answers "what did the planner actually build for this rider, and does it still play?"
// The one write it offers is a hard delete, behind a typed confirmation (see DriveDetailSheet).
//
// ⚠ Content resolves LIVE by subject id — a regenerated telling silently changes what a saved drive
// says. That is deliberate (a drive auto-improves), and this is the surface where you can see it: open
// a drive and each frozen stop is resolved against the current corpus.
import { useMemo, useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Route as RouteIcon, Sparkles } from 'lucide-react'
import { api, type DriveRow } from '@/lib/api'
import { errMsg, fmtDate, fmtDuration, fmtMiles, timeAgo } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { useAdminList } from '@/lib/useAdminList'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Callout } from '@/components/ui/callout'
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchInput } from '@/components/ui/search-input'
import { DriveDetailSheet } from './drives/DriveDetailSheet'

const drivesRoute = getRouteApi('/drives')

/** The drive's endpoints as one line, or null when it stored neither. A there-and-back reads as a loop
 *  rather than "X → X", which looks like a bug and isn't — a round trip genuinely ends where it began. */
export function driveRoute(d: Pick<DriveRow, 'startName' | 'endName'>): string | null {
  const from = d.startName?.trim()
  const to = d.endName?.trim()
  if (from && to) return from === to ? `${from} loop` : `${from} → ${to}`
  return from || to || null
}

/** A drive's headline: the rider's own name for it when they gave one, else the route itself. Never
 *  "Untitled" unless the drive stored no endpoint names at all — a drive knows where it went. */
export function driveTitle(d: Pick<DriveRow, 'label' | 'startName' | 'endName'>): string {
  return d.label?.trim() || driveRoute(d) || 'Untitled drive'
}

/** The owner, as a human reads it. Falls back to a truncated id for an un-named account. */
export const ownerLabel = (o: DriveRow['owner']): string =>
  o ? o.email?.trim() || o.name?.trim() || `${o.id.slice(0, 8)}…` : 'account gone'

export function DrivesView() {
  const search = drivesRoute.useSearch()
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [showDeleted, setShowDeleted] = useState(false)
  // The open drive: the deep-link on first paint, then whatever the operator clicks.
  const [openId, setOpenId] = useState<string | null>(search.drive ?? null)

  const { data: drives, error: err, isPending } = useAdminList(qk.drives(), async () => (await api.drives()).drives)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return drives.filter((d) => {
      if (!showDeleted && d.deletedAt) return false
      if (!needle) return true
      return (
        driveTitle(d).toLowerCase().includes(needle) ||
        ownerLabel(d.owner).toLowerCase().includes(needle) ||
        d.regionNames.some((r) => r.toLowerCase().includes(needle)) ||
        d.id.toLowerCase().includes(needle)
      )
    })
  }, [drives, q, showDeleted])

  const deletedCount = drives.filter((d) => d.deletedAt).length

  const columns: Column<DriveRow>[] = [
    {
      header: 'Drive',
      cell: (d) => {
        // ⚠ Compared against the TITLE, not merely gated on `label` being set: riders (and the planner)
        // routinely name a drive with its own route string, so a "label exists" check printed the exact
        // same line twice. Show the route only when it says something the title doesn't.
        const route = driveRoute(d)
        return (
          <div className="flex items-center gap-2">
            <div className="min-w-0">
              <div className="truncate font-medium">{driveTitle(d)}</div>
              {route && route !== driveTitle(d) && (
                <div className="truncate text-xs text-muted-foreground">{route}</div>
              )}
            </div>
            {d.authored && (
              <Badge variant="outline" title="The endpoints were proposed by the planner (Create-a-Drive)">
                <Sparkles className="h-3 w-3" /> planned
              </Badge>
            )}
            {d.deletedAt && (
              <Badge variant="secondary" title={`Rider removed it from their list ${fmtDate(d.deletedAt)}`}>
                deleted
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      header: 'Owner',
      cell: (d) => (
        <div className="flex items-center gap-2">
          <span className="truncate text-sm">{ownerLabel(d.owner)}</span>
          {d.owner?.isAnonymous && <Badge variant="secondary">anon</Badge>}
          {/* No `user` row behind a live drive means the account was removed WITHOUT purgeUserData
              chasing its drives — the soft-ref orphan the schema warns about, not a display gap. */}
          {!d.owner && (
            <Badge variant="warning" title="No account row for this drive's user_id — the owner was deleted but the drive survived.">
              orphan
            </Badge>
          )}
        </div>
      ),
    },
    {
      header: <span title="Stops frozen into the drive at create — not how many still resolve to audio today">Stops</span>,
      headClassName: 'text-right',
      cellClassName: 'text-right font-mono text-sm tabular-nums',
      cell: (d) => d.stopCount.toLocaleString(),
    },
    {
      header: 'Distance',
      headClassName: 'text-right',
      cellClassName: 'text-right font-mono text-sm tabular-nums',
      cell: (d) => fmtMiles(d.distanceMeters),
    },
    {
      header: 'Duration',
      headClassName: 'text-right',
      cellClassName: 'text-right font-mono text-sm tabular-nums',
      cell: (d) => fmtDuration(d.durationSeconds),
    },
    {
      header: <span title="Every region whose bbox the route's rectangle overlaps — derived, never stored">Region</span>,
      cell: (d) =>
        d.regionNames.length ? (
          <div className="flex flex-wrap gap-1">
            {d.regionNames.map((n) => (
              <Badge key={n} variant="outline">
                {n}
              </Badge>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground" title="The route lies outside every configured region bbox.">
            none
          </span>
        ),
    },
    {
      header: 'Created',
      cellClassName: 'text-muted-foreground',
      cell: (d) => <span title={fmtDate(d.createdAt)}>{timeAgo(d.createdAt)}</span>,
    },
  ]

  const open = (id: string | null) => {
    setOpenId(id)
    // Consume the deep-link so a later close/reopen isn't re-triggered by a stale ?drive= in the URL.
    if (search.drive) navigate({ to: '/drives', search: (prev) => ({ ...prev, drive: undefined }), replace: true })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Drives"
        description="Every drive a rider has created — who owns it, where it goes, and how many stops were frozen into it. Open one to see its route and each stop resolved against the live corpus. The console never authors or edits a drive; a drive is the rider's."
      />

      {err && (
        <Callout variant="error">
          <span className="font-medium">Error loading drives:</span> {errMsg(err)}
        </Callout>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, route, owner, region, or id…"
          wrapperClassName="w-full max-w-sm"
        />
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={showDeleted} onCheckedChange={(v) => setShowDeleted(v === true)} />
          Show rider-deleted ({deletedCount})
        </label>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {rows.length} of {drives.length}
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(d) => d.id}
        loading={isPending}
        onRowClick={(d) => open(d.id)}
        // A rider-deleted drive stays legible but visibly receded — it is history, not live inventory.
        rowClassName={(d) => (d.deletedAt ? 'opacity-60' : undefined)}
        empty={!err ? <EmptyState icon={RouteIcon}>No drives yet.</EmptyState> : undefined}
        pageSize={25}
      />

      {openId && <DriveDetailSheet driveId={openId} open onOpenChange={(o) => !o && open(null)} />}
    </div>
  )
}
