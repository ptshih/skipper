// /places — curate the per-region set of real-world PLACES that feed the drive endpoint picker (and,
// later, break pitstops). The `places` table is role-tagged: an ENDPOINT hub (town/marina/lookout a
// rider starts or ends at) and/or a BREAK pitstop; FEATURED floats the popular subset to the top of the
// rider's picker. Coords are resolved + STORED at curation, so the runtime picker makes zero live
// Places calls. This page is the review/prune/promote + manual-add surface; the bulk seed is the
// interactive Curate button (Opus draft → prune → Places resolve). See docs/designs/places-endpoints-spec.md.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, MapPin, Navigation, Plus, Search, Sparkles, Star, Trash2 } from 'lucide-react'
import { api, type CurateResult, type PlaceDraft, type PlaceRow, type ResolvedPlace } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { useAdminList } from '@/lib/useAdminList'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PendingButton } from '@/components/ui/pending-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Callout } from '@/components/ui/callout'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionLabel } from '@/components/ui/section-label'
import { PlacesMap, PLACE_PIN_COLORS } from '@/components/ui/google-map'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { FormDialog } from '@/components/ui/form-dialog'

/** Humanize a raw Google primaryType for display ('scenic_spot' → 'scenic spot'). */
const kindLabel = (t: string | null): string => (t ? t.replace(/_/g, ' ') : '—')

/** The rank band the map and the counts treat as "the ones anyone would name" — the same band
 *  `EXAMPLE_ANCHOR_MAX_RANK` gates the cold open on (apps/api/src/example-anchors.ts). ⚠ Two copies of
 *  one number, deliberately: the console cannot import from apps/api. Keep them equal. */
const TOP_RANK = 3

/** How many of this region's places the PLANNER actually sees — `MAX_PLAN_ANCHORS` (apps/api/src/limits.ts).
 *  ⚠ A third hand-copied number, for the same reason as TOP_RANK: the console cannot import from apps/api.
 *  Keep them equal. It is surfaced here because curation now deliberately stores MORE rows than the
 *  planner is served ("store deep, serve shallow"), so a region sitting over this is EXPECTED — but that
 *  only stays honest if an operator can see where the line falls. Without this badge the tail is an
 *  unverifiable claim: rows exist in the table that no rider can reach, and nothing on the page says so. */
