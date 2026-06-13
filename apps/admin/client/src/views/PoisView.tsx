import { Fragment, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, CircleCheck, Compass, Locate, Plus, RefreshCw, Search, Trash2, Wrench } from 'lucide-react'
import { api, type CorrectionOverride, type PoiCorrections, type PoiRow, type Region } from '@/lib/api'
import { errMsg, timeAgo } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Callout } from '@/components/ui/callout'
import { SearchInput } from '@/components/ui/search-input'
import { Segmented } from '@/components/ui/segmented'
import { EmptyState } from '@/components/ui/empty-state'
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

// Region → discovery bbox for the sweep_roam_pois job. A new region adds ONE entry here.
// `undefined` = omit --bbox (the generator sweep already defaults to the Tahoe basin).
// The proper home for this is a generator-side `--region <slug>` lookup later; this map is the
// admin-side stopgap so the operator never has to remember/paste raw coordinates. Shared with
// RoamView's per-region Discover/Generate actions.
export const REGION_BBOX: Record<string, string | undefined> = {
  'lake-tahoe': undefined,
}

const SOURCE_META: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  wikidata: { label: 'Wikidata', variant: 'default' },
  osm: { label: 'OSM', variant: 'secondary' },
  manual: { label: 'Manual', variant: 'outline' },
}

export function PoisView() {
  const navigate = useNavigate()
  const [pois, setPois] = useState<PoiRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('corpus')
  const [discoverOpen, setDiscoverOpen] = useState(false)

  useEffect(() => {
    api.pois()
      .then((r) => setPois(r.pois))
      .catch((e) => setErr(errMsg(e)))
  }, [])

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
          <Button onClick={() => setDiscoverOpen(true)}>
            <Compass className="h-4 w-4" /> Discover POIs
          </Button>
        }
      />

      {err && (
        <Callout variant="error">
          <span className="font-medium">Error loading POIs:</span> {err}
        </Callout>
      )}

      <Segmented
        value={tab}
        onChange={setTab}
        options={tabs.map((t) => ({ value: t.id, label: t.label, count: t.count, alert: t.alert }))}
      />

      {tab === 'corpus' && <CorpusTab pois={live} />}
      {tab === 'retire' && <RetireTab flagged={flagged} />}

      <DiscoverDialog open={discoverOpen} onOpenChange={setDiscoverOpen} onSubmitted={() => navigate('/runs')} />
    </div>
  )
}

/* ── DISCOVER POIs ── */

