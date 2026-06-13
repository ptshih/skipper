import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Compass, MapPin, RefreshCw, Zap } from 'lucide-react'
import { api, type PoiRow, type RoamClipDetail } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'
import { REGION_BBOX, discoverPois } from './PoisView'

/* Region coverage derived from the pois array */
interface RegionCoverage {
  regionSlug: string
  regionName: string
  total: number
  withClips: number
  density: 'ok' | 'thin' | 'sparse'
  roamReady: boolean
}

function buildCoverage(pois: PoiRow[]): RegionCoverage[] {
  const map = new Map<string, { name: string; total: number; withClips: number }>()
  for (const p of pois) {
    if (!p.regionSlug) continue
    const r = map.get(p.regionSlug) ?? { name: p.regionName ?? p.regionSlug, total: 0, withClips: 0 }
    r.total++
    if (p.roamClipCount > 0) r.withClips++
    map.set(p.regionSlug, r)
  }
  return [...map.entries()].map(([slug, r]) => {
    const pct = r.total > 0 ? r.withClips / r.total : 0
    const roamReady = r.withClips >= 5 && pct >= 0.5
    const density: 'ok' | 'thin' | 'sparse' = roamReady ? 'ok' : r.withClips >= 2 ? 'thin' : 'sparse'
    return { regionSlug: slug, regionName: r.name, total: r.total, withClips: r.withClips, density, roamReady }
  }).sort((a, b) => b.total - a.total)
}

const DENSITY_META: Record<RegionCoverage['density'], { variant: 'success' | 'warning' | 'secondary'; label: string; desc: string }> = {
  ok: { variant: 'success', label: 'Roam-ready', desc: '≥5 clips, ≥50% coverage' },
  thin: { variant: 'warning', label: 'Thin', desc: '2+ clips — below the roam bar' },
  sparse: { variant: 'secondary', label: 'Sparse', desc: 'Not enough for the ambient contract' },
}

