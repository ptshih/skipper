import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleCheck, Compass, Locate, Plus, RefreshCw, Search, Sparkles, Trash2, Wrench, X, Zap } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeletonRows } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { JobActionDialog } from '@/components/ui/job-action-dialog'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

type Tab = 'corpus' | 'retire'

// Keyed to the real poi_source pgEnum (wikipedia | google_places | wikidata) — NOT osm/manual,
// which were never enum members (the corpus is wikipedia + wikidata pins today).
const SOURCE_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  wikipedia: { label: 'Wikipedia', variant: 'default' },
  wikidata: { label: 'Wikidata', variant: 'secondary' },
  google_places: { label: 'Google Places', variant: 'outline' },
}

type BadgeVariant = 'default' | 'secondary' | 'success' | 'warning' | 'outline'

/** Story-eligibility → badge. A POI property (roam draws story-grade POIs from the corpus).
 *  `eligible` is the actionable one; the filtered-* states are intentional exclusions, muted. */
const STORY_ELIGIBILITY_META: Record<StoryEligibility, { label: string; variant: BadgeVariant; hint: string }> = {
  eligible: { label: 'eligible', variant: 'default', hint: 'Story-grade — a roam telling can use it' },
  'filtered-source': { label: 'scenic pin', variant: 'outline', hint: 'Wikidata pin — not a story source (wave layer later)' },
  'filtered-taste': { label: 'taste-gate', variant: 'outline', hint: 'Title hits the taste denylist' },
  'filtered-stub': { label: 'stub', variant: 'secondary', hint: 'No article text to enrich (empty/disambiguation page)' },
}

/** The SEPARATE narration axis — shown as a secondary badge only when a narration exists. */
const NARRATION_META: Record<'fresh' | 'stale', { label: string; variant: BadgeVariant; hint: string }> = {
  fresh: { label: 'narration', variant: 'success', hint: 'Has a narration on current facts' },
  stale: { label: 'narration · stale', variant: 'warning', hint: 'Facts moved — a run would regenerate it' },
}

export function PoisView() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('corpus')
  const [discoverOpen, setDiscoverOpen] = useState(false)
  const [generateOpen, setGenerateOpen] = useState(false)

  // The shared place corpus, fetched once + cached under the ['pois'] key.
  const { data: pois = [], error: err, isPending } = useQuery({ queryKey: ['pois'], queryFn: async () => (await api.pois()).pois })

  const live = pois // no retired field; all pois are live for now
  const flagged = pois.filter((p) => p.staleFacts || p.suspiciousDuration || (!p.attributed && p.narrationCount > 0))

  const tabs: { id: Tab; label: string; count: number; alert?: boolean }[] = [
    { id: 'corpus', label: 'Corpus', count: live.length },
    { id: 'retire', label: 'Retire', count: flagged.length, alert: flagged.length > 0 },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="POIs"
        description="The shared place corpus — sources, narration coverage, attribution, and fact corrections. Roam + drives select from here."
        actions={
          <>
            <Button variant="outline" onClick={() => setDiscoverOpen(true)}>
              <Compass className="h-4 w-4" /> Discover POIs
            </Button>
            <Button onClick={() => setGenerateOpen(true)}>
              <Zap className="h-4 w-4" /> Generate Narration
            </Button>
          </>
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
      <GenerateNarrationDialog open={generateOpen} onOpenChange={setGenerateOpen} onSubmitted={() => navigate({ to: '/runs' })} />
    </div>
  )
}

/* ── DISCOVER POIs ── */

// A focused Preview+apply dialog (shared JobActionDialog shell): pick a region, then Preview (dry-run)
// or Discover (apply). FREE — no LLM/TTS, so no confirm gate (spends={false}). bbox comes from the
// region row's discoveryBbox column — null = use the generator's default.
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
  const bbox = regions.find((r) => r.slug === regionSlug)?.discoveryBbox

  return (
    <JobActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmitted={onSubmitted}
      icon={Compass}
      title="Discover POIs"
      description="Discovers every Wikidata-pinned place in the region and upserts the shared POI corpus — roam draws from it. Free — no LLM or TTS spend."
      buildBody={() => ({ kind: 'discover_pois', ...(bbox ? { bbox } : {}) })}
      spends={false}
      applyLabel="Discover"
      applyIcon={Compass}
      disabled={!regionSlug}
      error={loadErr}
      note={
        <>
          Free preview — no spend, no deletion. <span className="font-medium text-foreground">Preview</span> dry-runs
          the discovery; <span className="font-medium text-foreground">Discover</span> upserts the corpus.
        </>
      }
    >
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
    </JobActionDialog>
  )
}