const PLANNER_ROSTER_CAP = 200

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
  //
  // ⚠⚠ THE KEY TRAVELS IN THE VARIABLES, NOT THE CLOSURE, AND THAT IS LOAD-BEARING. These callbacks
  // used to close over the render-scoped `queryKey`, and React Query hands a PENDING mutation the
  // newest render's options — verified in the installed source:
  //     mutationObserver.js:34  else if (this.#currentMutation?.state.status === 'pending')
  //                             { this.#currentMutation.setOptions(this.options) }
  //     mutation.js:159         await this.options.onError?.(...)
  // So switching region while a PATCH was in flight made the rollback write the OLD region's
  // {places,bbox} under the NEW region's key. With staleTime 30s suppressing a corrective refetch, the
  // operator then saw Tahoe's curated places, Tahoe's bbox and Tahoe's counts while the page said
  // Yosemite — and Remove would delete a Tahoe row under a Yosemite label. The curated `places` set IS
  // the planner's endpoint allowlist (INV-2), so that is a rider-facing deletion of the wrong place.
  const rankMut = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { rank: number | null }; key: readonly unknown[] }) =>
      api.patchPlace(id, patch),
    onMutate: async ({ id, patch, key }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<{ places: PlaceRow[]; bbox: string | null }>(key)
      qc.setQueryData<{ places: PlaceRow[]; bbox: string | null }>(key, (old) =>
        old ? { ...old, places: old.places.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : old,
      )
      return { prev, key }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev)
    },
    onSettled: (_d, _e, vars) => void qc.invalidateQueries({ queryKey: vars.key }),
  })

  /** The place whose access point is being edited, or null. */
  const [accessFor, setAccessFor] = useState<PlaceRow | null>(null)

  // ── Row ⇄ pin focus ────────────────────────────────────────────────────────
  // A row carries every field a place HAS (the table is the detail view), so a row click has nothing to
  // open. What it can answer is the one question the table can't: WHERE is this. Clicking a row centers
  // the map on that pin and opens its name bubble; clicking a pin lights up its row.
  //
  // ⚠ The NONCE is what makes clicking the same row twice work — see FocusPin in google-map.tsx. Only a
  // ROW click bumps it, so clicking a pin never moves the camera under the operator's own cursor.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusNonce, setFocusNonce] = useState(0)
  const mapRef = useRef<HTMLDivElement>(null)
  const focusPlace = (id: string) => {
    setSelectedId(id)
    setFocusNonce((n) => n + 1)
    // Panning a map that has scrolled off the top of a 100-row table is an invisible no-op. `nearest`
    // scrolls the minimum needed and does nothing at all when the map is already fully on screen.
    // ⚠ NO `behavior: 'smooth'`. Written that way first, it silently did NOTHING — measured in the
    // browser, the smooth call settled back at the scroll position it started from while the default
    // landed the map on screen every time, with reduced-motion off and `scroll-behavior` already
    // `auto`, so there was no setting to blame. The row highlighted and the map never came back. The
    // instant jump isn't the compromise here, it's the only version that runs.
    mapRef.current?.scrollIntoView({ block: 'nearest' })
  }
  // A selection belongs to the region it was made in — carrying an id across a region switch would
  // highlight nothing and leave a stale pin id pointed at another region's list.
  useEffect(() => setSelectedId(null), [region])

  const confirm = useConfirm()
  const deleteMut = useMutation({
    // Same reasoning as above: invalidate the list this delete actually came from.
    mutationFn: ({ id }: { id: string; key: readonly unknown[] }) => api.deletePlace(id),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: vars.key }),
  })
  const onDelete = async (p: PlaceRow) => {
    if (!(await confirm({ title: `Remove ${p.name}?`, body: 'It will no longer be pickable as a drive endpoint or break.', confirmLabel: 'Remove', tone: 'destructive' }))) return
    deleteMut.mutate({ id: p.id, key: queryKey })
  }

  // Pin set for the map. ⚠ Roles are gone (2026-08-04): every row is a destination, so the only
  // distinction left is how asked-for it is — top-ranked pins read as `featured` did.
  const pins = useMemo(
    () =>
      places.map((p) => ({
        id: p.id,
        lat: p.lat,
        lng: p.lng,
        name: p.name,
        featured: p.rank != null && p.rank <= TOP_RANK,
        endpointEligible: true,
        breakEligible: false,
        kind: p.primaryType ? kindLabel(p.primaryType) : null,
        rank: p.rank,
      })),
    [places],
  )
  const topRankCount = places.filter((p) => p.rank != null && p.rank <= TOP_RANK).length

  const columns: Column<PlaceRow>[] = [
    {
      header: 'Place',
      cellClassName: 'font-medium',
      cell: (p) => (
        <>
          <div className="flex items-center gap-2">
            {p.rank != null && p.rank <= TOP_RANK && (
              <Star className="h-3.5 w-3.5" style={{ color: PLACE_PIN_COLORS.featured, fill: PLACE_PIN_COLORS.featured }} />
            )}
            {p.name}
          </div>
          <div className="text-xs text-muted-foreground">{p.lat.toFixed(4)}, {p.lng.toFixed(4)}</div>
          {/* The access point is shown UNDER the pin, never instead of it — the two are different
              facts and the whole design rests on not confusing them. Only rendered when set, which is
              almost never, so the table stays a list of places rather than a list of coordinates. */}
          {p.accessLat != null && p.accessLng != null && (
            <div className="text-xs" style={{ color: PLACE_PIN_COLORS.featured }}>
              ↳ car routed to {p.accessLat.toFixed(4)}, {p.accessLng.toFixed(4)}
            </div>
          )}
        </>
      ),
    },
    { header: 'Kind', cellClassName: 'text-muted-foreground', cell: (p) => kindLabel(p.primaryType) },
    {
      header: 'Rank',
      headClassName: 'text-center w-24',
      cellClassName: 'text-center',
      // The row itself focuses the map, so this cell keeps its clicks: focusing the field to retype a
      // rank must not also fling the camera somewhere.
      cellStopPropagation: true,
      // ⚠ 1 = most likely to be NAMED, not "best". A blank clears it, which sorts the place LAST rather
      // than first — the same rule the roster and the cold open apply (`NULLS LAST`).
      cell: (p) => (
        <Input
          type="number"
          min={1}
          className="h-8 w-16 text-center"
          defaultValue={p.rank ?? ''}
          aria-label={`${p.name} rank`}
          onBlur={(e) => {
            const raw = e.target.value.trim()
            const next = raw === '' ? null : Number(raw)
            if (next !== null && !Number.isFinite(next)) return
            if (next === (p.rank ?? null)) return
            rankMut.mutate({ id: p.id, patch: { rank: next }, key: queryKey })
          }}
        />
      ),
    },
    {
      header: '',
      headClassName: 'w-20',
      // Same reason as Rank — and it matters more here, where the neighbouring button DELETES a row
      // from the planner's endpoint allowlist.
      cellStopPropagation: true,
      cell: (p) => (
        <div className="flex items-center justify-end">
          <Button variant="ghost" size="icon" aria-label={`Access point for ${p.name}`} onClick={() => setAccessFor(p)}>
            <Navigation
              className="h-4 w-4"
              style={{ color: p.accessLat != null ? PLACE_PIN_COLORS.featured : undefined }}
            />
          </Button>
          <Button variant="ghost" size="icon" aria-label={`Remove ${p.name}`} onClick={() => void onDelete(p)}>
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        </div>
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
            <Button variant="outline" disabled={!region || curating} onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" /> Add a place
            </Button>
            <Button disabled={!region || curating} onClick={() => setCurating(true)}>
              <Sparkles className="h-4 w-4" /> Curate
            </Button>
          </>
        }
      />

      {curating && region ? (
        <CuratePanel
          region={region}
          regionName={regions.find((r) => r.slug === region)?.displayName ?? region}
          onClose={() => setCurating(false)}
          onCurated={() => void qc.invalidateQueries({ queryKey })}
        />
      ) : (
        <>
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
                <Badge variant="secondary">{places.length} destinations</Badge>
                <Badge variant="outline">{topRankCount} top-ranked</Badge>
                {/* ⚠ Deliberately NOT styled as an error — being over the cap is the intended state, not
                    a fault to clear. It tells the operator where the planner stops reading so a place
                    that riders cannot reach is a VISIBLE consequence of its rank, not a silent one. */}
                {places.length > PLANNER_ROSTER_CAP && (
                  <Badge variant="outline" title={`The planner is handed the top ${PLANNER_ROSTER_CAP} by rank; the remaining ${places.length - PLANNER_ROSTER_CAP} are stored but never offered. Re-rank one to bring it in.`}>
                    planner sees top {PLANNER_ROSTER_CAP} · {places.length - PLANNER_ROSTER_CAP} below the line
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* ⚠ The LIST error is not the only one that matters. Until 2026-08-02 this was the page's
              only error surface, so a failed rank edit just snapped the field back with no
              message (reads as a mis-click) and a failed delete left the row sitting there — on the
              table that IS the planner's wire-level endpoint allowlist. Every other view in the
              console surfaces its mutation errors; this one didn't. */}
          {(error || rankMut.error || deleteMut.error) && (
            <Callout variant="error" className="mb-4 rounded-lg px-3 py-2">
              {errMsg(error ?? rankMut.error ?? deleteMut.error)}
            </Callout>
          )}

          {region && pins.length > 0 && (
            <div className="mb-5" ref={mapRef}>
              <PlacesMap
                places={pins}
                bbox={bbox}
                className="h-72"
                selectedId={selectedId}
                onSelect={setSelectedId}
                focusNonce={focusNonce}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                <span style={{ color: PLACE_PIN_COLORS.featured }}>●</span> rank 1–{TOP_RANK} ·{' '}
                <span style={{ color: PLACE_PIN_COLORS.endpoint }}>●</span> the rest · click a row to find
                it here
              </p>
            </div>
          )}

          <DataTable
            columns={columns}
            rows={places}
            rowKey={(p) => p.id}
            onRowClick={(p) => focusPlace(p.id)}
            rowClassName={(p) => (p.id === selectedId ? 'bg-muted hover:bg-muted' : undefined)}
            loading={isPending && !!region}
            skeletonRows={5}
            empty={
              <EmptyState icon={MapPin}>
                <div className="font-medium text-foreground">No curated places yet</div>
                <div>Run Curate to draft this region’s hubs + pitstops, or add a place by name.</div>
              </EmptyState>
            }
          />
        </>
      )}

      {region && (
        <AddPlaceDialog
          open={adding}
          onOpenChange={setAdding}
          region={region}
          onAdded={() => { setAdding(false); void qc.invalidateQueries({ queryKey }) }}
        />
      )}

      {accessFor && (
        <AccessPointDialog
          place={accessFor}
          onClose={() => setAccessFor(null)}
          onSaved={() => { setAccessFor(null); void qc.invalidateQueries({ queryKey }) }}
        />
      )}
    </div>
  )
}

/* ── ACCESS POINT (where a car is sent when the pin itself is not drivable) ── */

/**
 * Set or clear one place's access point.
 *
 * ⚠ THE COPY IS THE GUARD HERE. Nothing on screen can show an operator that the coordinate they typed
 * is on a public road — only Google knows that, and only when a drive is routed. What the dialog CAN
 * do is make it obvious that this moves the CAR and not the PLACE, because an operator who thinks they
 * are correcting a wrong pin will happily type the coordinates of a different town.
 *
 * The server bounds it near the place (`checkAccessPoint`, 422). This does not re-implement that bound
 * — one expression, at the write — it just surfaces the refusal.
 */
function AccessPointDialog({ place, onClose, onSaved }: {
  place: PlaceRow
  onClose: () => void
  onSaved: () => void
}) {
  const [lat, setLat] = useState(place.accessLat?.toString() ?? '')
  const [lng, setLng] = useState(place.accessLng?.toString() ?? '')

  const save = useMutation({
    mutationFn: (body: { accessLat: number | null; accessLng: number | null }) =>
      api.patchPlace(place.id, body),
    onSuccess: onSaved,
  })

  const parsed = { lat: Number(lat), lng: Number(lng) }
  const blank = lat.trim() === '' && lng.trim() === ''
  // ⚠ Both or neither, mirroring the server: half a coordinate is a point that was never anywhere.
  const valid = blank || (Number.isFinite(parsed.lat) && Number.isFinite(parsed.lng) && lat.trim() !== '' && lng.trim() !== '')

  return (
    <FormDialog
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      icon={Navigation}
      title={`Access point — ${place.name}`}
      description="Where a car is routed for this place. The pin, the map marker and the drive's title all keep the real location; only the Google Routes request uses this. Leave both blank to clear it."
      contentClassName="sm:max-w-md"
      onSubmit={() => save.mutate(blank ? { accessLat: null, accessLng: null } : { accessLat: parsed.lat, accessLng: parsed.lng })}
      submitLabel={blank ? 'Clear access point' : 'Save access point'}
      submitPendingLabel="Saving…"
      submitDisabled={!valid}
      pending={save.isPending}
    >
      <div className="text-xs text-muted-foreground">
        Pin: {place.lat.toFixed(5)}, {place.lng.toFixed(5)}
      </div>
      <div className="flex gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="access-lat">Access latitude</Label>
          <Input id="access-lat" autoFocus value={lat} onChange={(e) => setLat(e.target.value)} placeholder="39.10650" />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="access-lng">Access longitude</Label>
          <Input id="access-lng" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-119.91647" />
        </div>
      </div>
      <Callout variant="info">
        Use it when the place's own pin is somewhere a car cannot go — a lake's water, a beach, a
        building inside a park. `audit-endpoint-routability --snap` proposes the coordinate.
      </Callout>
      {save.error && <Callout variant="error">{errMsg(save.error)}</Callout>}
    </FormDialog>
  )
}

/* ── CURATE (interactive: Opus draft → operator prunes → Places resolve → upsert) ── */

// Two-step curate so the operator REVIEWS the LLM's picks before paying to resolve them:
//  1. Draft  — one Opus call names the region's hubs + pitstops (a few cents; writes nothing).
//  2. The operator unchecks anything they don't want.
//  3. Resolve & add — the keepers are resolved against Google Places (bbox-bound) + upserted role-tagged.
// Re-runnable (OR-merges roles). Both steps spend, so the founder-gate is the explicit button click
// (this whole console is behind IAP). Roles/featured can be fine-tuned in the table after they land.
//
// Rendered INLINE on the page (not a modal): the Draft step is a long synchronous Opus call (~30s), and a
// modal that dismisses on a stray overlay-click / Esc is a footgun there — it reads as frozen and one
// click throws the in-flight draft away. Inline, the wait is a normal section loading state and the only
// way out is the explicit, always-live Cancel.
function CuratePanel({ region, regionName, onClose, onCurated }: {
  region: string
  regionName: string
  onClose: () => void
  onCurated: () => void
}) {
  const [drafts, setDrafts] = useState<PlaceDraft[]>([])
  const [kept, setKept] = useState<Set<number>>(new Set())
  const [results, setResults] = useState<CurateResult[] | null>(null)
  const [added, setAdded] = useState<number | null>(null)
  // Held as a STRING so the field can be cleared/retyped without fighting a number cast mid-edit.
  // Never clamped here: the server owns the range (see the route's targetN) and falls back to 30 on
  // anything unparseable, so this input is an affordance and the clamp stays a single expression.
  const [target, setTarget] = useState('100')

  const draftMut = useMutation({
    mutationFn: () => api.draftPlaces({ region, target: Number(target) || undefined }),
    onSuccess: (res) => {
      setDrafts(res.drafts)
      setKept(new Set(res.drafts.map((_, i) => i))) // keep all by default; the operator prunes down
    },
  })
  const curateMut = useMutation({
    mutationFn: () => api.curatePlaces({ region, drafts: drafts.filter((_, i) => kept.has(i)) }),
    // Keep the server's `added` — it is the count of rows actually WRITTEN, after dedupe by canonical
    // place_id and after any per-row write failure. Deriving the headline from the resolved rows
    // instead over-counted: two drafts can pin the SAME Google place, and an upsert can fail on its own.
    onSuccess: (res) => { setResults(res.results); setAdded(res.added); onCurated() },
  })

  const toggleKeep = (i: number) =>
    setKept((s) => {
      const n = new Set(s)
      if (n.has(i)) n.delete(i)
      else n.add(i)
      return n
    })

  // Start a fresh draft WITHOUT leaving the panel (after a results summary, or to re-draft).
  const reset = () => {
    setDrafts([]); setKept(new Set()); setResults(null); setAdded(null)
    draftMut.reset(); curateMut.reset()
  }

  const hasDrafts = drafts.length > 0
  const keptCount = kept.size
  const drafting = draftMut.isPending
  const resolving = curateMut.isPending
  const resolved = results?.filter((r) => r.status === 'resolved').length ?? 0
  const dropped = results?.filter((r) => r.status === 'dropped').length ?? 0
  const errored = results?.filter((r) => r.status === 'error').length ?? 0

  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2 font-medium">
          <Sparkles className="h-4 w-4" /> Curate · {regionName}
        </div>
        {/* Always live — the point of going inline is to never trap the operator mid-draft. */}
        <Button variant="ghost" size="sm" onClick={onClose}>
          {results ? 'Done' : 'Cancel'}
        </Button>
      </div>

      <div className="space-y-3 p-4">
        {/* INITIAL — the explicit spend gate (a paid Opus call; writes nothing). */}
        {!hasDrafts && !drafting && !results && (
          <>
            <Callout variant="info" className="rounded-lg px-3 py-2 text-xs">
              <span className="font-medium text-foreground">Draft</span> spends a few cents (one Opus call) and
              writes nothing — review the picks first.{' '}
              <span className="font-medium text-foreground">Resolve &amp; add</span> spends a few cents of Google
              Places and writes the keepers. You can fine-tune roles in the table afterward.
            </Callout>
            <div className="flex items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="curate-target">How many</Label>
                <Input
                  id="curate-target"
                  type="number"
                  min={8}
                  max={120}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  className="w-24"
                />
              </div>
              <Button onClick={() => draftMut.mutate()}>
                <Sparkles className="h-4 w-4" /> Draft places
              </Button>
            </div>
            {/* The draft is scoped by the region BBOX, which is routinely WIDER than the region's name
                suggests — so the count is a budget spread over that whole box. 30 covers a shoreline;
                a box reaching several towns wants more, or the far ones get squeezed out. */}
            <p className="text-xs text-muted-foreground">
              Spread over the region’s whole bounding box, not just what its name suggests. These names are the
              planner’s entire world — every one it lacks is a “don’t know that one” to a rider. 8–120.
            </p>
          </>
        )}

        {/* DRAFTING — a long synchronous Opus call; show it's working, not frozen. */}
        {drafting && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Drafting this region’s hubs + pitstops with Opus… this takes ~30s.
            </div>
            <div className="space-y-0.5 rounded-lg border p-1.5" aria-hidden>
              {['w-40', 'w-52', 'w-32', 'w-48', 'w-36', 'w-44'].map((w, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                  <Skeleton className="h-4 w-4 shrink-0 rounded" />
                  <Skeleton className={`h-4 ${w}`} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RESULTS summary — then re-draft or Done (in the header). */}
        {results && (
          <>
            <Callout variant={errored ? 'error' : 'info'} className="rounded-lg px-3 py-2 text-sm">
              Added {added ?? resolved} {(added ?? resolved) === 1 ? 'place' : 'places'}
              {added != null && resolved !== added ? ` from ${resolved} resolved picks` : ''}.
              {dropped > 0 && ` ${dropped} couldn’t be pinned in-region (skipped).`}
              {errored > 0 && ` ${errored} errored.`}
            </Callout>
            {/* ⚠ NAME the ones that did not land. The server has always returned a per-draft `results`
                row for every skip and error, and this panel used to render only the counts — so an
                operator was told "7 couldn't be pinned" with no way to learn WHICH 7 or why, on the
                paid step that seeds the planner's allowlist. The counts are the summary; these are the
                evidence. A skip is nearly always the Details-coords guard (Autocomplete only BIASES
                toward the bbox, so a place resolves and is then rejected for landing outside it),
                which is exactly the feedback that tells you the drafting prompt is reaching past the
                box. */}
            {results.filter((r) => r.status !== 'resolved').length > 0 && (
              <div className="space-y-0.5 rounded-lg border p-1.5">
                {results
                  .filter((r) => r.status !== 'resolved')
                  .map((r, i) => (
                    <div key={i} className="flex items-start gap-2 px-2 py-1 text-xs">
                      <Badge variant={r.status === 'error' ? 'destructive' : 'secondary'} className="shrink-0">
                        {r.status === 'error' ? 'error' : 'skipped'}
                      </Badge>
                      <span className="text-foreground">{r.name}</span>
                      <span className="text-muted-foreground">
                        {r.message ?? 'no in-region match — Google pinned it outside the bbox, or not at all'}
                      </span>
                    </div>
                  ))}
              </div>
            )}
            <Button variant="outline" size="sm" onClick={reset}>
              <Sparkles className="h-4 w-4" /> Curate again
            </Button>
          </>
        )}

        {/* PRUNE — uncheck the unwanted, then resolve the keepers. */}
        {hasDrafts && !results && (
          <>
            <SectionLabel>{keptCount} of {drafts.length} kept</SectionLabel>
            <div className="max-h-[32rem] space-y-0.5 overflow-y-auto rounded-lg border p-1.5">
              {drafts.map((d, i) => (
                <label
                  key={i}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={kept.has(i)}
                    onCheckedChange={() => toggleKeep(i)}
                    className="mt-0.5"
                    aria-label={`keep ${d.name}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      {d.rank <= TOP_RANK && (
                        <Star
                          className="h-3 w-3 shrink-0"
                          style={{ color: PLACE_PIN_COLORS.featured, fill: PLACE_PIN_COLORS.featured }}
                        />
                      )}
                      <span className="truncate">{d.name}</span>
                      <Badge variant="secondary" className="ml-auto shrink-0 text-[10px]">
                        rank {d.rank}
                      </Badge>
                    </div>
                    {d.rationale && <div className="truncate text-xs text-muted-foreground">{d.rationale}</div>}
                  </div>
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <PendingButton
                onClick={() => curateMut.mutate()}
                pending={resolving}
                disabled={keptCount === 0}
                icon={<Plus className="h-4 w-4" />}
                idleLabel={`Resolve & add ${keptCount}`}
                pendingLabel="Resolving…"
              />
            </div>
          </>
        )}

        {draftMut.error != null && (
          <Callout variant="error" className="rounded-lg px-3 py-2">{errMsg(draftMut.error)}</Callout>
        )}
        {curateMut.error != null && (
          <Callout variant="error" className="rounded-lg px-3 py-2">{errMsg(curateMut.error)}</Callout>
        )}
      </div>
    </section>
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

  // Reset the dialog each time it opens.
  useEffect(() => {
    if (open) {
      setQuery(''); setCandidate(null); setNoMatch(false)
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
      }),
    onSuccess: onAdded,
  })

  const resolveError = resolveMut.error
  const addError = addMut.error

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
      submitDisabled={!candidate}
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
        <PendingButton
          type="submit"
          variant="outline"
          pending={resolveMut.isPending}
          disabled={!query.trim()}
          icon={<Search className="h-4 w-4" />}
          idleLabel="Search"
          pendingLabel="Searching…"
        />
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
          {/* ⚠ No role to pick: adding a place to `places` IS declaring it a destination (2026-08-04).
              It lands UNRANKED and therefore last — set a rank in the table if it deserves one. */}
          <p className="text-xs text-muted-foreground">
            Added unranked, so it sorts last. Give it a rank in the table if riders would name it.
          </p>
        </div>
      )}

      {addError != null && (
        <Callout variant="error" className="rounded-lg px-3 py-2">{errMsg(addError)}</Callout>
      )}
    </FormDialog>
  )
}
