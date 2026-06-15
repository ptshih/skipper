import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Compass, Locate, Plus, RefreshCw, Search, Sparkles, Trash2, Wrench, X } from 'lucide-react'
import { api, type CorrectionOverride, type PoiDetail, type PoiRow, type StoryEligibility } from '@/lib/api'
import { errMsg, timeAgo } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Callout } from '@/components/ui/callout'
import { SearchInput } from '@/components/ui/search-input'
import { Segmented } from '@/components/ui/segmented'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeletonRows } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type Tab = 'corpus' | 'retire'

const SOURCE_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  wikidata: { label: 'Wikidata', variant: 'default' },
  osm: { label: 'OSM', variant: 'secondary' },
  manual: { label: 'Manual', variant: 'outline' },
}

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'outline'

/** Story-eligibility → badge. A POI property (tours AND roam draw story-grade POIs from the corpus).
 *  `eligible` is the actionable one; the filtered-* states are intentional exclusions, muted. */
const STORY_ELIGIBILITY_META: Record<StoryEligibility, { label: string; variant: BadgeVariant; hint: string }> = {
  eligible: { label: 'eligible', variant: 'default', hint: 'Story-grade — a tour or roam telling can use it' },
  'filtered-source': { label: 'scenic pin', variant: 'outline', hint: 'Wikidata pin — not a story source (wave layer later)' },
  'filtered-taste': { label: 'taste-gate', variant: 'outline', hint: 'Title hits the taste denylist' },
  'filtered-stub': { label: 'stub', variant: 'secondary', hint: 'Full article below the story floor (800 chars)' },
}

/** The SEPARATE roam-specific axis — shown as a secondary badge only when a roam clip exists. */
const ROAM_CLIP_META: Record<'fresh' | 'stale', { label: string; variant: BadgeVariant; hint: string }> = {
  fresh: { label: 'roam clip', variant: 'success', hint: 'Has a roam clip on current facts' },
  stale: { label: 'roam clip · stale', variant: 'warning', hint: 'Facts moved — a run would regenerate it' },
}

export function PoisView() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('corpus')
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [enrichOpen, setEnrichOpen] = useState(false)

  // Shared with RoamView via the ['pois'] key — both read the same corpus, fetched once + cached.
  const { data: pois = [], error: err, isPending } = useQuery({ queryKey: ['pois'], queryFn: async () => (await api.pois()).pois })

  const live = pois // no retired field; all pois are live for now
  const flagged = pois.filter((p) => p.staleFacts || p.suspiciousDuration || (!p.attributed && p.tourCount > 0))

  const tabs: { id: Tab; label: string; count: number; alert?: boolean }[] = [
    { id: 'corpus', label: 'Corpus', count: live.length },
    { id: 'retire', label: 'Retire', count: flagged.length, alert: flagged.length > 0 },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="POIs"
        description="The shared place corpus — sources, tour + roam usage, attribution, and fact corrections. Tours and roam both select from here."
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setDiscoverOpen(true)}>
              <Compass className="h-4 w-4" /> Discover POIs
            </Button>
            <Button variant="outline" onClick={() => setEnrichOpen(true)}>
              <Sparkles className="h-4 w-4" /> Enrich
            </Button>
          </div>
        }
      />

      {err && (
        <Callout variant="error">
          <span className="font-medium">Error loading POIs:</span> {errMsg(err)}
        </Callout>
      )}

      <Segmented
        value={tab}
        onChange={setTab}
        options={tabs.map((t) => ({ value: t.id, label: t.label, count: t.count, alert: t.alert }))}
      />

      {tab === 'corpus' && <CorpusTab pois={live} loading={isPending} />}
      {tab === 'retire' && <RetireTab flagged={flagged} />}

      <DiscoverDialog open={discoverOpen} onOpenChange={setDiscoverOpen} onSubmitted={() => navigate({ to: '/runs' })} />
      <EnrichDialog open={enrichOpen} onOpenChange={setEnrichOpen} onSubmitted={() => navigate({ to: '/runs' })} />
    </div>
  )
}

/* ── DISCOVER POIs ── */

