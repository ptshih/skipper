import { Fragment, useEffect, useMemo, useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, CircleCheck, Locate, Plus, RefreshCw, Rocket, Search, Sparkles, Trash2, Wrench, X, Zap } from 'lucide-react'
import { api, ApiError, type CorrectionOverride, type PoiDetail, type PoiRow, type StoryEligibility } from '@/lib/api'
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
import { Checkbox } from '@/components/ui/checkbox'
import { AnchorMap } from '@/components/ui/leaflet-map'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton, TableSkeletonRows } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { JobActionDialog } from '@/components/ui/job-action-dialog'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

// Keyed to the real poi_source pgEnum (wikipedia | wikidata) — the corpus is Wikidata-spine ONLY
// (every poi has a QID). Google break anchors are NOT pois — they live in the `places` table.
const SOURCE_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  wikipedia: { label: 'Wikipedia', variant: 'default' },
  wikidata: { label: 'Wikidata', variant: 'secondary' },
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

const poisRoute = getRouteApi('/pois')

export function PoisView() {
  const search = poisRoute.useSearch()

  // The shared place corpus, fetched once + cached under the ['pois'] key.
  const { data: pois = [], error: err, isPending } = useQuery({ queryKey: ['pois'], queryFn: async () => (await api.pois()).pois })

  return (
    <div className="space-y-6">
      <PageHeader
        title="POIs"
        description="The shared place corpus — sources, narration coverage, attribution, and fact corrections. Roam + drives select from here. Discover new POIs from the Regions page."
      />

      {err && (
        <Callout variant="error">
          <span className="font-medium">Error loading POIs:</span> {errMsg(err)}
        </Callout>
      )}

      <CorpusTab pois={pois} loading={isPending} openPoiId={search.poi} />
    </div>
  )
}

/* ── Shared corpus-action scope (the table selection + active filters) ── */

/** The resolved selection + the active filters, for the confirm dialog's "exactly what will run" readout
 *  and the createJob body. `selection` is the EnrichSelection union (defined below). */
interface ScopeDescriptor {
  selection: EnrichSelection
  summary: string
  chips: { label: string; value: string }[]
}

