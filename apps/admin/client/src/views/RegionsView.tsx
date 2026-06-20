import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Compass, Layers, Loader2, Pencil, Plus, Rocket, Search, TriangleAlert } from 'lucide-react'
import { api, type Region } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Callout } from '@/components/ui/callout'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeletonRows } from '@/components/ui/skeleton'
import { BboxMap } from '@/components/ui/leaflet-map'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type DialogMode = { mode: 'create' } | { mode: 'edit'; region: Region }

const CONFIDENCE_META = {
  high: { label: 'High confidence', className: 'text-success' },
  medium: { label: 'Medium confidence', className: 'text-warning' },
  low: { label: 'Low confidence', className: 'text-destructive' },
}

export function RegionsView() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState<DialogMode | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const navigate = useNavigate()
  const { data: regions = [], error: err, isPending } = useQuery({ queryKey: ['regions'], queryFn: async () => (await api.regions()).regions })

  // Row selection drives Discover: pick region row(s) → sweep their bbox(es). Mirrors the POIs scope model.
  const numSelected = sel.size
  const selectedRegions = regions.filter((r) => sel.has(r.slug)).map((r) => ({ slug: r.slug, displayName: r.displayName }))
  const allChecked = regions.length > 0 && numSelected === regions.length
  const someChecked = numSelected > 0 && numSelected < regions.length
  function toggleRow(slug: string) {
    setSel((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }
  function toggleAll() { setSel(numSelected > 0 ? new Set() : new Set(regions.map((r) => r.slug))) }
  function clearSel() { setSel(new Set()) }

  // region-release-gate: releasing is IRREVERSIBLE + auto-releases every staged clip in the bbox.
  // Re-running on an already-released region pushes any newly-staged clips public (idempotent).
  const releaseMut = useMutation({
    mutationFn: (slug: string) => api.releaseRegion(slug),
    onSuccess: (res) => {
      setNotice(
        res.releasedClips > 0
          ? `Released ${res.releasedClips} clip${res.releasedClips === 1 ? '' : 's'} in ${res.region.slug}.`
          : `${res.region.slug} is released — no staged clips were waiting.`,
      )
      qc.invalidateQueries({ queryKey: ['regions'] })
      qc.invalidateQueries({ queryKey: ['pois'] })
    },
  })

  async function onRelease(r: Region) {
    const draft = r.releasedAt == null
    const ok = await confirm({
      title: draft ? `Release ${r.displayName} to the public?` : `Release new clips in ${r.displayName}?`,
      body: draft
        ? 'This opens the region to everyone and releases every staged clip inside its bbox. Releasing is permanent — a region can never be un-released (it would orphan saved drives and break offline downloads). Tweak POIs first; testers can preview staged clips in-app.'
        : 'This region is already public. Re-running release pushes any clips that have staged since (new POIs, fresh regens) to the public. This is permanent and cannot be undone.',
      confirmLabel: draft ? 'Release region' : 'Release new clips',
      tone: 'destructive',
    })
    if (ok) releaseMut.mutate(r.slug)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regions"
        description="Geographic regions — the slug drives POI discovery and the in-app region picker. The discovery bbox is passed to the POI sweep job."
        actions={
          <Button onClick={() => setDialog({ mode: 'create' })}>
            <Plus className="h-4 w-4" /> Add region
          </Button>
        }
      />

      {err && (
        <Callout variant="error">
          <span className="font-medium">Error loading regions:</span> {errMsg(err)}
        </Callout>
      )}

      {releaseMut.error && (
        <Callout variant="error">
          <span className="font-medium">Release failed:</span> {errMsg(releaseMut.error)}
        </Callout>
      )}

      {notice && <Callout variant="info">{notice}</Callout>}

      <Callout variant="info">
        <span className="font-medium text-foreground">Discovery bbox</span> — the bounding box passed to{' '}
        <code className="font-mono text-xs">Discover POIs</code> as{' '}
        <code className="font-mono text-xs">--bbox "lng_min,lat_min,lng_max,lat_max"</code>. Leave blank to use the
        built-in default (Tahoe basin). Set this before running a discovery sweep for any new region.
      </Callout>

      {numSelected > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="mr-1 font-medium">
            {numSelected} region{numSelected === 1 ? '' : 's'} selected
          </span>
          <Button size="sm" onClick={() => setDiscoverOpen(true)}>
            <Compass className="h-4 w-4" /> Discover {numSelected}
          </Button>
          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={clearSel}>
            Clear
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allChecked}
                  indeterminate={someChecked}
                  onCheckedChange={toggleAll}
                  aria-label="Select all regions"
                />
              </TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Display name</TableHead>
              <TableHead>Discovery bbox</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-44" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending && <TableSkeletonRows rows={4} cols={6} />}
            {regions.map((r) => {
              const released = r.releasedAt != null
              return (
              <TableRow key={r.slug} className={cn(sel.has(r.slug) && 'bg-muted/40')}>
                <TableCell className="w-10">
                  <Checkbox
                    checked={sel.has(r.slug)}
                    onCheckedChange={() => toggleRow(r.slug)}
                    aria-label={`Select ${r.displayName}`}
                  />
                </TableCell>
                <TableCell className="font-mono text-sm">{r.slug}</TableCell>
                <TableCell className="font-medium">{r.displayName}</TableCell>
                <TableCell>
                  {r.bbox ? (
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.bbox}</code>
                  ) : (
                    <Badge variant="secondary">default (Tahoe)</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {released ? (
                    <Badge variant="success" title={`Released ${new Date(r.releasedAt!).toLocaleString()}`}>
                      <CheckCircle2 className="h-3 w-3" /> Released
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Draft</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant={released ? 'ghost' : 'default'}
                      size="sm"
                      disabled={releaseMut.isPending}
                      onClick={() => void onRelease(r)}
                      title={released ? 'Release any clips staged since' : 'Open this region to the public (permanent)'}
                    >
                      <Rocket className="h-3.5 w-3.5" />
                      {released ? 'Release new' : 'Release'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ mode: 'edit', region: r })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              )
            })}
            {!isPending && regions.length === 0 && !err && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6}>
                  <EmptyState icon={Layers}>No regions yet — add one to get started.</EmptyState>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {dialog && (
        <RegionDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); qc.invalidateQueries({ queryKey: ['regions'] }) }}
        />
      )}

      <DiscoverDialog
        regions={selectedRegions}
        open={discoverOpen}
        onOpenChange={setDiscoverOpen}
        onSubmitted={() => { setDiscoverOpen(false); clearSel(); navigate({ to: '/runs' }) }}
      />
    </div>
  )
}

