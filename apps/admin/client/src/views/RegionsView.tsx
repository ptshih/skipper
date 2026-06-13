import { useEffect, useState } from 'react'
import { CheckCircle2, Layers, Loader2, Pencil, Plus, Search, TriangleAlert } from 'lucide-react'
import { api, type BboxLookupResult, type Region } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Callout } from '@/components/ui/callout'
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

type DialogMode = { mode: 'create' } | { mode: 'edit'; region: Region }

const CONFIDENCE_META = {
  high: { label: 'High confidence', className: 'text-emerald-600 dark:text-emerald-400' },
  medium: { label: 'Medium confidence', className: 'text-amber-600 dark:text-amber-400' },
  low: { label: 'Low confidence', className: 'text-red-500 dark:text-red-400' },
}

export function RegionsView() {
  const [regions, setRegions] = useState<Region[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogMode | null>(null)

  async function load() {
    try {
      setRegions((await api.regions()).regions)
      setErr(null)
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  useEffect(() => { void load() }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regions"
        description="Geographic regions — the slug drives POI discovery, tour assignment, and the in-app region picker. The discovery bbox is passed to the POI sweep job."
        actions={
          <Button onClick={() => setDialog({ mode: 'create' })}>
            <Plus className="h-4 w-4" /> Add region
          </Button>
        }
      />

      {err && (
        <Callout variant="error">
          <span className="font-medium">Error loading regions:</span> {err}
        </Callout>
      )}

      <Callout variant="info">
        <span className="font-medium text-foreground">Discovery bbox</span> — the bounding box passed to{' '}
        <code className="font-mono text-xs">Discover POIs</code> as{' '}
        <code className="font-mono text-xs">--bbox "lng_min,lat_min,lng_max,lat_max"</code>. Leave blank to use the
        generator's built-in default (Tahoe basin). Set this before running a discovery sweep for any new region.
      </Callout>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Display name</TableHead>
              <TableHead>Discovery bbox</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {regions.map((r) => (
              <TableRow key={r.slug}>
                <TableCell className="font-mono text-sm">{r.slug}</TableCell>
                <TableCell className="font-medium">{r.displayName}</TableCell>
                <TableCell>
                  {r.discoveryBbox ? (
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.discoveryBbox}</code>
                  ) : (
                    <Badge variant="secondary">default (Tahoe)</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog({ mode: 'edit', region: r })}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {regions.length === 0 && !err && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4}>
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
          onSaved={() => { setDialog(null); void load() }}
        />
      )}
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
  const [bbox, setBbox] = useState(existing?.discoveryBbox ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      if (mode.mode === 'create') {
        await api.createRegion({ slug: slug.trim(), displayName: displayName.trim(), discoveryBbox: bbox.trim() || null })
      } else {
        await api.updateRegion(mode.region.slug, { displayName: displayName.trim(), discoveryBbox: bbox.trim() || null })
      }
      onSaved()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

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
              <code className="font-mono">lng_min,lat_min,lng_max,lat_max</code>. Leave blank to use the generator
              default (Tahoe basin). Use the lookup below to find a bbox.
            </p>
          </div>

          {/* ── Bbox lookup ── */}
          <BboxLookup
            defaultQuery={displayName}
            onUse={(b) => setBbox(b)}
          />
        </div>

        {err && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy || !displayName.trim() || (mode.mode === 'create' && !slug.trim())}
            onClick={submit}
          >
            {busy ? 'Saving…' : mode.mode === 'create' ? 'Create region' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ── BBOX LOOKUP ── */

function BboxLookup({ defaultQuery, onUse }: { defaultQuery: string; onUse: (bbox: string) => void }) {
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BboxLookupResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // When the display name changes and we haven't searched yet, keep q in sync as a hint.
  useEffect(() => {
    if (!result && !loading) setQ(defaultQuery)
  }, [defaultQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  async function lookup() {
    if (!q.trim()) return
    setLoading(true)
    setResult(null)
    setErr(null)
    try {
      setResult(await api.bboxLookup(q.trim()))
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setLoading(false)
    }
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
        <Button variant="outline" size="sm" disabled={loading || !q.trim()} onClick={lookup} className="shrink-0">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {loading ? 'Searching…' : 'Search'}
        </Button>
      </div>

      {err && (
        <div className="mt-2 text-xs text-destructive">{err}</div>
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
                <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
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
                <TriangleAlert className="h-3.5 w-3.5 text-amber-500" />
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