/* ── GENERATE NARRATION (per-region, spends) ── */

// Region-picker Preview+apply dialog for the corpus `generate_narrations` step: narrates + synthesizes a
// narration for every enriched, story-grade POI in the region. Run after Discover + Enrich. SPENDS
// Anthropic + TTS per narration, so it stays gated (JobActionDialog adds confirm:true on apply — the
// default spends=true). bbox comes from the region row's discoveryBbox; null = the generator default.
function GenerateNarrationDialog({
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
  const bbox = regions.find((r) => r.slug === regionSlug)?.discoveryBbox

  return (
    <JobActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmitted={onSubmitted}
      icon={Zap}
      title="Generate Narration"
      description="Narrates + synthesizes a narration for every enriched, story-grade POI in the region. Run after Discover, then Enrich. Spends Anthropic + TTS credits per narration."
      buildBody={() => ({ kind: 'generate_narrations', ...(bbox ? { bbox } : {}) })}
      applyLabel="Generate Narration"
      applyIcon={Zap}
      disabled={!regionSlug}
      error={loadErr}
      note={
        <>
          <span className="font-medium text-foreground">Preview</span> dry-runs free (no narration or TTS —
          prints the queue + a cost estimate to the run log);{' '}
          <span className="font-medium text-foreground">Generate Narration</span> spends.
        </>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="generate-region">Region</Label>
        <Select value={regionSlug || undefined} onValueChange={setRegionSlug}>
          <SelectTrigger id="generate-region" className="w-full">
            <SelectValue placeholder={regions.length === 0 ? 'Loading…' : 'Select a region…'} />
          </SelectTrigger>
          <SelectContent>
            {regions.map((r) => (
              <SelectItem key={r.slug} value={r.slug}>{r.displayName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </JobActionDialog>
  )
}

/* ── ENRICH (the corpus fact-well step) ── */

/** What to enrich, resolved server-side. Either a hand-picked id list, OR a FILTER (the table's
 *  server-resolvable axes) plus the rows DESELECTED after a "select all matching" — the Gmail model,
 *  so server-side pagination never has to enumerate every id client-side. */
type EnrichSelection =
  | { kind: 'explicit'; ids: string[] }
  | { kind: 'all'; filter: { bbox?: string; source?: string; query?: string }; excludeIds: string[] }

// A focused Preview+apply dialog (shared JobActionDialog shell) for the corpus `enrich` step
// (enrich_pois): acts on the table SELECTION, then Preview (free dry-run — NO model calls, prints the
// count + a cost estimate) or Enrich (apply, SPENDS Anthropic; no TTS). THIS dialog is the paid-run gate:
// it names the scope + cost and needs an explicit Enrich click, so the server's confirm:true (added by
// JobActionDialog for the apply) is already human-gated — no extra window.confirm. The fact sheet it
// builds (pois.fact_sheet) is read by roam, so enrich ONCE between Discover and Generate Narration.
// Enrich only acts on ELIGIBLE story POIs (the CLI gates), so the Preview count is authoritative.
function EnrichDialog({
  open,
  onOpenChange,
  selection,
  summary,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selection: EnrichSelection
  summary: string
  onSubmitted: () => void
}) {
  const buildBody = () => {
    const body: Record<string, unknown> = { kind: 'enrich_pois' }
    if (selection.kind === 'explicit') {
      body.includeIds = selection.ids
    } else {
      if (selection.filter.bbox) body.bbox = selection.filter.bbox
      if (selection.filter.source) body.source = selection.filter.source
      if (selection.filter.query) body.query = selection.filter.query
      if (selection.excludeIds.length) body.excludeIds = selection.excludeIds
    }
    return body
  }

  return (
    <JobActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmitted={onSubmitted}
      icon={Sparkles}
      title="Enrich corpus"
      description={
        <>
          Scouts each story POI ONCE into a curated, verbatim <strong>fact well</strong> on the shared corpus —
          roam narrates from it. Run after Discover, before generating. Spends Anthropic credits
          (no TTS). A re-discover now PRESERVES wells; rebuild one with Enrich after a material article change.
        </>
      }
      buildBody={buildBody}
      applyLabel="Enrich"
      applyIcon={Sparkles}
      note={
        <>
          <span className="font-medium text-foreground">Preview</span> dry-runs free (no model calls — prints the
          count + a cost estimate to the run log); <span className="font-medium text-foreground">Enrich</span> spends.
        </>
      }
    >
      <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
        Enriching <span className="font-medium text-foreground">{summary}</span>.
        <span className="text-muted-foreground"> Only eligible story POIs are enriched — Preview shows the exact count + cost.</span>
      </div>
    </JobActionDialog>
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
        Corrections apply on the <strong className="text-foreground">next generate / regeneration</strong> of a
        narration (the generator loads these overrides + reads the speakable anchor fresh per run). They do{' '}
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

function PoiDetailSheet({ poiId, poiName, canDelete, hasNarration, open, onOpenChange }: {
  poiId: string
  poiName: string
  /** Orphan (no narration) → a hard delete is allowed. Referenced POIs are guarded server-side. */
  canDelete: boolean
  /** Whether a synthesized narration exists for this POI (drives the player vs empty state). */
  hasNarration: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [tab, setTab] = useState<'facts' | 'narration' | 'corrections'>('facts')
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
      <SheetContent side="right" className="flex w-[720px] max-w-full flex-col gap-0 p-0 sm:max-w-[720px]">
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
          {(['facts', 'narration', 'corrections'] as const).map((t) => (
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

          {tab === 'narration' && <NarrationTab poiId={poiId} hasNarration={hasNarration} />}

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
                onClick={async () => {
                  if (!(await confirm({
                    title: 'Delete POI?',
                    body: `Permanently delete “${poiName}”. This removes the POI record.`,
                    confirmLabel: 'Delete',
                    tone: 'destructive',
                  }))) return
                  deleteMut.mutate()
                }}
              >
                <Trash2 className="h-4 w-4" /> {deleteMut.isPending ? 'Deleting…' : 'Delete POI'}
              </Button>
              <span className="text-xs text-muted-foreground">No narration references this POI.</span>
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

/* ── NARRATION (player + re-synth) ── */

// The POI's one shared telling — audio player + script + a re-synth action. Moved here from the
// retired /roam page; a narration is 1:1 with its poi (resolves via poiId), so it lives in the POI.
function NarrationTab({ poiId, hasNarration }: { poiId: string; hasNarration: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()

  const { data: clip, isLoading, error } = useQuery({
    queryKey: ['poiNarration', poiId],
    queryFn: async () => (await api.poiNarration(poiId)).narration,
    enabled: hasNarration,
  })

  const resynthMut = useMutation({
    mutationFn: () => api.createJob({ kind: 'resynth_roam_clip', poiId, apply: true, confirm: true }),
    onSuccess: ({ job }) => { void qc.invalidateQueries({ queryKey: ['runs'] }); navigate({ to: '/runs', hash: job.id }) },
  })
  async function handleResynth() {
    if (!(await confirm({
      title: 'Re-synthesize narration?',
      body: 'Spends ~$0.01 in TTS credits and replaces this POI’s current narration audio.',
      confirmLabel: 'Re-synth',
    }))) return
    resynthMut.mutate()
  }

  if (!hasNarration) {
    return (
      <EmptyState icon={Zap} className="rounded-xl border bg-muted/30">
        No narration yet — enrich this POI, then Generate Narration for its region.
      </EmptyState>
    )
  }
  if (isLoading) return <div className="py-2 text-xs text-muted-foreground">Loading…</div>
  if (error) return <div className="py-2 text-xs text-destructive">{errMsg(error)}</div>
  if (!clip) return null

  const durationSec = Math.round(clip.audioDurationMs / 1000)
  const mins = Math.floor(durationSec / 60)
  const secs = durationSec % 60
  const durLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  const wordCount = clip.script?.trim().split(/\s+/).filter(Boolean).length ?? 0
  const wpm = wordCount > 0 ? Math.round(wordCount / (clip.audioDurationMs / 1000 / 60)) : 0
  const suspicious = wpm > 0 && wpm < 90

  return (
    <div className="flex flex-col gap-2 pt-1">
      <audio controls preload="none" src={clip.url} className="h-9 w-full" />
      <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
        <span className="font-mono">{durLabel}</span>
        {wpm > 0 && (
          <span className={cn('font-mono', suspicious && 'text-destructive')}>
            {wpm} wpm{suspicious ? ' ⚠ suspicious' : ''}
          </span>
        )}
        {clip.factsHash && <code className="font-mono">{clip.factsHash.slice(0, 7)}</code>}
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => void handleResynth()} disabled={resynthMut.isPending}>
          <RefreshCw className="h-3 w-3" />
          {resynthMut.isPending ? 'Queuing…' : 'Re-synth'}
        </Button>
      </div>
      {resynthMut.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Re-synth failed — {errMsg(resynthMut.error)}
        </div>
      )}
      {suspicious && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Narration duration ({durLabel} for {wordCount} words) looks like a TTS duplicate-audio defect. Re-synth to fix.
        </div>
      )}
      <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{clip.script}</div>
    </div>
  )
}

/* ── CORPUS ── */

function CorpusTab({ pois, loading }: { pois: PoiRow[]; loading: boolean }) {
  const [q, setQ] = useState('')
  const [region, setRegion] = useState('all')
  const [source, setSource] = useState('all')
  const [flags, setFlags] = useState('all')
  const [sheetPoi, setSheetPoi] = useState<{ id: string; name: string; canDelete: boolean; hasNarration: boolean } | null>(null)

  // Gmail-style selection: in 'explicit' mode `selIds` are the CHOSEN rows; in 'all' mode every filtered
  // row is chosen EXCEPT `selIds` (the deselected). Lets "select all matching" send a server-side FILTER
  // (pagination-proof) rather than enumerating every id, while still supporting hand-picks + unchecking.
  const [selMode, setSelMode] = useState<'explicit' | 'all'>('explicit')
  const [selIds, setSelIds] = useState<Set<string>>(new Set())
  const [enrichOpen, setEnrichOpen] = useState(false)
  const navigate = useNavigate()
  // Region defs carry discoveryBbox, so "select all matching" can send a region as a server-side bbox
  // filter. Shared ['regions'] cache; the `regions` list below is just slug+name for the filter dropdown.
  const { data: regionDefs = [] } = useQuery({ queryKey: ['regions'], queryFn: async () => (await api.regions()).regions })

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
    if (flags === 'unattrib' && (p.attributed || p.narrationCount === 0)) return false
    if (flags === 'story-eligible' && p.storyEligibility !== 'eligible') return false
    if (flags === 'story-filtered' && !p.storyEligibility.startsWith('filtered-')) return false
    if (flags === 'enriched' && !p.enriched) return false
    // The actionable gap: story-grade but no fact well yet — exactly the rows an Enrich run will bill for.
    if (flags === 'needs-enrich' && (p.storyEligibility !== 'eligible' || p.enriched)) return false
    if (flags === 'narration-stale' && p.narrationStatus !== 'stale') return false
    if (flags === 'sheet-drift' && !p.sheetDrift) return false
    if (q) {
      const s = `${p.name} ${p.sourceId}`.toLowerCase()
      if (!s.includes(q.toLowerCase())) return false
    }
    return true
  }), [pois, region, source, flags, q])

  const isSelected = (id: string) => (selMode === 'all' ? !selIds.has(id) : selIds.has(id))
  const numSelected = useMemo(
    () => filtered.reduce((n, p) => n + ((selMode === 'all' ? !selIds.has(p.id) : selIds.has(p.id)) ? 1 : 0), 0),
    [filtered, selMode, selIds],
  )
  // The ENRICH-relevant count: the server only enriches (+bills for) story-eligible rows, so the headline
  // number must reflect that, not the raw selection (which can include scenic/wikidata pins the gate drops).
  const numEligibleSelected = useMemo(
    () =>
      filtered.reduce(
        (n, p) => n + ((selMode === 'all' ? !selIds.has(p.id) : selIds.has(p.id)) && p.storyEligibility === 'eligible' ? 1 : 0),
        0,
      ),
    [filtered, selMode, selIds],
  )
  const headerChecked = filtered.length > 0 && numSelected === filtered.length
  const headerIndeterminate = numSelected > 0 && numSelected < filtered.length

  function toggleRow(id: string) {
    setSelIds((prev) => {
      const next = new Set(prev) // membership = the EXCEPTION to the mode (chosen in explicit, deselected in all)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    // Any selection → clear; nothing selected → "select all matching".
    setSelMode(numSelected > 0 ? 'explicit' : 'all')
    setSelIds(new Set())
  }
  function clearSel() {
    setSelMode('explicit')
    setSelIds(new Set())
  }

  // Resolve the selection into the enrich job's contract. 'all' mode prefers a server-side FILTER
  // (pagination-proof) when the active table filter is faithfully resolvable (region→bbox, source,
  // query); a hygiene `flags` view or a region without a bbox can't be reproduced server-side, so it
  // falls back to enumerating the visible ids (exact, client-side — fine at today's corpus size).
  function buildSelection(): EnrichSelection {
    if (selMode === 'explicit') return { kind: 'explicit', ids: [...selIds] }
    const bbox = region !== 'all' ? regionDefs.find((r) => r.slug === region)?.discoveryBbox ?? null : null
    const resolvable = (flags === 'all' || flags === 'story-eligible') && (region === 'all' || !!bbox)
    if (resolvable) {
      return {
        kind: 'all',
        filter: { bbox: bbox ?? undefined, source: source !== 'all' ? source : undefined, query: q || undefined },
        excludeIds: [...selIds],
      }
    }
    return { kind: 'explicit', ids: filtered.filter((p) => isSelected(p.id)).map((p) => p.id) }
  }
  const selectionSummary =
    (selMode === 'explicit'
      ? `${selIds.size} hand-picked POI${selIds.size === 1 ? '' : 's'}`
      : `all ${numSelected} POIs matching this filter${selIds.size ? ` (minus ${selIds.size} deselected)` : ''}`) +
    ` — ${numEligibleSelected} story-eligible`

  const totals = {
    total: pois.length,
    withClips: pois.filter((p) => p.narrationCount > 0).length,
    eligible: pois.filter((p) => p.storyEligibility === 'eligible').length,
    enriched: pois.filter((p) => p.enriched).length,
    // Attribution applies to STORY narrations (CC BY-SA): an unattributed narration is one that exists.
    unattrib: pois.filter((p) => !p.attributed && p.narrationCount > 0).length,
    defects: pois.filter((p) => p.suspiciousDuration).length,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{totals.total} total</Badge>
        <Badge>{totals.withClips} with narrations</Badge>
        {totals.eligible > 0 && (
          <button onClick={() => setFlags('story-eligible')}>
            <Badge variant="default" className="cursor-pointer">{totals.eligible} story-eligible</Badge>
          </button>
        )}
        {totals.eligible > 0 && (
          <button onClick={() => setFlags(totals.enriched < totals.eligible ? 'needs-enrich' : 'enriched')}>
            <Badge variant={totals.enriched > 0 ? 'success' : 'outline'} className="cursor-pointer">
              {totals.enriched}/{totals.eligible} enriched
            </Badge>
          </button>
        )}
        {totals.unattrib > 0 && <Badge variant="destructive">{totals.unattrib} unattributed</Badge>}
        {totals.defects > 0 && (
          <button onClick={() => setFlags('defect')}>
            <Badge variant="destructive" className="cursor-pointer">
              {totals.defects} narration defect{totals.defects > 1 ? 's' : ''}
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
            <SelectItem value="wikipedia">Wikipedia</SelectItem>
            <SelectItem value="wikidata">Wikidata</SelectItem>
            <SelectItem value="google_places">Google Places</SelectItem>
          </SelectContent>
        </Select>
        <Select value={flags} onValueChange={setFlags}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All flags</SelectItem>
            <SelectItem value="story-eligible">Story: eligible</SelectItem>
            <SelectItem value="story-filtered">Story: filtered out</SelectItem>
            <SelectItem value="enriched">Enriched</SelectItem>
            <SelectItem value="needs-enrich">Eligible · un-enriched</SelectItem>
            <SelectItem value="roam-clip-stale">Narration: stale</SelectItem>
            <SelectItem value="sheet-drift">Story: sheet drifted</SelectItem>
            <SelectItem value="defect">Narration defects</SelectItem>
            <SelectItem value="stale">Stale facts</SelectItem>
            <SelectItem value="unattrib">Unattributed</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {pois.length}</span>
      </div>

      {numSelected > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{selectionSummary}</span>
          <Button size="sm" onClick={() => setEnrichOpen(true)}>
            <Sparkles className="h-4 w-4" /> Enrich {numEligibleSelected}
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
                  checked={headerChecked}
                  indeterminate={headerIndeterminate}
                  onCheckedChange={toggleAll}
                  aria-label="Select all"
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Region</TableHead>
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
                    className={cn('cursor-pointer', isSelected(p.id) && 'bg-muted/40')}
                    onClick={() => setSheetPoi({ id: p.id, name: p.name, canDelete: p.narrationCount === 0, hasNarration: p.narrationCount > 0 })}
                  >
                    <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected(p.id)}
                        onCheckedChange={() => toggleRow(p.id)}
                        aria-label={`Select ${p.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="font-medium hover:underline">{p.name}</span>
                      {(p.staleFacts || p.suspiciousDuration) && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {p.staleFacts && <Badge variant="warning">stale facts</Badge>}
                          {p.suspiciousDuration && <Badge variant="destructive">narration defect</Badge>}
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
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge variant={em.variant} title={em.hint}>{em.label}</Badge>
                        {p.enriched && !p.sheetDrift && (
                          <Badge variant="success" title="Has a curated fact sheet — roam grounds on it">
                            enriched
                          </Badge>
                        )}
                        {p.sheetDrift && (
                          <Badge
                            variant="warning"
                            title="Article drifted — a curated sheet span no longer appears in the current article. Re-enrich (enrich --force) to pick up the change."
                          >
                            sheet drift
                          </Badge>
                        )}
                        {p.narrationStatus !== 'none' && (
                          <Badge variant={NARRATION_META[p.narrationStatus].variant} title={NARRATION_META[p.narrationStatus].hint}>
                            {NARRATION_META[p.narrationStatus].label}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {p.narrationCount > 0 ? (
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
                <TableCell colSpan={9}>
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
          hasNarration={sheetPoi.hasNarration}
          open={!!sheetPoi}
          onOpenChange={(o) => { if (!o) setSheetPoi(null) }}
        />
      )}

      <EnrichDialog
        open={enrichOpen}
        onOpenChange={setEnrichOpen}
        selection={buildSelection()}
        summary={selectionSummary}
        onSubmitted={() => { clearSel(); navigate({ to: '/runs' }) }}
      />
    </div>
  )
}

/* ── RETIRE ── */

function RetireTab({ flagged }: { flagged: PoiRow[] }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [actionErr, setActionErr] = useState<string | null>(null)

  // Re-fetch is a FREE cloud job (MediaWiki only, no LLM/TTS) — fire it, then jump to Runs to watch.
  const refetchMut = useMutation({
    mutationFn: (poiId: string) => api.createJob({ kind: 'refetch_facts', poiId, apply: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['runs'] }); navigate({ to: '/runs' }) },
    onError: (e) => setActionErr(errMsg(e)),
  })
  // Retire is a hard DELETE, allowed ONLY for orphaned POIs (no narration) — the server guards it too.
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
        they change, regenerate the narration to clear the staleness. Unattributed story narrations violate CC BY-SA and
        need a regenerate. <strong className="text-foreground">Retire</strong> (hard delete) is allowed only for
        orphaned POIs with no narration, so it's disabled for everything referenced here.
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
          const desc = p.staleFacts ? 'factsHash changed — re-fetch, then regenerate the narration' : 'story narration missing CC BY-SA attribution'
          const isOrphan = p.narrationCount === 0
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
                    {p.narrationCount > 0 && (
                      <span className="text-warning">
                        {p.narrationCount} narration{p.narrationCount > 1 ? 's' : ''}
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
                        : 'Has a narration — regenerate or correct it instead of deleting.'
                    }
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!isOrphan || deleting}
                      onClick={async () => {
                        if (!(await confirm({
                          title: 'Retire POI?',
                          body: `Permanently delete “${p.name}”. This removes the POI record.`,
                          confirmLabel: 'Retire',
                          tone: 'destructive',
                        }))) return
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