/* ── DISCOVER POIs (per selected region; FREE — no LLM/TTS spend) ── */

// Sweeps every Wikidata-pinned place in each selected region's bbox and upserts the shared POI corpus.
// Free (no model/TTS), so no confirm gate. Launches one discover_pois run PER region — each lands on the
// Runs timeline. Preview dry-runs the sweep (counts candidates); Discover upserts.
function DiscoverDialog({ regions, open, onOpenChange, onSubmitted }: {
  regions: { slug: string; displayName: string }[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted: () => void
}) {
  const qc = useQueryClient()
  const submitMut = useMutation({
    mutationFn: (apply: boolean) =>
      Promise.all(regions.map((r) => api.createJob({ kind: 'discover_pois', region: r.slug, apply }))),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['runs'] }); onSubmitted() },
  })
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitMut.isPending) onOpenChange(o) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Compass className="h-4 w-4" /> Discover POIs</DialogTitle>
          <DialogDescription>
            Discovers every Wikidata-pinned place in each region's bbox and upserts the shared POI corpus —
            roam draws from it. Free — no LLM or TTS spend.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
            <div className="font-medium text-foreground">
              Discovering {regions.length} region{regions.length === 1 ? '' : 's'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {regions.map((r) => (
                <Badge key={r.slug} variant="secondary" className="font-normal">{r.displayName}</Badge>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Free — no spend, no deletion. <span className="font-medium text-foreground">Preview</span> dry-runs the
            sweep (counts candidates); <span className="font-medium text-foreground">Discover</span> upserts the corpus.
            One run per region lands on the Runs timeline.
          </p>
        </div>

        {submitMut.error && (
          <Callout variant="error" className="rounded-lg px-3 py-2">{errMsg(submitMut.error)}</Callout>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitMut.isPending}>Cancel</Button>
          <Button variant="outline" onClick={() => submitMut.mutate(false)} disabled={submitMut.isPending || regions.length === 0}>
            Preview
          </Button>
          <Button onClick={() => submitMut.mutate(true)} disabled={submitMut.isPending || regions.length === 0}>
            <Compass className="h-4 w-4" /> {submitMut.isPending ? 'Queuing…' : 'Discover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── REGION DIALOG ── */

function RegionDialog({
  mode,
  onClose,
  onSaved,
}: {
  mode: DialogMode
  onClose: () => void
  onSaved: () => void
}) {
  const existing = mode.mode === 'edit' ? mode.region : null

  const [slug, setSlug] = useState(existing?.slug ?? '')
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '')
  const [bbox, setBbox] = useState(existing?.bbox ?? '')

  const saveMut = useMutation({
    mutationFn: () => {
      const patch = { displayName: displayName.trim(), bbox: bbox.trim() || null }
      return mode.mode === 'create'
        ? api.createRegion({ slug: slug.trim(), ...patch })
        : api.updateRegion(mode.region.slug, patch)
    },
    onSuccess: () => onSaved(),
  })

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{mode.mode === 'create' ? 'Add region' : `Edit ${existing?.displayName}`}</DialogTitle>
          <DialogDescription>
            {mode.mode === 'create'
              ? 'Create a new region. The slug is permanent and used as the DB key — choose carefully.'
              : 'Update the display name or discovery bbox.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode.mode === 'create' && (
            <div className="space-y-1.5">
              <Label htmlFor="region-slug">Slug *</Label>
              <Input
                id="region-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="yosemite-valley"
              />
              <p className="text-xs text-muted-foreground">Lowercase kebab-case. Permanent DB key.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="region-name">Display name *</Label>
            <Input
              id="region-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Yosemite Valley"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="region-bbox">Discovery bbox</Label>
            <Input
              id="region-bbox"
              value={bbox}
              onChange={(e) => setBbox(e.target.value)}
              placeholder="-119.6,37.6,-119.4,37.8"
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              <code className="font-mono">lng_min,lat_min,lng_max,lat_max</code>. Leave blank to use the built-in
              default (Tahoe basin). Use the lookup below, or draw a box on the map.
            </p>
          </div>

          <BboxMap bbox={bbox} onBbox={setBbox} />

          {/* ── Bbox lookup ── */}
          <BboxLookup
            defaultQuery={displayName}
            onUse={(b) => setBbox(b)}
          />
        </div>

        {saveMut.error && (
          <Callout variant="error" className="rounded-lg px-3 py-2">{errMsg(saveMut.error)}</Callout>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saveMut.isPending}>Cancel</Button>
          <Button
            disabled={saveMut.isPending || !displayName.trim() || (mode.mode === 'create' && !slug.trim())}
            onClick={() => saveMut.mutate()}
          >
            {saveMut.isPending ? 'Saving…' : mode.mode === 'create' ? 'Create region' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── BBOX LOOKUP ── */

function BboxLookup({ defaultQuery, onUse }: { defaultQuery: string; onUse: (bbox: string) => void }) {
  const [q, setQ] = useState('')
  // An imperative read (triggered by the Search button / Enter), so a mutation fits better than a query.
  const lookupMut = useMutation({ mutationFn: () => api.bboxLookup(q.trim()) })
  const result = lookupMut.data ?? null

  // When the display name changes and we haven't searched yet, keep q in sync as a hint.
  useEffect(() => {
    if (!lookupMut.data && !lookupMut.isPending) setQ(defaultQuery)
  }, [defaultQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  function lookup() {
    if (!q.trim()) return
    lookupMut.mutate()
  }

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Bbox lookup
      </div>

      <div className="flex gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void lookup() }}
          placeholder="Yosemite National Park"
          className="text-sm"
        />
        <Button variant="outline" size="sm" disabled={lookupMut.isPending || !q.trim()} onClick={lookup} className="shrink-0">
          {lookupMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {lookupMut.isPending ? 'Searching…' : 'Search'}
        </Button>
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Search runs a Claude estimate (a small paid AI call) alongside a free OpenStreetMap lookup.
      </p>

      {lookupMut.error && (
        <div className="mt-2 text-xs text-destructive">{errMsg(lookupMut.error)}</div>
      )}

      {result && (
        <div className="mt-3 space-y-3">
          {/* LLM result */}
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Claude estimate</span>
              {result.llm && (
                <span className={cn('normal-case font-normal', CONFIDENCE_META[result.llm.confidence].className)}>
                  · {CONFIDENCE_META[result.llm.confidence].label}
                </span>
              )}
            </div>
            {result.llm ? (
              <BboxCard
                bbox={result.llm.bbox}
                label={result.llm.reasoning}
                onUse={onUse}
              />
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="h-3.5 w-3.5 text-warning" />
                {result.llmError ?? 'No result'}
              </div>
            )}
          </div>

          {/* OSM results */}
          <div>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              OpenStreetMap
            </div>
            {result.osm && result.osm.length > 0 ? (
              <div className="space-y-1.5">
                {result.osm.map((r, i) => (
                  <BboxCard
                    key={i}
                    bbox={r.bbox}
                    label={r.name}
                    sublabel={r.type}
                    onUse={onUse}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <TriangleAlert className="h-3.5 w-3.5 text-warning" />
                {result.osmError ?? 'No results from Nominatim'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function BboxCard({
  bbox,
  label,
  sublabel,
  onUse,
}: {
  bbox: string
  label: string
  sublabel?: string
  onUse: (bbox: string) => void
}) {
  const [used, setUsed] = useState(false)

  function use() {
    onUse(bbox)
    setUsed(true)
    setTimeout(() => setUsed(false), 1500)
  }

  return (
    <div className="flex items-start gap-2 rounded-md border bg-background px-3 py-2">
      <div className="min-w-0 flex-1">
        <code className="block font-mono text-xs">{bbox}</code>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={label}>{label}</p>
        {sublabel && <p className="text-[11px] text-muted-foreground/70">{sublabel}</p>}
      </div>
      <Button
        variant={used ? 'default' : 'outline'}
        size="sm"
        onClick={use}
        className="shrink-0"
      >
        {used ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
        {used ? 'Applied' : 'Use'}
      </Button>
    </div>
  )
}
