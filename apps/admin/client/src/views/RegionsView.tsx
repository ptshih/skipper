import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Compass, Layers, Loader2, Plus, Rocket, Search, Sparkles, TriangleAlert } from 'lucide-react'
import { api, type BboxLlmResult, type BboxRefinement, type Region } from '@/lib/api'
import { errMsg, fmtDate } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { useAdminList } from '@/lib/useAdminList'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/ui/data-table'
import { SelectionBar } from '@/components/ui/selection-bar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PendingButton } from '@/components/ui/pending-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Callout } from '@/components/ui/callout'
import { EmptyState } from '@/components/ui/empty-state'
import { BboxMap } from '@/components/ui/google-map'
import { DiscoverPoisDialog } from '@/components/DiscoverPoisDialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
  // The Discover dialog's scope: a row's own region (per-row button) or the bulk selection. null = closed.
  const [discoverScope, setDiscoverScope] = useState<{ slug: string; displayName: string }[] | null>(null)
  const navigate = useNavigate()
  const { data: regions, error: err, isPending } = useAdminList(qk.regions(), async () => (await api.regions()).regions)

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
      qc.invalidateQueries({ queryKey: qk.regions() })
      qc.invalidateQueries({ queryKey: qk.pois() })
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

  const columns: Column<Region>[] = [
    {
      header: (
        <Checkbox
          checked={allChecked}
          indeterminate={someChecked}
          onCheckedChange={toggleAll}
          aria-label="Select all regions"
        />
      ),
      headClassName: 'w-10',
      cellClassName: 'w-10',
      cellStopPropagation: true,
      cell: (r) => (
        <Checkbox
          checked={sel.has(r.slug)}
          onCheckedChange={() => toggleRow(r.slug)}
          aria-label={`Select ${r.displayName}`}
        />
      ),
    },
    { header: 'Slug', cellClassName: 'font-mono text-sm', cell: (r) => r.slug },
    { header: 'Display name', cellClassName: 'font-medium', cell: (r) => r.displayName },
    {
      header: 'Discovery bbox',
      cell: (r) =>
        r.bbox ? (
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.bbox}</code>
        ) : (
          <Badge variant="secondary">default (Tahoe)</Badge>
        ),
    },
    {
      header: <span title="POIs whose coords fall in this region's discovery bbox">POIs</span>,
      cellClassName: 'font-mono text-sm tabular-nums',
      cell: (r) =>
        r.poiCount == null ? (
          <span className="text-muted-foreground" title="No discovery bbox set">—</span>
        ) : (
          r.poiCount.toLocaleString()
        ),
    },
    {
      header: 'Status',
      cell: (r) =>
        r.releasedAt != null ? (
          <Badge variant="success" title={`Released ${fmtDate(r.releasedAt)}`}>
            <CheckCircle2 className="h-3 w-3" /> Released
          </Badge>
        ) : (
          <Badge variant="secondary">Draft</Badge>
        ),
    },
    {
      header: '',
      headClassName: 'w-64',
      cellStopPropagation: true,
      cell: (r) => {
        const released = r.releasedAt != null
        return (
          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDiscoverScope([{ slug: r.slug, displayName: r.displayName }])}
              title="Discover Wikidata POIs in this region's bbox (free — no spend)"
            >
              <Compass className="h-3.5 w-3.5" /> Discover
            </Button>
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
          </div>
        )
      },
    },
  ]

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
        <span className="font-medium text-foreground">Discovery bbox</span> — the area{' '}
        <code className="font-mono text-xs">Discover POIs</code> sweeps for this region (
        <code className="font-mono text-xs">lng_min,lat_min,lng_max,lat_max</code>). It's stored on the region and
        resolved by slug at sweep time. Leave blank to use the built-in default (Tahoe basin). Set this before
        running a discovery sweep for any new region.
      </Callout>

      {numSelected > 0 && (
        <SelectionBar>
          <span className="mr-1 font-medium">
            {numSelected} region{numSelected === 1 ? '' : 's'} selected
          </span>
          <Button size="sm" onClick={() => setDiscoverScope(selectedRegions)}>
            <Compass className="h-4 w-4" /> Discover {numSelected}
          </Button>
          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={clearSel}>
            Clear
          </button>
        </SelectionBar>
      )}

      <DataTable
        columns={columns}
        rows={regions}
        rowKey={(r) => r.slug}
        loading={isPending}
        skeletonRows={4}
        onRowClick={(r) => setDialog({ mode: 'edit', region: r })}
        rowClassName={(r) => (sel.has(r.slug) ? 'bg-muted/40' : undefined)}
        empty={!err ? <EmptyState icon={Layers}>No regions yet — add one to get started.</EmptyState> : undefined}
      />

      {dialog && (
        <RegionDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); qc.invalidateQueries({ queryKey: qk.regions() }) }}
        />
      )}

      <DiscoverPoisDialog
        regions={discoverScope ?? []}
        open={discoverScope != null}
        onOpenChange={(o) => { if (!o) setDiscoverScope(null) }}
        onSubmitted={() => { setDiscoverScope(null); clearSel(); navigate({ to: '/jobs' }) }}
      />
    </div>
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
    <Sheet open onOpenChange={(o) => { if (!o && !saveMut.isPending) onClose() }}>
      {/* A wide right-side drawer: a fixed left rail holds the form (name, bbox, conversational bbox
          lookup — stacked + scrollable); the map fills the rest as a tall, full-height canvas. */}
      <SheetContent side="right" className="max-w-5xl">
        <SheetHeader className="flex-col items-stretch gap-1">
          <SheetTitle>{mode.mode === 'create' ? 'Add region' : `Edit ${existing?.displayName}`}</SheetTitle>
          <SheetDescription>
            {mode.mode === 'create'
              ? 'Create a new region. The slug is permanent and used as the DB key — choose carefully.'
              : 'Update the display name or discovery bbox.'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 gap-5 px-5 py-4">
          {/* Left rail — the form: identity + bbox + the conversational lookup, stacked. Scrolls on its
              own so the map beside it always fills the drawer height. */}
          <div className="flex w-[24rem] shrink-0 flex-col gap-4 overflow-y-auto pr-1">
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
                default (Tahoe basin). Use the lookup, or draw a box on the map.
              </p>
            </div>

            <BboxLookup
              defaultQuery={displayName}
              onUse={(b) => setBbox(b)}
            />
          </div>

          {/* Map canvas — fills the remaining width + full drawer height. */}
          <BboxMap bbox={bbox} onBbox={setBbox} className="h-full min-w-0 flex-1" />
        </div>

        {saveMut.error && (
          <div className="px-5 pb-1">
            <Callout variant="error" className="rounded-lg px-3 py-2">{errMsg(saveMut.error)}</Callout>
          </div>
        )}

        <SheetFooter className="justify-end">
          <Button variant="ghost" onClick={onClose} disabled={saveMut.isPending}>Cancel</Button>
          <PendingButton
            pending={saveMut.isPending}
            disabled={!displayName.trim() || (mode.mode === 'create' && !slug.trim())}
            onClick={() => saveMut.mutate()}
            idleLabel={mode.mode === 'create' ? 'Create region' : 'Save changes'}
            pendingLabel="Saving…"
          />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/* ── BBOX LOOKUP (Claude-only, conversational) ── */

type BboxRound = { instruction: string; estimate: BboxLlmResult }

function BboxLookup({ defaultQuery, onUse }: { defaultQuery: string; onUse: (bbox: string) => void }) {
  const [q, setQ] = useState('')
  const [rounds, setRounds] = useState<BboxRound[]>([]) // the conversation: each instruction + Claude's estimate
  const [refineText, setRefineText] = useState('')

  // Imperative (Search / Enter / Refine), so a mutation fits. `instruction` is the base query on the
  // first search, or the refinement text after; `refinements` carries Claude's prior estimates so it
  // EDITS its last box rather than starting over.
  const lookupMut = useMutation({
    mutationFn: (vars: { instruction: string; refinements: BboxRefinement[] }) =>
      api.bboxLookup({ query: q.trim(), refinements: vars.refinements }),
    onSuccess: (res, vars) => {
      if (!res.llm) return // an LLM-side failure surfaces via res.llmError below
      const round: BboxRound = { instruction: vars.instruction, estimate: res.llm }
      // A fresh search (no refinements) replaces the conversation; a refine appends to it.
      setRounds((rs) => (vars.refinements.length === 0 ? [round] : [...rs, round]))
      setRefineText('')
    },
  })

  // Keep q seeded from the display name until the operator runs a search.
  useEffect(() => {
    if (rounds.length === 0 && !lookupMut.isPending) setQ(defaultQuery)
  }, [defaultQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  const current = rounds.length > 0 ? rounds[rounds.length - 1] : null
  const llmError = lookupMut.data?.llmError ?? null
  const searching = lookupMut.isPending

  function search() {
    if (!q.trim()) return
    setRounds([]) // a fresh search resets the conversation; the call carries no refinements
    lookupMut.mutate({ instruction: q.trim(), refinements: [] })
  }
  function refine() {
    const text = refineText.trim()
    if (!text || !current) return
    // Pair each prior estimate with the instruction that FOLLOWS it (the next round's, or — for the most
    // recent estimate — this new instruction). That linear history is what Claude refines against.
    const refinements: BboxRefinement[] = rounds.map((r, i) => ({
      priorBbox: r.estimate.bbox,
      priorReasoning: r.estimate.reasoning,
      instruction: rounds[i + 1]?.instruction ?? text,
    }))
    lookupMut.mutate({ instruction: text, refinements })
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
          onKeyDown={(e) => { if (e.key === 'Enter') void search() }}
          placeholder="Yosemite National Park"
          className="text-sm"
          disabled={searching}
        />
        <Button variant="outline" size="sm" disabled={searching || !q.trim()} onClick={search} className="shrink-0">
          {searching && !current ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {searching && !current ? 'Searching…' : current ? 'New search' : 'Search'}
        </Button>
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Runs a Claude estimate (a small paid AI call). Refine it with follow-up instructions below.
      </p>

      {/* The conversation — the base estimate, then each refinement, oldest → newest. Any version's
          "Use" applies it to the bbox field, so the operator can keep whichever box reads best. */}
      {rounds.length > 0 && (
        <div className="mt-3 space-y-2.5">
          {rounds.map((round, i) => (
            <div key={i}>
              <div className="mb-1 flex flex-wrap items-center gap-x-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>{i === 0 ? 'Claude estimate' : 'Refined'}</span>
                <span className={cn('normal-case font-normal', CONFIDENCE_META[round.estimate.confidence].className)}>
                  · {CONFIDENCE_META[round.estimate.confidence].label}
                </span>
                {i > 0 && (
                  <span className="normal-case font-normal text-muted-foreground/80">· “{round.instruction}”</span>
                )}
              </div>
              <BboxCard bbox={round.estimate.bbox} label={round.estimate.reasoning} onUse={onUse} />
            </div>
          ))}
        </div>
      )}

      {llmError && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="h-3.5 w-3.5" /> {llmError}
        </div>
      )}
      {lookupMut.error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <TriangleAlert className="h-3.5 w-3.5" /> {errMsg(lookupMut.error)}
        </div>
      )}

      {/* Follow-up refinement — only once there's an estimate to refine. */}
      {current && (
        <div className="mt-3 flex gap-2">
          <Input
            value={refineText}
            onChange={(e) => setRefineText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void refine() }}
            placeholder="Refine — e.g. “tighter to the lake, drop the forest”"
            className="text-sm"
            disabled={searching}
          />
          <Button variant="outline" size="sm" disabled={searching || !refineText.trim()} onClick={refine} className="shrink-0">
            {searching && current ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {searching && current ? 'Refining…' : 'Refine'}
          </Button>
        </div>
      )}
    </div>
  )
}

function BboxCard({
  bbox,
  label,
  onUse,
}: {
  bbox: string
  label: string
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
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{label}</p>
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
