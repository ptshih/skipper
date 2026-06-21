// /places — curate the per-region set of real-world PLACES that feed the drive endpoint picker (and,
// later, break pitstops). The `places` table is role-tagged: an ENDPOINT hub (town/marina/lookout a
// rider starts or ends at) and/or a BREAK pitstop; FEATURED floats the popular subset to the top of the
// rider's picker. Coords are resolved + STORED at curation, so the runtime picker makes zero live
// Places calls. This page is the review/prune/promote + manual-add surface; the bulk seed is the
// `curate_places` studio job (the Curate button). See docs/specs/places-endpoints-spec.md.
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Plus, Search, Sparkles, Star, Trash2 } from 'lucide-react'
import { api, type PlaceRow, type ResolvedPlace } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { useAdminList } from '@/lib/useAdminList'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Callout } from '@/components/ui/callout'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { PlacesMap, PLACE_PIN_COLORS } from '@/components/ui/leaflet-map'
import { JobActionDialog } from '@/components/ui/job-action-dialog'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { FormDialog } from '@/components/ui/form-dialog'

/** Humanize a raw Google primaryType for display ('scenic_spot' → 'scenic spot'). */
const kindLabel = (t: string | null): string => (t ? t.replace(/_/g, ' ') : '—')

export function PlacesView() {
  // Shared ['regions'] cache — MUST store the unwrapped array (like RegionsView/PoisView), not the
  // `{ regions }` wrapper: a shape mismatch under the same key crashes whichever view reads it next.
  const { data: regions } = useAdminList(qk.regions(), async () => (await api.regions()).regions)
  const [region, setRegion] = useState<string | null>(null)
  // Default to the first region once they load (the Tahoe-launch case → auto-selected).
  useEffect(() => {
    if (!region && regions.length) setRegion(regions[0]!.slug)
  }, [region, regions])

  const [curating, setCurating] = useState(false)
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()

  const qc = useQueryClient()
  const queryKey = qk.places(region)
  const {
    data,
    error,
    isPending,
  } = useQuery({
    queryKey,
    queryFn: () => api.places(region!),
    enabled: !!region,
  })
  const places = data?.places ?? []
  const bbox = data?.bbox ?? null

  // Inline role/featured toggle — optimistic (the cache flips instantly; rolls back on error) so the
  // prune loop stays snappy over a short curated list.
  const toggleMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Pick<PlaceRow, 'endpointEligible' | 'breakEligible' | 'featured'>> }) =>
      api.patchPlace(id, patch),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey })
      const prev = qc.getQueryData<{ places: PlaceRow[]; bbox: string | null }>(queryKey)
      qc.setQueryData<{ places: PlaceRow[]; bbox: string | null }>(queryKey, (old) =>
        old ? { ...old, places: old.places.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : old,
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev)
    },
    onSettled: () => void qc.invalidateQueries({ queryKey }),
  })

  const confirm = useConfirm()
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deletePlace(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey }),
  })
  const onDelete = async (p: PlaceRow) => {
    if (!(await confirm({ title: `Remove ${p.name}?`, body: 'It will no longer be pickable as a drive endpoint or break.', confirmLabel: 'Remove', tone: 'destructive' }))) return
    deleteMut.mutate(p.id)
  }

  // Pin set for the map (endpoints + breaks; color-coded by role).
  const pins = useMemo(
    () => places.map((p) => ({ lat: p.lat, lng: p.lng, name: p.name, featured: p.featured, endpointEligible: p.endpointEligible })),
    [places],
  )
  const endpointCount = places.filter((p) => p.endpointEligible).length
  const breakCount = places.filter((p) => p.breakEligible).length

  const columns: Column<PlaceRow>[] = [
    {
      header: 'Place',
      cellClassName: 'font-medium',
      cell: (p) => (
        <>
          <div className="flex items-center gap-2">
            {p.featured && <Star className="h-3.5 w-3.5" style={{ color: PLACE_PIN_COLORS.featured, fill: PLACE_PIN_COLORS.featured }} />}
            {p.name}
          </div>
          <div className="text-xs text-muted-foreground">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</div>
        </>
      ),
    },
    { header: 'Kind', cellClassName: 'text-muted-foreground', cell: (p) => kindLabel(p.primaryType) },
    {
      header: 'Endpoint',
      headClassName: 'text-center',
      cellClassName: 'text-center',
      cell: (p) => (
        <Checkbox
          checked={p.endpointEligible}
          onCheckedChange={(v) => toggleMut.mutate({ id: p.id, patch: { endpointEligible: v === true } })}
          aria-label={`${p.name} endpoint-eligible`}
        />
      ),
    },
    {
      header: 'Break',
      headClassName: 'text-center',
      cellClassName: 'text-center',
      cell: (p) => (
        <Checkbox
          checked={p.breakEligible}
          onCheckedChange={(v) => toggleMut.mutate({ id: p.id, patch: { breakEligible: v === true } })}
          aria-label={`${p.name} break-eligible`}
        />
      ),
    },
    {
      header: 'Featured',
      headClassName: 'text-center',
      cellClassName: 'text-center',
      cell: (p) => (
        <Checkbox
          checked={p.featured}
          onCheckedChange={(v) => toggleMut.mutate({ id: p.id, patch: { featured: v === true } })}
          aria-label={`${p.name} featured`}
        />
      ),
    },
    {
      header: '',
      headClassName: 'w-10',
      cell: (p) => (
        <Button variant="ghost" size="icon" aria-label={`Remove ${p.name}`} onClick={() => void onDelete(p)}>
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Places"
        description="Curated start / end / midpoint hubs (and break pitstops) for the drive picker. Coords are stored at curation — the rider's picker makes zero live Places calls."
        actions={
          <>
            <Button variant="outline" disabled={!region} onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add a place
            </Button>
            <Button disabled={!region} onClick={() => setCurating(true)}>
              <Sparkles className="h-4 w-4" /> Curate
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={region ?? ''} onValueChange={setRegion}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Select a region" /></SelectTrigger>
          <SelectContent>
            {regions.map((r) => (
              <SelectItem key={r.slug} value={r.slug}>{r.displayName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {region && !isPending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary">{endpointCount} endpoint</Badge>
            <Badge variant="outline">{breakCount} break</Badge>
          </div>
        )}
      </div>

      {error && (
        <Callout variant="error" className="mb-4 rounded-lg px-3 py-2">{errMsg(error)}</Callout>
      )}

      {region && pins.length > 0 && (
        <div className="mb-5">
          <PlacesMap places={pins} bbox={bbox} className="h-72" />
          <p className="mt-1.5 text-xs text-muted-foreground">
            <span style={{ color: PLACE_PIN_COLORS.featured }}>●</span> featured ·{' '}
            <span style={{ color: PLACE_PIN_COLORS.endpoint }}>●</span> endpoint ·{' '}
            <span style={{ color: PLACE_PIN_COLORS.break }}>●</span> break
          </p>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={places}
        rowKey={(p) => p.id}
        loading={isPending && !!region}
        skeletonRows={5}
        empty={
          <EmptyState icon={MapPin}>
            <div className="font-medium text-foreground">No curated places yet</div>
            <div>Run Curate to draft this region’s hubs + pitstops, or add a place by name.</div>
          </EmptyState>
        }
      />

      {region && (
        <CurateDialog
          open={curating}
          onOpenChange={setCurating}
          region={region}
          onSubmitted={() => { setCurating(false); navigate({ to: '/jobs' }) }}
        />
      )}
      {region && (
        <AddPlaceDialog
          open={adding}
          onOpenChange={setAdding}
          region={region}
          onAdded={() => { setAdding(false); void qc.invalidateQueries({ queryKey }) }}
        />
      )}
    </div>
  )
}

/* ── CURATE (curate_places — the paid bulk draft → Places resolve → upsert) ── */

// LLM draft (Sonnet) + Google Places resolve, per region. Gated — JobActionDialog adds confirm:true on
// apply. Preview is free (the dry run makes no paid calls). The job runs as a studio Cloud Run job.
function CurateDialog({ open, onOpenChange, region, onSubmitted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  region: string
  onSubmitted: () => void
}) {
  return (
    <JobActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmitted={onSubmitted}
      icon={Sparkles}
      title="Curate places"
      description="Drafts this region's popular start/end hubs + break pitstops (LLM), resolves each against Google Places (bbox-bound), and upserts them role-tagged. Re-runnable — it OR-merges roles, so a re-curate never clears a role you kept. Then prune / promote here."
      buildBody={() => ({ kind: 'curate_places', region })}
      applyLabel="Curate"
      applyIcon={Sparkles}
      note={
        <>
          <span className="font-medium text-foreground">Preview</span> is free (no paid calls — explains the run);{' '}
          <span className="font-medium text-foreground">Curate</span> spends Anthropic + a few cents of Google Places.
        </>
      }
    />
  )
}

/* ── ADD A PLACE (manual single-add via live Google Places search) ── */

// The "I want THIS exact hub the draft missed" escape hatch: type a name → resolve it against live
// Google Places (bbox-bound to the region) → pick roles → insert (upsert by place_id).
function AddPlaceDialog({ open, onOpenChange, region, onAdded }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  region: string
  onAdded: () => void
}) {
  const [query, setQuery] = useState('')
  const [candidate, setCandidate] = useState<ResolvedPlace | null>(null)
  const [noMatch, setNoMatch] = useState(false)
  const [endpoint, setEndpoint] = useState(true)
  const [brk, setBrk] = useState(false)
  const [featured, setFeatured] = useState(false)

  // Reset the dialog each time it opens.
  useEffect(() => {
    if (open) {
      setQuery(''); setCandidate(null); setNoMatch(false); setEndpoint(true); setBrk(false); setFeatured(false)
    }
  }, [open])

  const resolveMut = useMutation({
    mutationFn: () => api.resolvePlace({ region, query: query.trim() }),
    onSuccess: (res) => { setCandidate(res.place); setNoMatch(!res.place) },
  })
  const addMut = useMutation({
    mutationFn: () =>
      api.addPlace({
        placeId: candidate!.placeId,
        name: candidate!.name,
        lat: candidate!.lat,
        lng: candidate!.lng,
        primaryType: candidate!.primaryType ?? null,
        endpointEligible: endpoint,
        breakEligible: brk,
        featured,
      }),
    onSuccess: onAdded,
  })

  const resolveError = resolveMut.error
  const addError = addMut.error
  const roleMissing = !endpoint && !brk

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      icon={Plus}
      title="Add a place"
      description="Search Google Places for a specific hub or pitstop in this region. The match is resolved + stored once — no live Places calls at drive time."
      onSubmit={() => addMut.mutate()}
      submitIcon={Plus}
      submitLabel="Add place"
      submitPendingLabel="Adding…"
      submitDisabled={!candidate || roleMissing}
      pending={addMut.isPending}
    >
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); if (query.trim()) resolveMut.mutate() }}
      >
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="place-query">Place name</Label>
          <Input
            id="place-query"
            autoFocus
            placeholder='e.g. "Tahoe City" or "Emerald Bay State Park"'
            value={query}
            onChange={(e) => { setQuery(e.target.value); setNoMatch(false) }}
          />
        </div>
        <Button type="submit" variant="outline" disabled={!query.trim() || resolveMut.isPending}>
          <Search className="h-4 w-4" /> {resolveMut.isPending ? 'Searching…' : 'Search'}
        </Button>
      </form>

      {noMatch && !resolveError && (
        <Callout variant="info" className="rounded-lg px-3 py-2 text-xs">No in-region match — try a more specific name (add the town/state).</Callout>
      )}
      {resolveError != null && (
        <Callout variant="error" className="rounded-lg px-3 py-2">{errMsg(resolveError)}</Callout>
      )}

      {candidate && (
        <div className="space-y-3 rounded-lg border p-3">
          <div>
            <div className="font-medium">{candidate.name}</div>
            <div className="text-xs text-muted-foreground">
              {kindLabel(candidate.primaryType ?? null)} · {candidate.lat.toFixed(4)}, {candidate.lng.toFixed(4)}
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={endpoint} onCheckedChange={(v) => setEndpoint(v === true)} aria-label="Endpoint-eligible" />
              <span>Endpoint (start / end / midpoint)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={brk} onCheckedChange={(v) => setBrk(v === true)} aria-label="Break-eligible" />
              <span>Break (pitstop)</span>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={featured} onCheckedChange={(v) => setFeatured(v === true)} aria-label="Featured" />
              <span>Featured</span>
            </label>
          </div>
          {roleMissing && <p className="text-xs text-muted-foreground">Pick at least one role.</p>}
        </div>
      )}

      {addError != null && (
        <Callout variant="error" className="rounded-lg px-3 py-2">{errMsg(addError)}</Callout>
      )}
    </FormDialog>
  )
}