// The confirm-dialog scope readout: WHAT a run targets — the selection headline + the active filter
// chips — so a spend can never run on a scope the operator can't see. Shown atop every action dialog.
function ScopeSummary({ scope }: { scope: ScopeDescriptor }) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
      <div className="font-medium text-foreground">{scope.summary}</div>
      {scope.chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {scope.chips.map((c) => (
            <Badge key={c.label} variant="secondary" className="font-normal">
              <span className="text-muted-foreground">{c.label}:</span>&nbsp;{c.value}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

/** Map a selection onto the createJob body fields a kind that takes region/query/includeIds/excludeIds
 *  understands (generate_narrations, offline_audit). enrich also takes `source`, added by its builder. */
function scopeBody(sel: EnrichSelection): Record<string, unknown> {
  if (sel.kind === 'explicit') return { includeIds: sel.ids }
  const body: Record<string, unknown> = {}
  if (sel.filter.region) body.region = sel.filter.region
  if (sel.filter.query) body.query = sel.filter.query
  if (sel.excludeIds.length) body.excludeIds = sel.excludeIds
  return body
}

/* ── NARRATE (generate_narrations — re-script + re-synth, spends) ── */

// Narrates + synthesizes a narration for every enriched, story-grade POI in the SELECTION. SPENDS
// Anthropic + TTS per narration (gated — JobActionDialog adds confirm:true on apply). `force` re-generates
// places that already have a narration (e.g. to fix a defect); without it, already-narrated places skip.
function NarrateDialog({ open, onOpenChange, scope, onSubmitted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ScopeDescriptor
  onSubmitted: () => void
}) {
  const [force, setForce] = useState(false)
  return (
    <JobActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmitted={onSubmitted}
      icon={Zap}
      title="Generate narration"
      description="Narrates + synthesizes a narration for every enriched, story-grade POI in the selection. Run after Discover, then Enrich. Spends Anthropic + TTS credits per narration."
      buildBody={() => ({ kind: 'generate_narrations', ...scopeBody(scope.selection), ...(force ? { force: true } : {}) })}
      applyLabel="Generate"
      applyIcon={Zap}
      note={
        <>
          <span className="font-medium text-foreground">Preview</span> dry-runs free (no narration or TTS —
          prints the queue + a cost estimate); <span className="font-medium text-foreground">Generate</span> spends.
        </>
      }
    >
      <ScopeSummary scope={scope} />
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <Checkbox checked={force} onCheckedChange={setForce} aria-label="Re-generate existing narrations" />
        <span>
          <span className="font-medium text-foreground">Re-generate existing</span> — overwrite places that
          already have a narration (use this to fix a defect). Off = skip already-narrated places.
        </span>
      </label>
    </JobActionDialog>
  )
}

/* ── RE-SCORE CORPUS (offline_audit — read-only quality read on existing narrations) ── */

// Re-score the EXISTING narration corpus without regenerating: scores each region story narration's
// stored script for grounding (Opus) + tts + diversity and records an offline_audit eval_run, viewable
// in the Runs report drawer. READ-ONLY on narrations/R2; --apply spends one Opus grounding call per clip
// (gated like the other paid dialogs); the Preview is a free count + estimate.
function RescoreDialog({ open, onOpenChange, scope, onSubmitted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ScopeDescriptor
  onSubmitted: () => void
}) {
  const [charm, setCharm] = useState(false)
  const [veracity, setVeracity] = useState(false)
  return (
    <JobActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmitted={onSubmitted}
      icon={Activity}
      title="Re-score corpus"
      description="Re-scores the selection's EXISTING story narrations (grounding, tts-cleanliness, diversity; charm + veracity opt-in) WITHOUT regenerating or re-synthesizing — a quality read on what's already shipped. Records an offline_audit run, viewable in the Runs report."
      buildBody={() => ({ kind: 'offline_audit', ...scopeBody(scope.selection), ...(charm ? { charm: true } : {}), ...(veracity ? { veracity: true } : {}) })}
      applyLabel="Re-score"
      applyIcon={Activity}
      note={
        <>
          <span className="font-medium text-foreground">Preview</span> is free (counts the narrations +
          estimates the grounding spend); <span className="font-medium text-foreground">Re-score</span> spends
          one Opus call per clip. Read-only — it never changes a narration.
        </>
      }
    >
      <ScopeSummary scope={scope} />

      <div className="space-y-2">
        <Label>Advisory judges (Opus, opt-in)</Label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={charm} onCheckedChange={setCharm} aria-label="Score charm" />
          <span><span className="font-medium text-foreground">Charm</span> — one Opus call over the batch (cheap). Persona &amp; delivery quality.</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={veracity} onCheckedChange={setVeracity} aria-label="Score veracity" />
          <span><span className="font-medium text-foreground">Veracity</span> — web-checks each story's claims (Opus + search, <span className="text-foreground">per clip — pricier</span>).</span>
        </label>
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
  | { kind: 'all'; filter: { region?: string; source?: string; query?: string }; excludeIds: string[] }

// A focused Preview+apply dialog (shared JobActionDialog shell) for the corpus `enrich` step
// (enrich_pois): acts on the table SELECTION, then Preview (free dry-run — NO model calls, prints the
// count + a cost estimate) or Enrich (apply, SPENDS Anthropic; no TTS). THIS dialog is the paid-run gate:
// it names the scope + cost and needs an explicit Enrich click, so the server's confirm:true (added by
// JobActionDialog for the apply) is already human-gated — no extra window.confirm. The fact sheet it
// builds (pois.fact_sheet) is read by roam, so enrich ONCE between Discover and Generate Narration.
// Enrich only acts on ELIGIBLE story POIs (the CLI gates), so the Preview count is authoritative.
function EnrichDialog({ open, onOpenChange, scope, onSubmitted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ScopeDescriptor
  onSubmitted: () => void
}) {
  // Advanced (collapsed): the model tier A/B + a smoke-test cap. The studio CLI defaults to sonnet
  // (only the literal 'opus' selects opus); `limit` caps how many places enrich. Server forwards both.
  const [advanced, setAdvanced] = useState(false)
  const [model, setModel] = useState<'sonnet' | 'opus'>('sonnet')
  const [limit, setLimit] = useState('')

  const buildBody = () => {
    const sel = scope.selection
    const body: Record<string, unknown> = { kind: 'enrich_pois', ...scopeBody(sel) }
    // enrich is the one kind that also filters by source (story is wikipedia-only anyway).
    if (sel.kind === 'all' && sel.filter.source) body.source = sel.filter.source
    if (model !== 'sonnet') body.model = model // sonnet is the CLI default — only send a non-default override
    const n = Number(limit)
    if (limit.trim() && Number.isFinite(n) && n > 0) body.limit = Math.floor(n)
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
      <ScopeSummary scope={scope} />
      <p className="text-xs text-muted-foreground">Only eligible story POIs are enriched — Preview shows the exact count + cost.</p>

      <div className="space-y-2">
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? '▾' : '▸'} Advanced
        </button>
        {advanced && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-dashed px-3 py-3">
            <div className="space-y-1.5">
              <Label htmlFor="enrich-model" className="text-xs">Model</Label>
              <Select value={model} onValueChange={(v) => setModel(v as 'sonnet' | 'opus')}>
                <SelectTrigger id="enrich-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sonnet">Sonnet (default)</SelectItem>
                  <SelectItem value="opus">Opus (calibration A/B)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enrich-limit" className="text-xs">Smoke-test first N</Label>
              <Input
                id="enrich-limit"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                placeholder="all eligible"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </JobActionDialog>
  )
}

/* ── CORRECTIONS ── */

// Operator surface for a POI's upstream-fact corrections + speakable anchor. Lazy-loads on
// expand. Corrections take effect on the NEXT generate/regeneration — they don't rewrite audio.
function Corrections({ poiId, poiLat, poiLng }: { poiId: string; poiLat?: number; poiLng?: number }) {
  const qc = useQueryClient()
  const confirm = useConfirm()
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

  // The draggable marker must reflect the PENDING edit (the lat/lng inputs), not the saved anchor —
  // otherwise dragging it fires onAnchor (which only fills the inputs) while the controlled marker
  // snaps back to the unchanged saved position. Drag → fills inputs → inputs drive the marker. Empty
  // or non-numeric inputs fall back to the saved speakable anchor, then to the POI pin.
  const latNum = Number(lat), lngNum = Number(lng)
  const pendingAnchor =
    lat.trim() !== '' && lng.trim() !== '' && Number.isFinite(latNum) && Number.isFinite(lngNum)
      ? { lat: latNum, lng: lngNum }
      : null

  // One shared submit path for every correction action. The buttons only disable AFTER the first
  // mutate re-renders, so guard at the top here — a fast double-tap can't double-submit.
  const save = (...args: Parameters<typeof saveMut.mutate>) => {
    if (saving) return
    saveMut.mutate(...args)
  }

  function addCorrection() {
    if (!find.trim() || !reason.trim()) {
      setValidationErr('A find string and a reason are both required.')
      return
    }
    save(
      { kind: 'fact_edit', find, replace, reason: reason.trim(), ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) },
      { onSuccess: () => { setFind(''); setReplace(''); setReason(''); setSourceUrl('') } },
    )
  }

  function retire(f: string) {
    save({ kind: 'retire', find: f })
  }

  async function setSpeakable() {
    if (saving) return
    const la = Number(lat), ln = Number(lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln) || lat.trim() === '' || lng.trim() === '') {
      setValidationErr('Speakable anchor needs two numeric coordinates.')
      return
    }
    setValidationErr(null)
    try {
      await saveMut.mutateAsync({ kind: 'speakable', lat: la, lng: ln })
      setLat(''); setLng('')
    } catch (e) {
      // The server rejects an anchor that's implausibly far from the pin (likely a typo). Offer to
      // override for the rare genuinely-distant vantage; any other error stays surfaced via `err`.
      if (e instanceof ApiError && e.code === 'speakable_too_far') {
        const ok = await confirm({
          title: 'Anchor looks far from the pin',
          body: `${e.message} Set it anyway?`,
          confirmLabel: 'Set anyway',
        })
        // Declining is a handled choice, not a failure — clear the rejected mutation so the error
        // banner doesn't keep showing the (intentional) "too far" message behind the dismissed dialog.
        if (!ok) {
          saveMut.reset()
          return
        }
        try {
          await saveMut.mutateAsync({ kind: 'speakable', lat: la, lng: ln, force: true })
          setLat(''); setLng('')
        } catch { /* surfaced via saveMut.error → err */ }
      }
    }
  }

  function clearSpeakable() {
    save({ kind: 'speakable', lat: null })
  }

  // Discard the in-progress edit (a drag or typed coords) and revert the marker to the saved anchor
  // (or the POI pin if none) — does NOT touch the saved speakable anchor. "Clear" above removes that.
  function resetAnchor() {
    setLat('')
    setLng('')
    setValidationErr(null)
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4 pt-3" aria-hidden>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-12 w-full rounded-md" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
        <Skeleton className="h-28 w-full rounded-md" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Wrench className="h-3.5 w-3.5" /> Corrections
      </div>
      <div className="rounded-md border bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Corrections apply on the <strong className="text-foreground">next generate / regeneration</strong> of a
        narration (the studio job loads these overrides + reads the speakable anchor fresh per run). They do{' '}
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
          Drag the amber marker to set it; the coords fill below, then hit Set anchor.
        </div>
        {poiLat != null && poiLng != null && (
          <AnchorMap
            poi={{ lat: poiLat, lng: poiLng }}
            anchor={pendingAnchor ?? data?.speakable ?? null}
            onAnchor={({ lat: a, lng: o }) => { setLat(a.toFixed(6)); setLng(o.toFixed(6)) }}
          />
        )}
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
          <Button
            variant="ghost"
            size="sm"
            disabled={saving || (lat.trim() === '' && lng.trim() === '')}
            onClick={resetAnchor}
          >
            <RefreshCw className="h-3 w-3" /> Reset
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
            detail ? <FactsTab poi={detail} /> : !err && (
              <div className="space-y-4" aria-hidden>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="space-y-1.5">
                      <Skeleton className="h-3 w-20" />
                      <Skeleton className="h-4 w-32" />
                    </div>
                  ))}
                </div>
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-32 w-full rounded-lg" />
              </div>
            )
          )}

          {tab === 'narration' && <NarrationTab poiId={poiId} hasNarration={hasNarration} />}

          {tab === 'corrections' && <Corrections poiId={poiId} poiLat={detail?.lat} poiLng={detail?.lng} />}
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
  const qc = useQueryClient()
  const navigate = useNavigate()
  // Re-fetch facts = a FREE cloud job (MediaWiki only, no LLM/TTS) — re-pulls the article, then jumps to
  // Runs to watch. If the article moved, the facts hash changes + any narration goes stale (clear it from
  // the Narration tab). This is the per-POI home of what the old Retire tab did; staleness still surfaces
  // as a row flag + the corpus "Needs attention" filter, which points the operator here.
  const refetchMut = useMutation({
    mutationFn: () => api.createJob({ kind: 'refetch_facts', poiId: poi.id, apply: true }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['runs'] }); navigate({ to: '/runs' }) },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Re-pulls this POI’s facts from Wikipedia — <span className="font-medium text-foreground">free</span> (no AI or
          TTS). If the article moved, the facts hash changes and any narration goes stale; regenerate it from the
          Narration tab to clear that.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={refetchMut.isPending}
          onClick={() => refetchMut.mutate()}
          className="shrink-0"
        >
          <RefreshCw className="h-3 w-3" /> {refetchMut.isPending ? 'Re-fetching…' : 'Re-fetch facts'}
        </Button>
      </div>
      {refetchMut.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Re-fetch failed — {errMsg(refetchMut.error)}
        </div>
      )}

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
    mutationFn: () => api.createJob({ kind: 'resynth_narration', poiId, apply: true, confirm: true }),
    onSuccess: ({ job }) => { void qc.invalidateQueries({ queryKey: ['runs'] }); navigate({ to: '/runs', search: { run: job.id } }) },
  })
  async function handleResynth() {
    if (!(await confirm({
      title: 'Re-synthesize narration?',
      body: 'Spends ~$0.01 in TTS credits and replaces this POI’s current narration audio.',
      confirmLabel: 'Re-synth',
    }))) return
    resynthMut.mutate()
  }

  // Regenerate = re-NARRATE this one POI from its current facts + corrections (a fresh script), then
  // re-score + re-synthesize — the single-POI form of generate_narrations (include-ids implies --force).
  // Closes the ear-pass → fix-a-fact → re-hear loop without re-running the whole region. Spends Anthropic + TTS.
  const regenMut = useMutation({
    mutationFn: () =>
      api.createJob({ kind: 'generate_narrations', includeIds: [poiId], force: true, apply: true, confirm: true }),
    onSuccess: ({ job }) => { void qc.invalidateQueries({ queryKey: ['runs'] }); navigate({ to: '/runs', search: { run: job.id } }) },
  })
  async function handleRegenerate() {
    if (!(await confirm({
      title: 'Regenerate narration?',
      body: 'Re-narrates this POI from its CURRENT facts + corrections (a fresh script), then re-scores and re-synthesizes. Spends Anthropic + TTS credits. Use this after a fact-edit; Re-synth only re-voices the existing script.',
      confirmLabel: 'Regenerate',
    }))) return
    regenMut.mutate()
  }

  // region-release-gate: release THIS staged clip to the public (the trickle case — a freshly
  // ear-checked clip inside an already-open region). IRREVERSIBLE; never un-releases.
  const releaseMut = useMutation({
    mutationFn: () => api.releaseNarration(poiId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['poiNarration', poiId] })
      void qc.invalidateQueries({ queryKey: ['pois'] })
    },
  })
  async function handleRelease() {
    if (!(await confirm({
      title: 'Release this clip to the public?',
      body: 'Makes this narration publicly playable in roam + drives. Releasing is permanent — a clip can never be un-released (it would orphan saved drives and break offline downloads). Make sure you’ve heard it.',
      confirmLabel: 'Release clip',
      tone: 'destructive',
    }))) return
    releaseMut.mutate()
  }

  if (!hasNarration) {
    return (
      <EmptyState icon={Zap} className="rounded-xl border bg-muted/30">
        No narration yet — enrich this POI, then Generate Narration for its region.
      </EmptyState>
    )
  }
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 pt-1" aria-hidden>
        <Skeleton className="h-9 w-full rounded-md" />
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-14" />
        </div>
        <Skeleton className="h-24 w-full rounded-md" />
      </div>
    )
  }
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
        {clip.releasedAt ? (
          <Badge variant="success" title={`Released ${new Date(clip.releasedAt).toLocaleString()}`}>
            <CircleCheck className="h-3 w-3" /> Released
          </Badge>
        ) : (
          <Badge variant="warning" title="Staged — heard by testers in-app, not yet public. Release to publish.">
            Staged
          </Badge>
        )}
        <span className="flex-1" />
        {!clip.releasedAt && (
          <Button variant="default" size="sm" onClick={() => void handleRelease()} disabled={releaseMut.isPending}>
            <Rocket className="h-3 w-3" />
            {releaseMut.isPending ? 'Releasing…' : 'Release'}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={() => void handleRegenerate()} disabled={regenMut.isPending || resynthMut.isPending}>
          <Zap className="h-3 w-3" />
          {regenMut.isPending ? 'Queuing…' : 'Regenerate'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => void handleResynth()} disabled={resynthMut.isPending || regenMut.isPending}>
          <RefreshCw className="h-3 w-3" />
          {resynthMut.isPending ? 'Queuing…' : 'Re-synth'}
        </Button>
      </div>
      {releaseMut.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Release failed — {errMsg(releaseMut.error)}
        </div>
      )}
      {resynthMut.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Re-synth failed — {errMsg(resynthMut.error)}
        </div>
      )}
      {regenMut.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Regenerate failed — {errMsg(regenMut.error)}
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

function CorpusTab({ pois, loading, openPoiId }: { pois: PoiRow[]; loading: boolean; openPoiId?: string }) {
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
  const [narrateOpen, setNarrateOpen] = useState(false)
  const [rescoreOpen, setRescoreOpen] = useState(false)
  const navigate = useNavigate()
  // "Select all matching" sends the region SLUG; the CLI resolves it to a server-side bbox filter
  // (geometry-first). Shared ['regions'] cache; the `regions` list below is just slug+name for the dropdown.
  const { data: regionDefs = [] } = useQuery({ queryKey: ['regions'], queryFn: async () => (await api.regions()).regions })

  // Deep-link: ?poi=<id> opens that POI's detail sheet once the cached list resolves, then strips the param.
  useEffect(() => {
    if (!openPoiId) return
    const p = pois.find((x) => x.id === openPoiId)
    if (!p) return // not loaded yet / unknown id — the effect re-runs when `pois` arrives
    setSheetPoi({ id: p.id, name: p.name, canDelete: p.narrationCount === 0, hasNarration: p.narrationCount > 0 })
    navigate({ to: '/pois', search: (prev) => ({ ...prev, poi: undefined }), replace: true })
  }, [openPoiId, pois, navigate])

  const regions = useMemo(() => {
    const seen = new Set<string>()
    return pois
      .filter((p) => p.regionSlug && (seen.has(p.regionSlug) ? false : (seen.add(p.regionSlug), true)))
      .map((p) => ({ slug: p.regionSlug!, name: p.regionName ?? p.regionSlug! }))
  }, [pois])

  const filtered = useMemo(() => pois.filter((p) => {
    if (region !== 'all' && p.regionSlug !== region) return false
    if (source !== 'all' && p.source !== source) return false
    // The combined remediation queue (the old "Retire" tab): any POI needing attention — stale facts, a
    // narration defect, an unattributed story clip, or a drifted speakable anchor. Fix each from its row's
    // detail sheet (Re-fetch facts / Regenerate / Corrections / Delete).
    if (flags === 'flagged' && !(p.staleFacts || p.suspiciousDuration || (!p.attributed && p.narrationCount > 0) || p.speakableDrift)) return false
    if (flags === 'defect' && !p.suspiciousDuration) return false
    if (flags === 'stale' && !p.staleFacts) return false
    if (flags === 'unattrib' && (p.attributed || p.narrationCount === 0)) return false
    if (flags === 'story-eligible' && p.storyEligibility !== 'eligible') return false
    if (flags === 'story-filtered' && !p.storyEligibility.startsWith('filtered-')) return false
    if (flags === 'enriched' && !p.enriched) return false
    // The actionable gap: story-grade but no fact well yet — exactly the rows an Enrich run will bill for.
    if (flags === 'needs-enrich' && (p.storyEligibility !== 'eligible' || p.enriched)) return false
    if (flags === 'narrated' && p.narrationCount === 0) return false
    if (flags === 'narration-stale' && p.narrationStatus !== 'stale') return false
    // region-release-gate: a narrated-but-not-yet-public clip waiting on a release.
    if (flags === 'staged' && (p.narrationStatus === 'none' || p.released)) return false
    if (flags === 'sheet-drift' && !p.sheetDrift) return false
    if (flags === 'speakable-drift' && !p.speakableDrift) return false
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
  // Narrate bills for enriched story POIs (un-enriched → scenic, skipped); Re-score acts on places that
  // already HAVE a narration. Per-action counts so each button's number reflects what it will touch.
  const numNarratableSelected = useMemo(
    () => filtered.reduce((n, p) => n + (isSelected(p.id) && p.storyEligibility === 'eligible' && p.enriched ? 1 : 0), 0),
    [filtered, selMode, selIds],
  )
  const numWithNarrationSelected = useMemo(
    () => filtered.reduce((n, p) => n + (isSelected(p.id) && p.narrationCount > 0 ? 1 : 0), 0),
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

  // The table-filter axes (search/region/source/flags) are independent of the row SELECTION above.
  const filtersActive = q !== '' || region !== 'all' || source !== 'all' || flags !== 'all'
  function clearFilters() {
    setQ('')
    setRegion('all')
    setSource('all')
    setFlags('all')
  }
  // The header stat badges are QUICK FILTERS — reset the other axes first so the badge's count always
  // matches what lands in the table (a stale region/source/search would otherwise silently narrow it).
  function applyQuickFilter(flag: string) {
    setQ('')
    setRegion('all')
    setSource('all')
    setFlags(flag)
  }

  // Resolve the selection into the enrich job's contract. 'all' mode prefers a server-side FILTER
  // (pagination-proof) when the active table filter is faithfully resolvable (region→bbox, source,
  // query); a hygiene `flags` view or a region without a bbox can't be reproduced server-side, so it
  // falls back to enumerating the visible ids (exact, client-side — fine at today's corpus size).
  function buildSelection(): EnrichSelection {
    if (selMode === 'explicit') return { kind: 'explicit', ids: [...selIds] }
    // The server resolves a region SLUG → its discovery bbox, so we send the slug (not a bbox). region='all'
    // → no region → the CLI defaults to the launch region. Only send a region the server can resolve (has a
    // bbox); a bbox-less region falls back to enumerating the visible ids.
    const regionHasBbox = region === 'all' || !!regionDefs.find((r) => r.slug === region)?.bbox
    const resolvable = (flags === 'all' || flags === 'story-eligible') && regionHasBbox
    if (resolvable) {
      return {
        kind: 'all',
        filter: {
          region: region !== 'all' ? region : undefined,
          source: source !== 'all' ? source : undefined,
          query: q || undefined,
        },
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

  // The active filters, surfaced in every action's confirm dialog so a spend can't run on an unseen scope.
  const FLAG_LABELS: Record<string, string> = {
    flagged: 'Needs attention',
    'story-eligible': 'Story: eligible', 'story-filtered': 'Story: filtered out', enriched: 'Enriched',
    'needs-enrich': 'Eligible · un-enriched', narrated: 'Has narration', 'narration-stale': 'Narration: stale', staged: 'Narration: staged',
    'sheet-drift': 'Story: sheet drifted', 'speakable-drift': 'Speakable: drifted', defect: 'Narration defects',
    stale: 'Stale facts', unattrib: 'Unattributed',
  }
  const scopeChips: { label: string; value: string }[] = []
  if (region !== 'all') scopeChips.push({ label: 'Region', value: regions.find((r) => r.slug === region)?.name ?? region })
  if (source !== 'all') scopeChips.push({ label: 'Source', value: source })
  if (flags !== 'all') scopeChips.push({ label: 'Flag', value: FLAG_LABELS[flags] ?? flags })
  if (q) scopeChips.push({ label: 'Search', value: q })
  const scope: ScopeDescriptor = { selection: buildSelection(), summary: selectionSummary, chips: scopeChips }

  const totals = {
    withClips: pois.filter((p) => p.narrationCount > 0).length,
    eligible: pois.filter((p) => p.storyEligibility === 'eligible').length,
    enriched: pois.filter((p) => p.enriched).length,
    // Attribution applies to STORY narrations (CC BY-SA): an unattributed narration is one that exists.
    unattrib: pois.filter((p) => !p.attributed && p.narrationCount > 0).length,
    defects: pois.filter((p) => p.suspiciousDuration).length,
    // The combined remediation queue (the folded-in "Retire" tab) — anything needing attention.
    flagged: pois.filter((p) => p.staleFacts || p.suspiciousDuration || (!p.attributed && p.narrationCount > 0) || p.speakableDrift).length,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {totals.withClips > 0 && (
          <button onClick={() => applyQuickFilter('narrated')}>
            <Badge className="cursor-pointer">{totals.withClips} with narrations</Badge>
          </button>
        )}
        {totals.eligible > 0 && (
          <button onClick={() => applyQuickFilter('story-eligible')}>
            <Badge variant="default" className="cursor-pointer">{totals.eligible} story-eligible</Badge>
          </button>
        )}
        {totals.eligible > 0 && (
          <button onClick={() => applyQuickFilter(totals.enriched < totals.eligible ? 'needs-enrich' : 'enriched')}>
            <Badge variant={totals.enriched > 0 ? 'success' : 'outline'} className="cursor-pointer">
              {totals.enriched}/{totals.eligible} enriched
            </Badge>
          </button>
        )}
        {totals.unattrib > 0 && <Badge variant="destructive">{totals.unattrib} unattributed</Badge>}
        {totals.defects > 0 && (
          <button onClick={() => applyQuickFilter('defect')}>
            <Badge variant="destructive" className="cursor-pointer">
              {totals.defects} narration defect{totals.defects > 1 ? 's' : ''}
            </Badge>
          </button>
        )}
        {totals.flagged > 0 && (
          <button onClick={() => applyQuickFilter('flagged')} title="Stale facts, narration defects, unattributed clips, or drifted speakable anchors">
            <Badge variant="warning" className="cursor-pointer">{totals.flagged} need attention</Badge>
          </button>
        )}
        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {pois.length}</span>
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
          </SelectContent>
        </Select>
        <Select value={flags} onValueChange={setFlags}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All flags</SelectItem>
            <SelectItem value="flagged">Needs attention (any flag)</SelectItem>
            <SelectItem value="story-eligible">Story: eligible</SelectItem>
            <SelectItem value="story-filtered">Story: filtered out</SelectItem>
            <SelectItem value="enriched">Enriched</SelectItem>
            <SelectItem value="needs-enrich">Eligible · un-enriched</SelectItem>
            <SelectItem value="narrated">Narration: any</SelectItem>
            <SelectItem value="narration-stale">Narration: stale</SelectItem>
            <SelectItem value="staged">Narration: staged (unreleased)</SelectItem>
            <SelectItem value="sheet-drift">Story: sheet drifted</SelectItem>
            <SelectItem value="speakable-drift">Speakable: drifted</SelectItem>
            <SelectItem value="defect">Narration defects</SelectItem>
            <SelectItem value="stale">Stale facts</SelectItem>
            <SelectItem value="unattrib">Unattributed</SelectItem>
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
      </div>

      {numSelected > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="mr-1 font-medium">{selectionSummary}</span>
          <Button size="sm" onClick={() => setEnrichOpen(true)}>
            <Sparkles className="h-4 w-4" /> Enrich {numEligibleSelected}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setNarrateOpen(true)}>
            <Zap className="h-4 w-4" /> Narrate {numNarratableSelected}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRescoreOpen(true)}>
            <Activity className="h-4 w-4" /> Re-score {numWithNarrationSelected}
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
                        {p.speakableDrift && (
                          <Badge
                            variant="warning"
                            title="Speakable anchor is implausibly far from the pin — likely a typo or hallucinated coordinate. Re-verify + reset it in the POI's Corrections tab."
                          >
                            speakable drift
                          </Badge>
                        )}
                        {p.narrationStatus !== 'none' && (
                          <Badge variant={NARRATION_META[p.narrationStatus].variant} title={NARRATION_META[p.narrationStatus].hint}>
                            {NARRATION_META[p.narrationStatus].label}
                          </Badge>
                        )}
                        {p.narrationStatus !== 'none' && !p.released && (
                          <Badge variant="warning" title="Staged — not yet public (release the region or the clip)">
                            staged
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
        scope={scope}
        onSubmitted={() => { clearSel(); navigate({ to: '/runs' }) }}
      />
      <NarrateDialog
        open={narrateOpen}
        onOpenChange={setNarrateOpen}
        scope={scope}
        onSubmitted={() => { clearSel(); navigate({ to: '/runs' }) }}
      />
      <RescoreDialog
        open={rescoreOpen}
        onOpenChange={setRescoreOpen}
        scope={scope}
        onSubmitted={() => { clearSel(); navigate({ to: '/runs' }) }}
      />
    </div>
  )
}
