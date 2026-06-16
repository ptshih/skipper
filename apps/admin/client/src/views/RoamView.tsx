import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, MapPin, RefreshCw, Zap } from 'lucide-react'
import { api, type PoiRow } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { EmptyState } from '@/components/ui/empty-state'
import { cn } from '@/lib/utils'

/* Region coverage derived from the pois array */
interface RegionCoverage {
  regionSlug: string
  regionName: string
  total: number // all POIs in the bbox (context only)
  qualified: number // story-eligible POIs — what roam can actually narrate, the real coverage denominator
  withClips: number
  density: 'ok' | 'thin' | 'sparse'
  roamReady: boolean
}

function buildCoverage(pois: PoiRow[]): RegionCoverage[] {
  const map = new Map<string, { name: string; total: number; qualified: number; withClips: number }>()
  for (const p of pois) {
    if (!p.regionSlug) continue
    const r = map.get(p.regionSlug) ?? { name: p.regionName ?? p.regionSlug, total: 0, qualified: 0, withClips: 0 }
    r.total++
    if (p.storyEligibility === 'eligible') r.qualified++ // roam's selection bar (generate-roam.ts) == story-eligible
    if (p.roamClipCount > 0) r.withClips++
    map.set(p.regionSlug, r)
  }
  return [...map.entries()].map(([slug, r]) => {
    // Coverage is clips ÷ QUALIFIED, not ÷ total — roam never speaks scenic/stub pins, so dividing by
    // total understated every region. Clamp: a clip on a now-unqualified poi (facts shrank/renamed)
    // could otherwise push the ratio past 1.
    const pct = r.qualified > 0 ? Math.min(r.withClips / r.qualified, 1) : 0
    const roamReady = r.withClips >= 5 && pct >= 0.5
    const density: 'ok' | 'thin' | 'sparse' = roamReady ? 'ok' : r.withClips >= 2 ? 'thin' : 'sparse'
    return { regionSlug: slug, regionName: r.name, total: r.total, qualified: r.qualified, withClips: r.withClips, density, roamReady }
  }).sort((a, b) => b.qualified - a.qualified)
}

const DENSITY_META: Record<RegionCoverage['density'], { variant: 'success' | 'warning' | 'secondary'; label: string; desc: string }> = {
  ok: { variant: 'success', label: 'Roam-ready', desc: '≥5 clips, ≥50% coverage' },
  thin: { variant: 'warning', label: 'Thin', desc: '2+ clips — below the roam bar' },
  sparse: { variant: 'secondary', label: 'Sparse', desc: 'Not enough for the ambient contract' },
}

export function RoamView() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  // pois shares the ['pois'] key with PoisView; regions shares ['regions'] with Create/Regions.
  const poisQuery = useQuery({ queryKey: ['pois'], queryFn: async () => (await api.pois()).pois })
  const regionsQuery = useQuery({ queryKey: ['regions'], queryFn: async () => (await api.regions()).regions })
  const pois = poisQuery.data ?? []
  const regionMap = useMemo(
    () => new Map((regionsQuery.data ?? []).map((r) => [r.slug, r] as const)),
    [regionsQuery.data],
  )

  const coverage = useMemo(() => buildCoverage(pois), [pois])
  const withClips = useMemo(
    () => pois.filter((p) => p.roamClipCount > 0).sort((a, b) => a.name.localeCompare(b.name)),
    [pois],
  )

  // Fire generate_roam for one region — this SPENDS (LLM + TTS per clip), so confirm first.
  const generateMut = useMutation({
    mutationFn: (r: RegionCoverage) => {
      const bbox = regionMap.get(r.regionSlug)?.discoveryBbox
      return api.createJob({ kind: 'generate_roam', ...(bbox ? { bbox } : {}), apply: true, confirm: true })
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['runs'] }); navigate({ to: '/runs' }) },
  })
  function generateRoam(r: RegionCoverage) {
    if (!window.confirm(`Generate roam clips for ${r.regionName}? This spends LLM + TTS credits per clip.`)) return
    generateMut.mutate(r)
  }

  const err =
    poisQuery.error || regionsQuery.error
      ? `Couldn't load roam data — ${errMsg(poisQuery.error ?? regionsQuery.error)}`
      : generateMut.error
        ? `Generate roam failed — ${errMsg(generateMut.error)}`
        : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Roam"
        description="Free-roam coverage by region + the encounter clips already synthesized. Grow + enrich the corpus on the POIs page, then Generate roam (spends) to narrate it."
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
          <CoverageTable coverage={coverage} onGenerate={(r) => void generateRoam(r)} />
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
          <EmptyState icon={Zap} className="rounded-xl border bg-muted/30">No roam clips yet — grow + enrich the corpus on the POIs page, then generate roam.</EmptyState>
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

/* ── COVERAGE TABLE ── */

function CoverageTable({
  coverage,
  onGenerate,
}: {
  coverage: RegionCoverage[]
  onGenerate: (r: RegionCoverage) => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Region</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Qualified POIs</TableHead>
            <TableHead className="text-right">Roam clips</TableHead>
            <TableHead className="w-44">Coverage</TableHead>
            <TableHead className="w-px" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {coverage.map((r) => {
            const m = DENSITY_META[r.density]
            const clipPct = r.qualified > 0 ? Math.min(r.withClips / r.qualified, 1) * 100 : 0

            return (
              <TableRow key={r.regionSlug}>
                <TableCell className="font-medium">{r.regionName}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={m.variant} title={m.desc}>{m.label}</Badge>
                    {r.roamReady && <Badge variant="success">Roam enabled</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {r.qualified}
                  <span className="text-muted-foreground"> / {r.total}</span>
                </TableCell>
                <TableCell
                  className={cn('text-right font-mono tabular-nums', r.withClips === 0 && 'text-muted-foreground')}
                >
                  {r.withClips}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'absolute inset-y-0 left-0 rounded-full',
                          r.roamReady ? 'bg-emerald-500' : r.density === 'thin' ? 'bg-amber-500' : 'bg-muted-foreground/40',
                        )}
                        style={{ width: `${clipPct}%` }}
                      />
                    </div>
                    <span
                      className={cn('w-9 shrink-0 text-right font-mono text-xs', r.withClips === 0 && 'text-muted-foreground')}
                    >
                      {r.withClips > 0 ? `${Math.round(clipPct)}%` : '—'}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="py-2 text-right">
                  <Button variant="secondary" size="sm" onClick={() => onGenerate(r)}>
                    <Zap className="h-3.5 w-3.5" /> Generate roam
                  </Button>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
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
  const qc = useQueryClient()

  const { data: clip, isLoading, error } = useQuery({
    queryKey: ['roamSign', poiId],
    queryFn: async () => (await api.roamSign(poiId)).clip,
  })

  const resynthMut = useMutation({
    mutationFn: () => api.createJob({ kind: 'resynth_roam_clip', poiId, apply: true, confirm: true }),
    onSuccess: ({ job }) => { qc.invalidateQueries({ queryKey: ['runs'] }); navigate({ to: '/runs', hash: job.id }) },
  })
  function handleResynth() {
    if (!window.confirm('Re-synthesize the roam clip for this POI? This spends ~$0.01 in TTS credits and replaces the current clip.')) return
    resynthMut.mutate()
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
        <Button variant="outline" size="sm" onClick={handleResynth} disabled={resynthMut.isPending}>
          <RefreshCw className="h-3 w-3" />
          {resynthMut.isPending ? 'Queuing…' : 'Re-synth clip'}
        </Button>
      </div>
      {resynthMut.error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Re-synth failed — {errMsg(resynthMut.error)}
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