// Fire the region-discovery sweep (sweep_roam_pois) for a region. FREE — no LLM/TTS, no confirm.
// Omits --bbox when REGION_BBOX has no entry (the sweep defaults to the Tahoe basin).
export async function discoverPois(regionSlug: string, apply: boolean) {
  const bbox = REGION_BBOX[regionSlug]
  await api.createJob({ kind: 'sweep_roam_pois', ...(bbox ? { bbox } : {}), apply })
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
  const [regions, setRegions] = useState<Region[]>([])
  const [regionSlug, setRegionSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    api.regions()
      .then((r) => {
        setRegions(r.regions)
        if (r.regions.length > 0) setRegionSlug(r.regions[0].slug)
      })
      .catch((e) => setErr(errMsg(e)))
  }, [open])

  async function submit(apply: boolean) {
    if (!regionSlug) return
    setBusy(true)
    setErr(null)
    try {
      await discoverPois(regionSlug, apply)
      onSubmitted()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

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
          <Select id="discover-region" value={regionSlug} onChange={(e) => setRegionSlug(e.target.value)}>
            {regions.length === 0 && <option value="">Loading…</option>}
            {regions.map((r) => (
              <option key={r.slug} value={r.slug}>{r.displayName}</option>
            ))}
          </Select>
        </div>

        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Free preview — no spend, no deletion. <span className="font-medium text-foreground">Preview</span> dry-runs
          the discovery; <span className="font-medium text-foreground">Discover</span> upserts the corpus.
        </div>

        {err && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="outline" disabled={busy || !regionSlug} onClick={() => void submit(false)}>
            {busy ? 'Triggering…' : 'Preview'}
          </Button>
          <Button disabled={busy || !regionSlug} onClick={() => void submit(true)}>
            <Compass className="h-4 w-4" /> {busy ? 'Triggering…' : 'Discover'}
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
  const [data, setData] = useState<PoiCorrections | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Add-correction form
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [reason, setReason] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  // Speakable-anchor inputs
  const [lat, setLat] = useState('')
  const [lng, setLng] = useState('')

  function load() {
    setLoading(true)
    api.poiCorrections(poiId)
      .then((r) => { setData(r); setErr(null) })
      .catch((e) => setErr(errMsg(e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [poiId])

  async function run(fn: () => Promise<PoiCorrections>) {
    setSaving(true)
    setErr(null)
    try {
      setData(await fn())
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  async function addCorrection() {
    if (!find.trim() || !reason.trim()) {
      setErr('A find string and a reason are both required.')
      return
    }
    await run(() => api.saveCorrection(poiId, {
      kind: 'fact_edit',
      find,
      replace,
      reason: reason.trim(),
      ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}),
    }))
    setFind(''); setReplace(''); setReason(''); setSourceUrl('')
  }

  async function retire(f: string) {
    await run(() => api.saveCorrection(poiId, { kind: 'retire', find: f }))
  }

  async function setSpeakable() {
    const la = Number(lat), ln = Number(lng)
    if (!Number.isFinite(la) || !Number.isFinite(ln) || lat.trim() === '' || lng.trim() === '') {
      setErr('Speakable anchor needs two numeric coordinates.')
      return
    }
    await run(() => api.saveCorrection(poiId, { kind: 'speakable', lat: la, lng: ln }))
    setLat(''); setLng('')
  }

  async function clearSpeakable() {
    await run(() => api.saveCorrection(poiId, { kind: 'speakable', lat: null }))
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

/* ── CORPUS ── */

function CorpusTab({ pois }: { pois: PoiRow[] }) {
  const [q, setQ] = useState('')
  const [region, setRegion] = useState('all')
  const [source, setSource] = useState('all')
  const [flags, setFlags] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)

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
    if (q) {
      const s = `${p.name} ${p.sourceId}`.toLowerCase()
      if (!s.includes(q.toLowerCase())) return false
    }
    return true
  }), [pois, region, source, flags, q])

  const totals = {
    total: pois.length,
    withClips: pois.filter((p) => p.roamClipCount > 0).length,
    inTours: pois.filter((p) => p.tourCount > 0).length,
    unattrib: pois.filter((p) => !p.attributed && p.tourCount > 0).length,
    defects: pois.filter((p) => p.suspiciousDuration).length,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{totals.total} total</Badge>
        <Badge>{totals.withClips} with roam clips</Badge>
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
        <Select value={region} onChange={(e) => setRegion(e.target.value)} className="w-auto">
          <option value="all">All regions</option>
          {regions.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
        </Select>
        <Select value={source} onChange={(e) => setSource(e.target.value)} className="w-auto">
          <option value="all">All sources</option>
          <option value="wikidata">Wikidata</option>
          <option value="osm">OSM</option>
          <option value="manual">Manual</option>
        </Select>
        <Select value={flags} onChange={(e) => setFlags(e.target.value)} className="w-auto">
          <option value="all">All flags</option>
          <option value="defect">Clip defects</option>
          <option value="stale">Stale facts</option>
          <option value="unattrib">Unattributed</option>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {pois.length}</span>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Name</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Region</TableHead>
              <TableHead className="text-right">Tours</TableHead>
              <TableHead className="text-right">Roam clips</TableHead>
              <TableHead>Attribution</TableHead>
              <TableHead>Facts hash</TableHead>
              <TableHead className="text-right">Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((p) => {
              const sm = SOURCE_META[p.source]
              const isOpen = expanded === p.id
              const toggleExpand = () => setExpanded(isOpen ? null : p.id)
              return (
                <Fragment key={p.id}>
                  <TableRow>
                    <TableCell className="text-center">
                      <button
                        onClick={toggleExpand}
                        aria-label={isOpen ? 'Collapse' : 'Expand'}
                        className="inline-flex text-muted-foreground hover:text-foreground"
                      >
                        {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                    </TableCell>
                    <TableCell>
                      <button className="text-left font-medium hover:underline" onClick={toggleExpand}>{p.name}</button>
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
                    <TableCell className="text-right font-mono">
                      {p.roamClipCount > 0 ? (
                        <Badge>{p.roamClipCount}</Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
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
                  {isOpen && (
                    <TableRow key={`${p.id}-detail`} className="hover:bg-transparent">
                      <TableCell colSpan={9} className="bg-muted/30 pt-0">
                        <Corrections poiId={p.id} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
            {filtered.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={9}>
                  <EmptyState icon={Search}>No POIs match these filters.</EmptyState>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

/* ── RETIRE ── */

function RetireTab({ flagged }: { flagged: PoiRow[] }) {
  if (flagged.length === 0) {
    return (
      <EmptyState
        icon={CircleCheck}
        iconClassName="text-emerald-600 dark:text-emerald-400"
        className="rounded-xl border bg-muted/30"
      >
        No flagged POIs — corpus is clean.
      </EmptyState>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Flagged POIs — stale facts need a re-fetch or retire; unattributed story stops violate CC BY-SA. Retire
        removes the DB record; run <code className="font-mono text-xs">Discover POIs</code> afterward to purge R2 clips.
      </p>
      <div className="space-y-2">
        {flagged.map((p) => {
          const tone = p.staleFacts ? 'warning' : 'destructive'
          const label = p.staleFacts ? 'Stale facts' : 'Unattributed'
          const desc = p.staleFacts ? 'factsHash changed — re-fetch or retire' : 'story stop missing CC BY-SA attribution'
          return (
            <div
              key={p.id}
              className={cn(
                'rounded-xl border px-4 py-3',
                p.staleFacts ? 'border-amber-500/30 bg-amber-500/5' : 'border-destructive/30 bg-destructive/5',
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
                      <span className="text-amber-600 dark:text-amber-400">
                        {p.roamClipCount} roam clip{p.roamClipCount > 1 ? 's' : ''} to sweep
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {p.staleFacts && (
                    <Button variant="outline" size="sm" onClick={() => alert(`Re-fetch facts for ${p.id}`)}>
                      <RefreshCw className="h-3 w-3" /> Re-fetch
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => alert(`Retire ${p.id}`)}>
                    <Trash2 className="h-3 w-3" /> Retire
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