// Fire the region-discovery sweep (sweep_region_pois) for a region. FREE — no LLM/TTS, no confirm.
// bbox comes from the region row's discoveryBbox column — null = use the generator's default.
export async function discoverPois(_regionSlug: string, apply: boolean, bbox?: string | null) {
  await api.createJob({ kind: 'sweep_region_pois', ...(bbox ? { bbox } : {}), apply })
}

// A small, focused shadcn Dialog — NOT the busy New-run form. Pick a region, then Preview (dry-run)
// or Discover (apply). Free, so no confirm gate.
function DiscoverDialog({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted: () => void
}) {
  const [regionSlug, setRegionSlug] = useState('')
  const { data: regions = [], error: loadErr } = useQuery({
    queryKey: ['regions'],
    queryFn: async () => (await api.regions()).regions,
    enabled: open,
  })

  const qc = useQueryClient()
  const submitMut = useMutation({
    mutationFn: (apply: boolean) => discoverPois(regionSlug, apply, regions.find((r) => r.slug === regionSlug)?.discoveryBbox),
    // Refresh the Runs list so the just-created run shows immediately on navigate (not after the
    // 15s poll / a manual refresh).
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['runs'] }); onSubmitted() },
  })
  function submit(apply: boolean) {
    if (!regionSlug) return
    submitMut.mutate(apply)
  }
  const err = loadErr ?? submitMut.error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Compass className="h-4 w-4" /> Discover POIs
          </DialogTitle>
          <DialogDescription>
            Discovers every Wikidata-pinned place in the region and upserts the shared POI corpus — tours and roam
            both draw from it. Free — no LLM or TTS spend.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="discover-region">Region</Label>
          <Select value={regionSlug || undefined} onValueChange={setRegionSlug}>
            <SelectTrigger id="discover-region" className="w-full">
              <SelectValue placeholder={regions.length === 0 ? 'Loading…' : 'Select a region…'} />
            </SelectTrigger>
            <SelectContent>
              {regions.map((r) => (
                <SelectItem key={r.slug} value={r.slug}>{r.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Free preview — no spend, no deletion. <span className="font-medium text-foreground">Preview</span> dry-runs
          the discovery; <span className="font-medium text-foreground">Discover</span> upserts the corpus.
        </div>

        {err && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errMsg(err)}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitMut.isPending}>
            Cancel
          </Button>
          <Button variant="outline" disabled={submitMut.isPending || !regionSlug} onClick={() => void submit(false)}>
            {submitMut.isPending ? 'Triggering…' : 'Preview'}
          </Button>
          <Button disabled={submitMut.isPending || !regionSlug} onClick={() => void submit(true)}>
            <Compass className="h-4 w-4" /> {submitMut.isPending ? 'Triggering…' : 'Discover'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── ENRICH (the corpus fact-well step) ── */

// A focused shadcn Dialog for the corpus `enrich` step (enrich_region): pick a region, then
// Preview (free dry-run — NO model calls, prints the count + a cost estimate) or Enrich (apply,
// SPENDS Anthropic; no TTS). The well it builds (pois.facts.well) is read by BOTH tours + roam, so
// enrich ONCE between Discover and Generate.
function EnrichDialog({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted: () => void
}) {
  const [regionSlug, setRegionSlug] = useState('')
  const { data: regions = [], error: loadErr } = useQuery({
    queryKey: ['regions'],
    queryFn: async () => (await api.regions()).regions,
    enabled: open,
  })

  const qc = useQueryClient()
  const submitMut = useMutation({
    mutationFn: (apply: boolean) => {
      const bbox = regions.find((r) => r.slug === regionSlug)?.discoveryBbox
      return api.createJob({
        kind: 'enrich_region',
        ...(bbox ? { bbox } : {}),
        apply,
        ...(apply ? { confirm: true } : {}), // apply SPENDS → the server's typed confirm gate
      })
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['runs'] }); onSubmitted() },
  })
  function submit(apply: boolean) {
    if (!regionSlug) return
    submitMut.mutate(apply)
  }
  const err = loadErr ?? submitMut.error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" /> Enrich corpus
          </DialogTitle>
          <DialogDescription>
            Scouts each story POI ONCE into a curated, verbatim <strong>fact well</strong> on the shared corpus —
            tours and roam both narrate from it. Run after Discover, before generating. Spends Anthropic credits
            (no TTS); a later re-discover invalidates wells, so re-enrich after one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="enrich-region">Region</Label>
          <Select value={regionSlug || undefined} onValueChange={setRegionSlug}>
            <SelectTrigger id="enrich-region" className="w-full">
              <SelectValue placeholder={regions.length === 0 ? 'Loading…' : 'Select a region…'} />
            </SelectTrigger>
            <SelectContent>
              {regions.map((r) => (
                <SelectItem key={r.slug} value={r.slug}>{r.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Preview</span> dry-runs free (no model calls — prints the
          count + a cost estimate to the run log); <span className="font-medium text-foreground">Enrich</span> spends.
        </div>

        {err && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errMsg(err)}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitMut.isPending}>
            Cancel
          </Button>
          <Button variant="outline" disabled={submitMut.isPending || !regionSlug} onClick={() => void submit(false)}>
            {submitMut.isPending ? 'Triggering…' : 'Preview'}
          </Button>
          <Button disabled={submitMut.isPending || !regionSlug} onClick={() => void submit(true)}>
            <Sparkles className="h-4 w-4" /> {submitMut.isPending ? 'Triggering…' : 'Enrich'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── CORRECTIONS ── */

// Operator surface for a POI's upstream-fact corrections + speakable anchor. Lazy-loads on
// expand. Corrections take effect on the NEXT generate/regeneration — they don't rewrite audio.
function Corrections({ poiId }: { poiId: string }) {
  const qc = useQueryClient()
  const [validationErr, setValidationErr] = useState<string | null>(null)

  // Add-correction form
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [reason, setReason] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  // Speakable-anchor inputs
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')

  const { data, isLoading: loading, error: loadErr } = useQuery({
    queryKey: ['poiCorrections', poiId],
    queryFn: () => api.poiCorrections(poiId),
  })
  // A save returns the updated corrections — write it straight into the cache.
  const saveMut = useMutation({
    mutationFn: (input: Parameters<typeof api.saveCorrection>[1]) => api.saveCorrection(poiId, input),
    onSuccess: (updated) => { qc.setQueryData(['poiCorrections', poiId], updated); setValidationErr(null) },
  })
  const saving = saveMut.isPending
  const err = validationErr ?? (loadErr ? errMsg(loadErr) : saveMut.error ? errMsg(saveMut.error) : null)

  function addCorrection() {
    if (!find.trim() || !reason.trim()) {
      setValidationErr('A find string and a reason are both required.')
      return
    }
    saveMut.mutate(
      { kind: 'fact_edit', find, replace, reason: reason.trim(), ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) },
      { onSuccess: () => { setFind(''); setReplace(''); setReason(''); setSourceUrl('') } },
    )
  }

  function retire(f: string) {
    saveMut.mutate({ kind: 'retire', find: f })
  }

  function setSpeakable() {
    const la = Number(lat), ln = Number(lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln) || lat.trim() === '' || lng.trim() === '') {
      setValidationErr('Speakable anchor needs two numeric coordinates.')
      return
    }
    saveMut.mutate({ kind: 'speakable', lat: la, lng: ln }, { onSuccess: () => { setLat(''); setLng('') } })
  }

  function clearSpeakable() {
    saveMut.mutate({ kind: 'speakable', lat: null })
  }

  if (loading) return <div className="py-2 text-xs text-muted-foreground">Loading corrections…</div>

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Wrench className="h-3.5 w-3.5" /> Corrections
      </div>
      <div className="rounded-md border bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Corrections apply on the <strong className="text-foreground">next generate / regeneration</strong> of a tour
        or roam (the generator loads these overrides + reads the speakable anchor fresh per run). They do{' '}
        <strong className="text-foreground">not</strong> rewrite existing audio.
      </div>

      {err && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {err}
        </div>
      )}

      {/* Existing fact-edits */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fact edits</div>
        {data && data.overrides.length === 0 && (
          <div className="text-xs text-muted-foreground">No corrections yet.</div>
        )}
        {data?.overrides.map((o: CorrectionOverride, i) => (
          <div
            key={`${o.find ?? '∅'}-${i}`}
            className={cn(
              'flex items-start gap-2 rounded-md border bg-background px-3 py-2',
              !o.active && 'opacity-60',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="break-words text-xs">
                <code className="font-mono">{o.find ?? '∅'}</code>
                <span className="mx-1.5 text-muted-foreground">→</span>
                <code className="font-mono">{o.replace === '' ? '(deleted)' : o.replace ?? '∅'}</code>
                {!o.active && <Badge variant="secondary" className="ml-2">retired</Badge>}
                {o.upstreamStatus !== 'not_filed' && <Badge variant="outline" className="ml-1.5">{o.upstreamStatus}</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{o.reason}</div>
              {o.sourceUrl && (
                <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-xs text-primary underline-offset-2 hover:underline">
                  {o.sourceUrl}
                </a>
              )}
            </div>
            {o.active && o.find && (
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => retire(o.find!)} className="shrink-0">
                <Trash2 className="h-3 w-3" /> Retire
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Add correction */}
      <div className="flex flex-col gap-3 rounded-md border border-dashed px-3 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Add correction</div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="corr-find" className="text-xs">Find (exact substring)</Label>
            <Input id="corr-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Leonard Palme" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="corr-replace" className="text-xs">Replace (blank = delete)</Label>
            <Input id="corr-replace" value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Lennart Palme" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="corr-reason" className="text-xs">Reason *</Label>
          <Input id="corr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the source is wrong (required)" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="corr-source" className="text-xs">Source URL (optional)</Label>
          <Input id="corr-source" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://… authoritative source for the fix" />
        </div>
        <div>
          <Button variant="outline" size="sm" disabled={saving} onClick={addCorrection}>
            <Plus className="h-3 w-3" /> {saving ? 'Saving…' : 'Add correction'}
          </Button>
        </div>
      </div>

      {/* Speakable anchor */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Speakable anchor</div>
        <div className="text-xs leading-relaxed text-muted-foreground">
          The vantage point side-of-road content speaks from — only needed when the POI's own centroid is misleading.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Locate className="h-3.5 w-3.5 text-muted-foreground" />
          {data?.speakable ? (
            <span className="font-mono text-xs">{data.speakable.lat.toFixed(5)}, {data.speakable.lng.toFixed(5)}</span>
          ) : (
            <span className="text-xs text-muted-foreground">not set — speaks from the POI pin</span>
          )}
          {data?.speakable && (
            <Button variant="ghost" size="sm" disabled={saving} onClick={clearSpeakable}>
              <Trash2 className="h-3 w-3" /> Clear
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-32 space-y-1.5">
            <Label htmlFor="corr-lat" className="text-xs">Lat</Label>
            <Input id="corr-lat" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="38.9540" inputMode="decimal" />
          </div>
          <div className="w-32 space-y-1.5">
            <Label htmlFor="corr-lng" className="text-xs">Lng</Label>
            <Input id="corr-lng" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-120.0950" inputMode="decimal" />
          </div>
          <Button variant="outline" size="sm" disabled={saving} onClick={setSpeakable}>
            {saving ? 'Saving…' : 'Set anchor'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ── POI DETAIL SHEET ── */

function PoiDetailSheet({ poiId, poiName, canDelete, open, onOpenChange }: {
  poiId: string
  poiName: string
  /** Orphan (no tours/roam clips) → a hard delete is allowed. Referenced POIs are FK-protected. */
  canDelete: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'facts' | 'corrections'>('facts')
  const { data: detail, error: err } = useQuery({
    queryKey: ['poi', poiId],
    queryFn: async () => (await api.poi(poiId)).poi,
    enabled: open,
  })
  // Hard delete — only surfaced for orphans (canDelete). Closes the sheet + refreshes the corpus.
  const deleteMut = useMutation({
    mutationFn: () => api.deletePoi(poiId),
    onSuccess: () => { onOpenChange(false); void qc.invalidateQueries({ queryKey: ['pois'] }) },
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[520px] max-w-full flex-col gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="justify-between px-6 py-4">
          <SheetTitle className="leading-snug">{poiName}</SheetTitle>
          <button
            onClick={() => onOpenChange(false)}
            className="mt-0.5 shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </SheetHeader>

        {/* Tab strip */}
        <div className="flex border-b">
          {(['facts', 'corrections'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-5 py-2.5 text-sm font-medium transition-colors',
                tab === t
                  ? 'border-b-2 border-foreground text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {err && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{errMsg(err)}</div>
          )}

          {tab === 'facts' && (
            detail ? <FactsTab poi={detail} /> : !err && <div className="text-sm text-muted-foreground">Loading…</div>
          )}

          {tab === 'corrections' && <Corrections poiId={poiId} />}
        </div>

        {canDelete && (
          <div className="border-t px-6 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                disabled={deleteMut.isPending}
                onClick={() => {
                  if (!window.confirm(`Permanently delete "${poiName}"? This removes the POI record.`)) return
                  deleteMut.mutate()
                }}
              >
                <Trash2 className="h-4 w-4" /> {deleteMut.isPending ? 'Deleting…' : 'Delete POI'}
              </Button>
              <span className="text-xs text-muted-foreground">No tours or roam clips reference this POI.</span>
            </div>
            {deleteMut.error && (
              <div className="mt-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {errMsg(deleteMut.error)}
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function FactsTab({ poi }: { poi: PoiDetail }) {
  return (
    <div className="space-y-4">
      {/* Metadata grid */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source</dt>
          <dd className="mt-0.5 font-mono text-xs">{poi.source} / {poi.sourceId}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Kind</dt>
          <dd className="mt-0.5">{poi.kind ?? <span className="text-muted-foreground">—</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Coordinates</dt>
          <dd className="mt-0.5 font-mono text-xs">{poi.lat.toFixed(5)}, {poi.lng.toFixed(5)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Facts hash</dt>
          <dd className="mt-0.5 font-mono text-xs">{poi.factsHash ? poi.factsHash.slice(0, 12) : <span className="text-muted-foreground">—</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Facts fetched</dt>
          <dd className="mt-0.5 text-xs">{poi.factsFetchedAt ? timeAgo(poi.factsFetchedAt) : <span className="text-muted-foreground">never</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Added</dt>
          <dd className="mt-0.5 text-xs">{timeAgo(poi.createdAt)}</dd>
        </div>
      </dl>

      {/* Summary */}
      {poi.summary && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Summary</div>
          <p className="text-sm leading-relaxed text-muted-foreground">{poi.summary}</p>
        </div>
      )}

      {/* Facts JSON */}
      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Facts JSON {poi.facts ? <span className="normal-case text-muted-foreground">({Object.keys(poi.facts).length} keys)</span> : null}
        </div>
        {poi.facts ? (
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all">
            {JSON.stringify(poi.facts, null, 2)}
          </pre>
        ) : (
          <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">No facts fetched yet.</div>
        )}
      </div>
    </div>
  )
}

/* ── CORPUS ── */

function CorpusTab({ pois, loading }: { pois: PoiRow[]; loading: boolean }) {
  const [q, setQ] = useState('')
  const [region, setRegion] = useState('all')
  const [source, setSource] = useState('all')
  const [flags, setFlags] = useState('all')
  const [sheetPoi, setSheetPoi] = useState<{ id: string; name: string; canDelete: boolean } | null>(null)

  const regions = useMemo(() => {
    const seen = new Set<string>()
    return pois
      .filter((p) => p.regionSlug && (seen.has(p.regionSlug) ? false : (seen.add(p.regionSlug), true)))
      .map((p) => ({ slug: p.regionSlug!, name: p.regionName ?? p.regionSlug! }))
  }, [pois])

  const filtered = useMemo(() => pois.filter((p) => {
    if (region !== 'all' && p.regionSlug !== region) return false
    if (source !== 'all' && p.source !== source) return false
    if (flags === 'defect' && !p.suspiciousDuration) return false
    if (flags === 'stale' && !p.staleFacts) return false
    if (flags === 'unattrib' && (p.attributed || p.tourCount === 0)) return false
    if (flags === 'story-eligible' && p.storyEligibility !== 'eligible') return false
    if (flags === 'story-filtered' && !p.storyEligibility.startsWith('filtered-')) return false
    if (flags === 'roam-clip-stale' && p.roamClip !== 'stale') return false
    if (q) {
      const s = `${p.name} ${p.sourceId}`.toLowerCase()
      if (!s.includes(q.toLowerCase())) return false
    }
    return true
  }), [pois, region, source, flags, q])

  const totals = {
    total: pois.length,
    withClips: pois.filter((p) => p.roamClipCount > 0).length,
    eligible: pois.filter((p) => p.storyEligibility === 'eligible').length,
    inTours: pois.filter((p) => p.tourCount > 0).length,
    unattrib: pois.filter((p) => !p.attributed && p.tourCount > 0).length,
    defects: pois.filter((p) => p.suspiciousDuration).length,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{totals.total} total</Badge>
        <Badge>{totals.withClips} with roam clips</Badge>
        {totals.eligible > 0 && (
          <button onClick={() => setFlags('story-eligible')}>
            <Badge variant="default" className="cursor-pointer">{totals.eligible} story-eligible</Badge>
          </button>
        )}
        <Badge variant="success">{totals.inTours} in tours</Badge>
        {totals.unattrib > 0 && <Badge variant="destructive">{totals.unattrib} unattributed</Badge>}
        {totals.defects > 0 && (
          <button onClick={() => setFlags('defect')}>
            <Badge variant="destructive" className="cursor-pointer">
              {totals.defects} clip defect{totals.defects > 1 ? 's' : ''}
            </Badge>
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          wrapperClassName="min-w-[16rem] flex-1"
          placeholder="Search name, source id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select value={region} onValueChange={setRegion}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {regions.map((r) => <SelectItem key={r.slug} value={r.slug}>{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="wikidata">Wikidata</SelectItem>
            <SelectItem value="osm">OSM</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
        <Select value={flags} onValueChange={setFlags}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All flags</SelectItem>
            <SelectItem value="story-eligible">Story: eligible</SelectItem>
            <SelectItem value="story-filtered">Story: filtered out</SelectItem>
            <SelectItem value="roam-clip-stale">Roam clip: stale</SelectItem>
            <SelectItem value="defect">Clip defects</SelectItem>
            <SelectItem value="stale">Stale facts</SelectItem>
            <SelectItem value="unattrib">Unattributed</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {pois.length}</span>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Region</TableHead>
              <TableHead className="text-right">Tours</TableHead>
              <TableHead>Story</TableHead>
              <TableHead>Attribution</TableHead>
              <TableHead>Facts hash</TableHead>
              <TableHead className="text-right">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && <TableSkeletonRows rows={8} cols={8} />}
            {filtered.map((p) => {
              const sm = SOURCE_META[p.source]
              const em = STORY_ELIGIBILITY_META[p.storyEligibility]
              return (
                <Fragment key={p.id}>
                  <TableRow
                    className="cursor-pointer"
                    onClick={() => setSheetPoi({ id: p.id, name: p.name, canDelete: p.tourCount + p.roamClipCount === 0 })}
                  >
                    <TableCell>
                      <span className="font-medium hover:underline">{p.name}</span>
                      {(p.staleFacts || p.suspiciousDuration) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.staleFacts && <Badge variant="warning">stale facts</Badge>}
                          {p.suspiciousDuration && <Badge variant="destructive">clip defect</Badge>}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <Badge variant={sm?.variant ?? 'outline'}>{sm?.label ?? p.source}</Badge>
                        <code className="font-mono text-xs text-muted-foreground">{p.sourceId}</code>
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.regionName ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {p.tourCount > 0 ? p.tourCount : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant={em.variant} title={em.hint}>{em.label}</Badge>
                        {p.roamClip !== 'none' && (
                          <Badge variant={ROAM_CLIP_META[p.roamClip].variant} title={ROAM_CLIP_META[p.roamClip].hint}>
                            {ROAM_CLIP_META[p.roamClip].label}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.tourCount > 0 ? (
                        <Badge variant={p.attributed ? 'success' : 'destructive'}>{p.attributed ? '✓' : 'missing'}</Badge>
                      ) : (
                        <span className="text-muted-foreground">n/a</span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {p.factsHash ? p.factsHash.slice(0, 7) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{timeAgo(p.createdAt)}</TableCell>
                  </TableRow>
                </Fragment>
              )
            })}
            {!loading && filtered.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8}>
                  <EmptyState icon={Search}>No POIs match these filters.</EmptyState>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {sheetPoi && (
        <PoiDetailSheet
          poiId={sheetPoi.id}
          poiName={sheetPoi.name}
          canDelete={sheetPoi.canDelete}
          open={!!sheetPoi}
          onOpenChange={(o) => { if (!o) setSheetPoi(null) }}
        />
      )}
    </div>
  )
}

/* ── RETIRE ── */

function RetireTab({ flagged }: { flagged: PoiRow[] }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [actionErr, setActionErr] = useState<string | null>(null)

  // Re-fetch is a FREE cloud job (MediaWiki only, no LLM/TTS) — fire it, then jump to Runs to watch.
  const refetchMut = useMutation({
    mutationFn: (poiId: string) => api.createJob({ kind: 'refetch_facts', poiId, apply: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['runs'] }); navigate({ to: '/runs' }) },
    onError: (e) => setActionErr(errMsg(e)),
  })
  // Retire is a hard DELETE, allowed ONLY for orphaned POIs (no segments) — the server guards it too.
  const deleteMut = useMutation({
    mutationFn: (poiId: string) => api.deletePoi(poiId),
    onSuccess: () => { setActionErr(null); void qc.invalidateQueries({ queryKey: ['pois'] }) },
    onError: (e) => setActionErr(errMsg(e)),
  })

  if (flagged.length === 0) {
    return (
      <EmptyState
        icon={CircleCheck}
        iconClassName="text-success"
        className="rounded-xl border bg-muted/30"
      >
        No flagged POIs — corpus is clean.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Flagged POIs. <strong className="text-foreground">Re-fetch</strong> re-pulls facts from Wikipedia (free) — if
        they change, regenerate the owning tour to clear the staleness. Unattributed story stops violate CC BY-SA and
        need a regenerate. <strong className="text-foreground">Retire</strong> (hard delete) is allowed only for
        orphaned POIs with no tours or roam clips, so it's disabled for everything referenced here.
      </p>
      {actionErr && (
        <Callout variant="error">
          <span className="font-medium">Action failed:</span> {actionErr}
        </Callout>
      )}
      <div className="space-y-2">
        {flagged.map((p) => {
          const tone = p.staleFacts ? 'warning' : 'destructive'
          const label = p.staleFacts ? 'Stale facts' : 'Unattributed'
          const desc = p.staleFacts ? 'factsHash changed — re-fetch, then regenerate the tour' : 'story stop missing CC BY-SA attribution'
          const isOrphan = p.tourCount + p.roamClipCount === 0
          const refetching = refetchMut.isPending && refetchMut.variables === p.id
          const deleting = deleteMut.isPending && deleteMut.variables === p.id
          return (
            <div
              key={p.id}
              className={cn(
                'rounded-xl border px-4 py-3',
                p.staleFacts ? 'border-warning/30 bg-warning/5' : 'border-destructive/30 bg-destructive/5',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <Badge variant={tone}>{label}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <code className="font-mono">{p.sourceId}</code>
                    {p.regionName && <span>{p.regionName}</span>}
                    <span>{desc}</span>
                    {p.roamClipCount > 0 && (
                      <span className="text-warning">
                        {p.roamClipCount} roam clip{p.roamClipCount > 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {p.staleFacts && (
                    <Button variant="outline" size="sm" disabled={refetching} onClick={() => refetchMut.mutate(p.id)}>
                      <RefreshCw className="h-3 w-3" /> {refetching ? 'Re-fetching…' : 'Re-fetch'}
                    </Button>
                  )}
                  <span
                    title={
                      isOrphan
                        ? undefined
                        : 'Referenced by a tour or roam clip — regenerate or correct it instead of deleting.'
                    }
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!isOrphan || deleting}
                      onClick={() => {
                        if (!window.confirm(`Permanently delete "${p.name}"? This removes the POI record.`)) return
                        deleteMut.mutate(p.id)
                      }}
                    >
                      <Trash2 className="h-3 w-3" /> {deleting ? 'Retiring…' : 'Retire'}
                    </Button>
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
