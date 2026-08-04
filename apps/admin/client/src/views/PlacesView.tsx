// /places — curate the per-region set of real-world DESTINATIONS that feed the planner's endpoint
// allowlist. ⚠ ROLES ARE GONE (2026-08-04): every row IS a destination — somewhere a driver would name
// as a start or a finish — so there is nothing to tag, and the only axis left is RANK (how likely a
// visitor is to name it out loud; 1 is most, blank sorts last). Break pitstops went with the roles and
// return with live Places data in M3. Coords are resolved + STORED at curation, so the runtime picker
// makes zero live Places calls. This page is the review/prune/rank + manual-add surface; the bulk seed
// is the interactive Curate button (Opus draft → prune → Places resolve).
// See docs/designs/places-endpoints-spec.md.
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
import { FilterToolbar, FilterSelect } from '@/components/ui/filter-toolbar'
import { SelectionBar } from '@/components/ui/selection-bar'
import { cn } from '@/lib/utils'
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

/** The rank filter's options. Static, so hoisted out of the render. Each value has a matching branch in
 *  the `filtered` predicate — a value with no branch silently filters nothing rather than failing. */
const RANK_FILTERS = [
  { value: 'top', label: `Top-ranked (1–${TOP_RANK})` },
  { value: 'unranked', label: 'Unranked' },
  { value: 'access', label: 'Has an access point' },
]

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

  // Inline RANK edit — optimistic (the cache flips instantly; rolls back on error) so the prune/rank
  // loop stays snappy over a short curated list.
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

  // ── Filter + bulk selection ──────────────────────────────────────────────────
  // ⚠ This list is the longest in the console (172 rows in Tahoe today) and was the ONLY one with no
  // way to search it — finding a place meant paging. Filtering is client-side because the whole region
  // is already in hand: the query returns every row for the bbox, so a server round-trip per keystroke
  // would buy nothing.
  const [q, setQ] = useState('')
  const [rankFilter, setRankFilter] = useState('all')
  const [sel, setSel] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return places.filter((p) => {
      if (rankFilter === 'top' && !(p.rank != null && p.rank <= TOP_RANK)) return false
      if (rankFilter === 'unranked' && p.rank != null) return false
      if (rankFilter === 'access' && p.accessLat == null) return false
      if (!needle) return true
      return p.name.toLowerCase().includes(needle) || (p.primaryType ?? '').toLowerCase().includes(needle)
    })
  }, [places, q, rankFilter])

  // ⚠ ONE expression for the count, the authorisation and the act. `selectedRows` is what the bar
  // counts, what the confirm names, and what the delete iterates — the repo's most-repeated bug is two
  // copies of "the same" set drifting (a dialog that counted VISIBLE rows while the body posted
  // hand-picked ids). Derived from `places`, not `filtered`, so a selection survives a filter change
  // rather than silently shrinking the set the operator is about to delete.
  const selectedRows = useMemo(() => places.filter((p) => sel.has(p.id)), [places, sel])

  const toggleSel = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

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
  // highlight nothing and leave a stale pin id pointed at another region's list. The BULK selection is
  // reset for a sharper reason: ids from the old region would still be live in `sel`, and "Remove 3"
  // would delete rows the operator can no longer see.
  useEffect(() => {
    setSelectedId(null)
    setSel(new Set())
  }, [region])

  const confirm = useConfirm()
  const deleteMut = useMutation({
    // Same reasoning as above: invalidate the list this delete actually came from.
    mutationFn: ({ id }: { id: string; key: readonly unknown[] }) => api.deletePlace(id),
    onSuccess: (_d, vars) => void qc.invalidateQueries({ queryKey: vars.key }),
  })
  const onDelete = async (p: PlaceRow) => {
    if (!(await confirm({ title: `Remove ${p.name}?`, body: 'It will no longer be offerable as a drive endpoint.', confirmLabel: 'Remove', tone: 'destructive' }))) return
    deleteMut.mutate({ id: p.id, key: queryKey })
  }

  // Bulk remove. ⚠ `selectedRows` is read ONCE and drives the count, the confirm copy and the loop, so
  // the number in the dialog cannot describe a different set than the one deleted.
  // ⚠ No bulk endpoint exists, so this is N single deletes. They are fired together and awaited as a
  // group; the list is invalidated once at the end rather than N times.
  const onBulkDelete = async () => {
    const doomed = selectedRows
    if (!doomed.length) return
    const ok = await confirm({
      title: `Remove ${doomed.length} place${doomed.length === 1 ? '' : 's'}?`,
      body: `${doomed.map((p) => p.name).slice(0, 6).join(', ')}${doomed.length > 6 ? `, and ${doomed.length - 6} more` : ''}. They will no longer be offerable as drive endpoints.`,
      confirmLabel: `Remove ${doomed.length}`,
      tone: 'destructive',
    })
    if (!ok) return
    await Promise.all(doomed.map((p) => api.deletePlace(p.id)))
    setSel(new Set())
    void qc.invalidateQueries({ queryKey })
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

  const allShownSelected = filtered.length > 0 && filtered.every((p) => sel.has(p.id))
  const columns: Column<PlaceRow>[] = [
    {
      header: (
        <Checkbox
          checked={allShownSelected}
          aria-label="Select all shown"
          onCheckedChange={() =>
            setSel((prev) => {
              const next = new Set(prev)
              // ⚠ Acts on the SHOWN rows, matching what the operator can see ticking. The bulk actions
              // still count `selectedRows` off the full set, so a filtered-away selection is never
              // silently dropped from the number they are about to authorise.
              if (allShownSelected) filtered.forEach((p) => next.delete(p.id))
              else filtered.forEach((p) => next.add(p.id))
              return next
            })
          }
        />
      ),
      headClassName: 'w-9',
      cellStopPropagation: true,
      cell: (p) => (
        <Checkbox checked={sel.has(p.id)} aria-label={`Select ${p.name}`} onCheckedChange={() => toggleSel(p.id)} />
      ),
    },
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
          {/* Kind folded in beside the coords rather than carrying its own column: it is null for most
              rows (towns and cities have no primaryType), so a column of it was mostly dashes. */}
          <div className="text-xs text-muted-foreground">
            {p.primaryType ? `${kindLabel(p.primaryType)} · ` : ''}{p.lat.toFixed(4)}, {p.lng.toFixed(4)}
          </div>
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
    {
      header: 'Rank',
      // Right-aligned + tabular: a numeric column is compared DOWN it, and proportional digits make
      // unequal numbers look equal at a glance.
      headClassName: 'w-20 text-right',
      cellClassName: 'text-right',
      // The row itself focuses the map, so this cell keeps its clicks: focusing the field to retype a
      // rank must not also fling the camera somewhere.
      cellStopPropagation: true,
      // ⚠ 1 = most likely to be NAMED, not "best". A blank clears it, which sorts the place LAST rather
      // than first — the same rule the roster and the cold open apply (`NULLS LAST`).
      cell: (p) => (
        <Input
          type="number"
          min={1}
          className="h-8 w-16 text-right font-mono tabular-nums"
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
        description="A region’s curated real-world DESTINATIONS — the planner’s entire endpoint allowlist. Ranked by how likely a visitor is to name each out loud. Coords are stored at curation, so the rider’s picker makes zero live Places calls."
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

          {/* ⚠ SIDE BY SIDE, not stacked (2026-08-04). The map used to sit ABOVE the table at a fixed
              height, so it charged ~40% of the viewport on every visit for an answer the operator only
              sometimes wants — you scrolled past it to reach the list. The list-and-details map pattern
              puts the two side by side precisely so the map can stay useful without being in the way:
              it is sticky, so it keeps answering "where is this" as you move DOWN a long list, and the
              list is narrow enough to stay scannable. Below `lg` it stacks back, list first — a phone is
              not what this screen is for, but a laptop at 1280 is. */}
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
            <div>
              <FilterToolbar
                search={q}
                onSearch={setQ}
                searchPlaceholder="Search name or kind…"
                shown={filtered.length}
                total={places.length}
              >
                <FilterSelect
                  value={rankFilter}
                  onChange={setRankFilter}
                  allLabel="Any rank"
                  options={RANK_FILTERS}
                />
              </FilterToolbar>

              {sel.size > 0 && (
                <SelectionBar className="mt-2">
                  <span className="font-medium">
                    {sel.size} selected
                    {/* Says so out loud when the selection reaches past the filter, so "Remove 6" can
                        never quietly include rows that scrolled out of view behind a search. */}
                    {selectedRows.length > filtered.filter((p) => sel.has(p.id)).length && (
                      <span className="ml-1 font-normal text-muted-foreground">
                        (including {selectedRows.length - filtered.filter((p) => sel.has(p.id)).length} hidden by the filter)
                      </span>
                    )}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => void onBulkDelete()}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove {sel.size}
                  </Button>
                  <button className="ml-auto text-xs text-muted-foreground hover:text-foreground" onClick={() => setSel(new Set())}>
                    Clear
                  </button>
                </SelectionBar>
              )}

              <div className="mt-2">
                <DataTable
                  columns={columns}
                  rows={filtered}
                  rowKey={(p) => p.id}
                  onRowClick={(p) => focusPlace(p.id)}
                  rowClassName={(p) => (p.id === selectedId ? 'bg-muted hover:bg-muted' : undefined)}
                  loading={isPending && !!region}
                  skeletonRows={5}
                  pageSize={50}
                  empty={
                    <EmptyState icon={MapPin}>
                      {places.length > 0 ? (
                        <>
                          <div className="font-medium text-foreground">Nothing matches</div>
                          <div>No place here matches that search or filter.</div>
                        </>
                      ) : (
                        <>
                          <div className="font-medium text-foreground">No curated places yet</div>
                          <div>Run Curate to draft this region’s destinations, or add a place by name.</div>
                        </>
                      )}
                    </EmptyState>
                  }
                />
              </div>
            </div>

            {region && pins.length > 0 && (
              // `top-4` clears the app chrome; the map tracks the list instead of scrolling away from it.
              <div className="lg:sticky lg:top-4" ref={mapRef}>
                <PlacesMap
                  places={pins}
                  bbox={bbox}
                  className="h-[34rem]"
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  focusNonce={focusNonce}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  <span style={{ color: PLACE_PIN_COLORS.featured }}>●</span> rank 1–{TOP_RANK} ·{' '}
                  <span style={{ color: PLACE_PIN_COLORS.endpoint }}>●</span> the rest · click either side
                  to find it on the other
                </p>
              </div>
            )}
          </div>
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
//  1. Draft  — one Opus call names the region's destinations, ranked (a few cents; writes nothing).
//  2. The operator unchecks anything they don't want.
//  3. Resolve & add — the keepers are resolved against Google Places (bbox-bound) + upserted.
// Re-runnable (upserts; it never deletes, so pruning is a separate delete). Both steps spend, so the
// founder-gate is the explicit button click (this whole console is behind IAP). ⚠ There are no roles to
// fine-tune afterward (2026-08-04) — what IS editable in the table is each row's RANK.
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
  // ⚠ THREE STATES, NOT A CHECKBOX (2026-08-04). A draft is undecided until the operator says otherwise.
  // This used to be a `Set` of kept indices seeded with EVERY index — keep-all-by-default — which is the
  // shape human-in-the-loop review design names as manufacturing approvals: the cheap path was
  // "resolve all 120", and dropping a place cost a click while keeping it cost nothing. Undecided is
  // now its own state and is NOT resolved, so doing nothing spends nothing.
  const [decided, setDecided] = useState<Map<number, 'keep' | 'drop'>>(new Map())
  // Operator edits to the Places QUERY, by draft index. Absent = use what the model drafted.
  const [edits, setEdits] = useState<Map<number, string>>(new Map())
  const [editing, setEditing] = useState<number | null>(null)
  const [results, setResults] = useState<CurateResult[] | null>(null)
  const [added, setAdded] = useState<number | null>(null)

  // The query a draft will actually be resolved with — the operator's edit if there is one, else the
  // model's. ⚠ ONE expression: what the row displays, what the count is built from, and what is posted
  // all read through this, so the string reviewed is by construction the string sent.
  const queryOf = (i: number) => edits.get(i) ?? drafts[i]?.query ?? ''

  const draftMut = useMutation({
    mutationFn: () => api.draftPlaces({ region }),
    onSuccess: (res) => {
      setDrafts(res.drafts)
      setDecided(new Map())
      setEdits(new Map())
    },
  })
  const curateMut = useMutation({
    mutationFn: () =>
      api.curatePlaces({
        region,
        drafts: drafts.flatMap((d, i) => (decided.get(i) === 'keep' ? [{ ...d, query: queryOf(i) }] : [])),
      }),
    // Keep the server's `added` — it is the count of rows actually WRITTEN, after dedupe by canonical
    // place_id and after any per-row write failure. Deriving the headline from the resolved rows
    // instead over-counted: two drafts can pin the SAME Google place, and an upsert can fail on its own.
    onSuccess: (res) => { setResults(res.results); setAdded(res.added); onCurated() },
  })

  const decide = (i: number, v: 'keep' | 'drop') =>
    setDecided((m) => {
      const n = new Map(m)
      // Clicking the decision a row already has clears it — the way back to undecided without a
      // third button, and the reason Keep and Drop can stay equally weighted.
      n.get(i) === v ? n.delete(i) : n.set(i, v)
      return n
    })

  // Start a fresh draft WITHOUT leaving the panel (after a results summary, or to re-draft).
  const reset = () => {
    setDrafts([]); setDecided(new Map()); setEdits(new Map()); setEditing(null)
    setResults(null); setAdded(null)
    draftMut.reset(); curateMut.reset()
  }

  const hasDrafts = drafts.length > 0
  const keptCount = [...decided.values()].filter((v) => v === 'keep').length
  const droppedCount = [...decided.values()].filter((v) => v === 'drop').length
  const undecidedCount = drafts.length - decided.size

  /** Drafts grouped by how far down the model's own confidence they sit. ⚠ The BANDS are the triage:
   *  review design says route by confidence so attention lands where judgement changes the outcome.
   *  Rank is the only confidence signal a draft carries, and the deep tail is exactly where the
   *  business/parking substitutions were found — so it is banded last and never bulk-kept. */
  const bands = useMemo(() => {
    const idx = drafts.map((_, i) => i)
    return [
      { key: 'top', label: `Most likely to be named · rank 1–${TOP_RANK}`, rows: idx.filter((i) => drafts[i]!.rank <= TOP_RANK), bulk: true },
      { key: 'mid', label: 'Solid · rank 4–7', rows: idx.filter((i) => drafts[i]!.rank > TOP_RANK && drafts[i]!.rank <= 7), bulk: true },
      { key: 'tail', label: 'Deep tail · rank 8+ · read these', rows: idx.filter((i) => drafts[i]!.rank > 7), bulk: false },
    ].filter((b) => b.rows.length > 0)
  }, [drafts])
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
              Places and writes the keepers. You can fine-tune each row’s rank in the table afterward.
            </Callout>
            <div>
              <Button onClick={() => draftMut.mutate()}>
                <Sparkles className="h-4 w-4" /> Draft places
              </Button>
            </div>
            {/* ⚠ NO COUNT TO PICK (founder, 2026-08-04). The draft always asks for as many as the route
                allows, because there was only ever one right answer: the set IS the planner's world, the
                Places spend is decided by what gets PRUNED before "Resolve & add", and the box is
                routinely wider than the region's name suggests. */}
            <p className="text-xs text-muted-foreground">
              Drafts as many as the region can carry, spread over its whole bounding box rather than what its
              name suggests. These names are the planner’s entire world — every one it lacks is a “don’t know
              that one” to a rider.
            </p>
          </>
        )}

        {/* DRAFTING — a long synchronous Opus call; show it's working, not frozen. */}
        {drafting && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Drafting this region’s destinations with Opus… this takes ~30s.
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

        {/* REVIEW — decide each draft, then resolve only the keepers. */}
        {hasDrafts && !results && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <SectionLabel>
                {keptCount} keeping · {droppedCount} dropped · {undecidedCount} undecided
              </SectionLabel>
              {/* ⚠ The honest reading of the spend, shown BEFORE it happens. Nothing in this panel has
                  cost a Places call yet — the Opus draft is already paid for, the resolve is not. Two
                  billed calls per keeper is the rate the curate route actually runs at. */}
              <span className="ml-auto text-xs text-muted-foreground">
                {keptCount === 0
                  ? 'Nothing billed yet — Places is only called for what you keep.'
                  : `≈ ${keptCount * 2} Google Places calls when you resolve · nothing billed yet`}
              </span>
            </div>

            <div className="max-h-[34rem] space-y-3 overflow-y-auto rounded-lg border p-2">
              {bands.map((band) => {
                const undecidedInBand = band.rows.filter((i) => !decided.has(i))
                return (
                  <div key={band.key}>
                    <div className="mb-1 flex items-center gap-2 px-1">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{band.label}</span>
                      <span className="h-px flex-1 bg-border" />
                      {/* ⚠ Bulk keep is offered for the confident bands ONLY, and never for the deep
                          tail — that is where "Serene Lakes" comes back as a realtor. Making it an
                          explicit button rather than a default is the whole point: approving in bulk
                          stays possible, but it is an act, not the thing that happens if you do nothing. */}
                      {band.bulk && undecidedInBand.length > 0 && (
                        <button
                          className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setDecided((m) => {
                              const n = new Map(m)
                              undecidedInBand.forEach((i) => n.set(i, 'keep'))
                              return n
                            })
                          }
                        >
                          Keep all {undecidedInBand.length}
                        </button>
                      )}
                    </div>

                    {band.rows.map((i) => {
                      const d = drafts[i]!
                      const state = decided.get(i)
                      return (
                        <div
                          key={i}
                          className={cn(
                            'mb-1 flex items-start gap-2.5 rounded-md border px-2.5 py-2',
                            state === 'keep' && 'border-primary/45 bg-primary/5',
                            state === 'drop' && 'border-transparent opacity-50',
                            !state && 'border-border',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 text-sm font-medium">
                              {d.rank <= TOP_RANK && (
                                <Star className="h-3 w-3 shrink-0" style={{ color: PLACE_PIN_COLORS.featured, fill: PLACE_PIN_COLORS.featured }} />
                              )}
                              <span className="truncate">{d.name}</span>
                              <Badge variant="secondary" className="shrink-0 text-[10px]">rank {d.rank}</Badge>
                            </div>
                            {d.rationale && <div className="truncate text-xs text-muted-foreground">{d.rationale}</div>}

                            {/* ⚠ THE QUERY, SHOWN AND EDITABLE. This is the string sent to Google, and it
                                was previously invisible — only `name` was rendered. So when a draft
                                resolved to "Serene Lakes Realty" the operator could only discard it,
                                never correct it, and the same substitution came back on the next run.
                                Editing here is the cheapest possible fix: it happens BEFORE the billed
                                resolve, where the guards can only refuse after it. */}
                            {editing === i ? (
                              <Input
                                autoFocus
                                className="mt-1.5 h-7 font-mono text-xs"
                                value={queryOf(i)}
                                aria-label={`Places query for ${d.name}`}
                                onChange={(e) => setEdits((m) => new Map(m).set(i, e.target.value))}
                                onBlur={() => setEditing(null)}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(null) }}
                              />
                            ) : (
                              <button
                                className="mt-1 truncate rounded bg-muted/60 px-1.5 py-0.5 text-left font-mono text-[11px] text-muted-foreground hover:text-foreground"
                                onClick={() => setEditing(i)}
                                title="Edit the query sent to Google Places"
                              >
                                {queryOf(i)}
                                {edits.has(i) && <span className="ml-1.5 not-italic text-primary">edited</span>}
                              </button>
                            )}
                          </div>

                          {/* Keep and Drop carry the SAME weight — same size, same distance, neither
                              pre-selected. Clicking the active one returns the row to undecided. */}
                          <div className="flex shrink-0 gap-1 self-center">
                            <Button
                              variant={state === 'keep' ? 'default' : 'outline'}
                              size="sm"
                              className="h-7 px-2.5 text-xs"
                              onClick={() => decide(i, 'keep')}
                            >
                              Keep
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className={cn('h-7 px-2.5 text-xs', state === 'drop' && 'border-destructive/50 text-destructive')}
                              onClick={() => decide(i, 'drop')}
                            >
                              Drop
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-3">
              <PendingButton
                onClick={() => curateMut.mutate()}
                pending={resolving}
                disabled={keptCount === 0}
                icon={<Plus className="h-4 w-4" />}
                idleLabel={`Resolve & add ${keptCount}`}
                pendingLabel="Resolving…"
              />
              {undecidedCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {undecidedCount} still undecided — they are not resolved and cost nothing.
                </span>
              )}
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
// Google Places (bbox-bound to the region) → insert (upsert by place_id).
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
      description="Search Google Places for a specific destination in this region. The match is resolved + stored once — no live Places calls at drive time."
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