export function RoamView() {
  const navigate = useNavigate()
  const [pois, setPois] = useState<PoiRow[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api.pois()
      .then((r) => setPois(r.pois))
      .catch((e) => setErr(`Couldn't load roam data — ${errMsg(e)}`))
  }, [])

  const coverage = useMemo(() => buildCoverage(pois), [pois])
  const withClips = useMemo(
    () => pois.filter((p) => p.roamClipCount > 0).sort((a, b) => a.name.localeCompare(b.name)),
    [pois],
  )

  // Fire the region-discovery sweep for one region card, then jump to Runs. Free — no confirm.
  async function discover(regionSlug: string) {
    setErr(null)
    try {
      await discoverPois(regionSlug, true)
      navigate('/runs')
    } catch (e) {
      setErr(`Discover failed — ${errMsg(e)}`)
    }
  }

  // Fire generate_roam for one region — this SPENDS (LLM + TTS per clip), so confirm first.
  async function generateRoam(r: RegionCoverage) {
    if (!window.confirm(`Generate roam clips for ${r.regionName}? This spends LLM + TTS credits per clip.`)) return
    const bbox = REGION_BBOX[r.regionSlug]
    setErr(null)
    try {
      await api.createJob({ kind: 'generate_roam', ...(bbox ? { bbox } : {}), apply: true, confirm: true })
      navigate('/runs')
    } catch (e) {
      setErr(`Generate roam failed — ${errMsg(e)}`)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roam"
        description="Free-roam coverage by region + the encounter clips already synthesized. Discover (free) to grow the corpus, then Generate roam (spends) to narrate it."
      />

      {err && <Callout variant="error">{err}</Callout>}

      {/* ── COVERAGE ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Region coverage</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Per-region density for free-roam eligibility — a region qualifies when its main roads offer an encounter
            within ~5 minutes at typical speeds.
          </p>
        </div>

        {coverage.length === 0 ? (
          <EmptyState icon={MapPin} className="rounded-xl border bg-muted/30">No regions with POI data yet.</EmptyState>
        ) : (
          <CoverageGrid coverage={coverage} onDiscover={(slug) => void discover(slug)} onGenerate={(r) => void generateRoam(r)} />
        )}
      </section>

      {/* ── CLIPS ── */}
      <section className="space-y-3">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Roam clips</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {withClips.length} POI{withClips.length === 1 ? '' : 's'} with a synthesized encounter clip — expand to
            play and re-synth.
          </p>
        </div>

        {withClips.length === 0 ? (
          <EmptyState icon={Zap} className="rounded-xl border bg-muted/30">No roam clips yet — discover a region, then generate roam.</EmptyState>
        ) : (
          <div className="overflow-hidden rounded-xl border divide-y">
            {withClips.map((p) => (
              <ClipRow key={p.id} poi={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/* ── COVERAGE GRID ── */

function CoverageGrid({
  coverage,
  onDiscover,
  onGenerate,
}: {
  coverage: RegionCoverage[]
  onDiscover: (regionSlug: string) => void
  onGenerate: (r: RegionCoverage) => void
}) {
  const maxTotal = Math.max(...coverage.map((r) => r.total), 1)

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {coverage.map((r) => {
        const m = DENSITY_META[r.density]
        const clipPct = r.total > 0 ? (r.withClips / r.total) * 100 : 0
        const totalPct = (r.total / maxTotal) * 100

        return (
          <Card key={r.regionSlug}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle>{r.regionName}</CardTitle>
              <div className="flex items-center gap-1.5">
                <Badge variant={m.variant}>{m.label}</Badge>
                {r.roamReady && <Badge variant="success">Roam enabled</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <CoverageStat label="Total POIs" value={r.total} />
                <CoverageStat label="With roam clips" value={r.withClips} dim={r.withClips === 0} />
                <CoverageStat label="Coverage" value={r.withClips > 0 ? `${Math.round(clipPct)}%` : '—'} dim={r.withClips === 0} />
              </div>

              <div className="space-y-1">
                <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-border" style={{ width: `${totalPct}%` }} />
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 rounded-full',
                      r.roamReady ? 'bg-emerald-500' : r.density === 'thin' ? 'bg-amber-500' : 'bg-muted-foreground/40',
                    )}
                    style={{ width: `${clipPct}%` }}
                  />
                </div>
                <div className="font-mono text-xs text-muted-foreground">{m.desc}</div>
              </div>

              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onDiscover(r.regionSlug)}>
                  <Compass className="h-3.5 w-3.5" /> Discover POIs
                </Button>
                <Button variant="secondary" size="sm" onClick={() => onGenerate(r)}>
                  <Zap className="h-3.5 w-3.5" /> Generate roam
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function CoverageStat({ label, value, dim }: { label: string; value: string | number; dim?: boolean }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('font-mono text-lg tracking-tight', dim ? 'text-muted-foreground' : 'font-semibold')}>
        {value}
      </div>
    </div>
  )
}

/* ── CLIP ROW ── */

function ClipRow({ poi }: { poi: PoiRow }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <span className="text-muted-foreground">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </span>
        <span className="flex-1 font-medium">{poi.name}</span>
        {poi.regionName && <span className="text-sm text-muted-foreground">{poi.regionName}</span>}
        {poi.suspiciousDuration && <Badge variant="destructive">clip defect</Badge>}
        <Badge>{poi.roamClipCount} clip{poi.roamClipCount > 1 ? 's' : ''}</Badge>
      </button>
      {open && (
        <div className="bg-muted/30 px-4 pb-4">
          <RoamPlayer poiId={poi.id} />
        </div>
      )}
    </div>
  )
}

/* ── ROAM CLIP PLAYER ── */

function RoamPlayer({ poiId }: { poiId: string }) {
  const navigate = useNavigate()
  const [clip, setClip] = useState<RoamClipDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resynthing, setResynthing] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api.roamSign(poiId)
      .then((r) => setClip(r.clip))
      .catch((e) => setErr(errMsg(e)))
      .finally(() => setLoading(false))
  }, [poiId])

  if (loading) return <div className="py-2 text-xs text-muted-foreground">Loading…</div>
  if (err) return <div className="py-2 text-xs text-destructive">{err}</div>
  if (!clip) return null

  const durationSec = Math.round(clip.audioDurationMs / 1000)
  const mins = Math.floor(durationSec / 60)
  const secs = durationSec % 60
  const durLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  const wordCount = clip.script?.trim().split(/\s+/).filter(Boolean).length ?? 0
  const wpm = wordCount > 0 ? Math.round(wordCount / (clip.audioDurationMs / 1000 / 60)) : 0
  const suspicious = wpm > 0 && wpm < 90

  async function handleResynth() {
    if (!window.confirm('Re-synthesize the roam clip for this POI? This spends ~$0.01 in TTS credits and replaces the current clip.')) return
    setResynthing(true)
    setActionErr(null)
    try {
      const { job } = await api.createJob({ kind: 'resynth_roam_clip', poiId, apply: true, confirm: true })
      navigate(`/runs#${job.id}`)
    } catch (e) {
      setActionErr(`Re-synth failed — ${errMsg(e)}`)
    } finally {
      setResynthing(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 pt-3">
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
        <Button variant="outline" size="sm" onClick={handleResynth} disabled={resynthing}>
          <RefreshCw className="h-3 w-3" />
          {resynthing ? 'Queuing…' : 'Re-synth clip'}
        </Button>
      </div>
      {actionErr && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {actionErr}
        </div>
      )}
      {suspicious && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Clip duration ({durLabel} for {wordCount} words) looks like a TTS duplicate-audio defect. Re-synth to fix.
        </div>
      )}
      <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{clip.script}</div>
    </div>
  )
}
