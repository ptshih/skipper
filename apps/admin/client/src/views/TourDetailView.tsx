import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CircleCheck, CircleX, RefreshCw, Scissors, Sparkles, TriangleAlert } from 'lucide-react'
import { api, type CharmDetail, type EvalRunSummary, type EvalScore, type TourDetail } from '@/lib/api'
import { RouteMap, STOP_TYPE_COLOR, type RouteStopPin } from '@/components/RouteMap'
import { errMsg, fmtDate, fmtDuration, fmtMiles, fmtScore, fmtSec, timeAgo } from '@/lib/format'
import { TOUR_STATUS_VARIANT } from '@/lib/status'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Callout } from '@/components/ui/callout'
import { SectionLabel } from '@/components/ui/section-label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

const DIMS: [string, string][] = [
  ['grounding', 'Grounding'],
  ['diversity', 'Diversity'],
  ['charm', 'Charm'],
  ['tts', 'TTS'],
  ['veracity', 'Veracity'],
]

const THRESHOLDS: Record<string, number> = {
  grounding: 0.85,
  diversity: 0.75,
  charm: 0.75,
  tts: 0.80,
  veracity: 0.80,
}

// The order findings read best in: accuracy first, delivery last.
const DIM_LABEL: Record<string, string> = {
  grounding: 'Grounding',
  veracity: 'Veracity',
  charm: 'Charm',
  diversity: 'Diversity',
  tts: 'TTS',
}
const DIM_ORDER = ['grounding', 'veracity', 'charm', 'diversity', 'tts']

/** The charm judge stores {best, sag} on detail — the funniest line vs the flattest bit. */
function asCharm(d: unknown): CharmDetail | null {
  return d && typeof d === 'object' && ('best' in d || 'sag' in d) ? (d as CharmDetail) : null
}

/** One dimension's verdict for a stop: its score, its findings, and (for charm) best/sag. */
function DimNote({ score }: { score: EvalScore }) {
  const charm = asCharm(score.detail)
  return (
    <div className="mt-3 border-t pt-2.5 first:mt-0 first:border-t-0 first:pt-0">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>{DIM_LABEL[score.dimension] ?? score.dimension}</span>
        <Badge variant={score.pass ? 'success' : 'warning'} className="text-[10px]">{fmtScore(score.value)}</Badge>
      </div>
      {score.findings.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-xs text-warning">
          {score.findings.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
      {charm?.best && (
        <div className="mt-1.5 text-xs text-success">
          ★ best — <span className="italic text-muted-foreground">“{charm.best}”</span>
        </div>
      )}
      {charm?.sag && (
        <div className="mt-1 text-xs text-warning">
          ▽ sag — <span className="italic text-muted-foreground">“{charm.sag}”</span>
        </div>
      )}
    </div>
  )
}

function ScoreCell({ label, value, threshold }: { label: string; value: number | null; threshold: number }) {
  const pass = value != null && value >= threshold
  const pct = value != null ? Math.min(100, Math.round(value * 100)) : 0
  const threshPct = Math.round(threshold * 100)
  return (
    <div className="space-y-2 p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('font-mono text-2xl font-semibold tracking-tight', value != null && !pass && 'text-destructive')}>
        {fmtScore(value)}
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full', value == null ? '' : pass ? 'bg-emerald-500' : 'bg-destructive')}
          style={{ width: `${pct}%` }}
        />
        <span className="absolute -inset-y-0.5 w-px bg-muted-foreground" style={{ left: `${threshPct}%` }} />
      </div>
    </div>
  )
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight size={13} className={cn('transition-transform', open && 'rotate-90')} />
        {label}
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      {label}
    </span>
  )
}

function Leader({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        'grid h-7 w-7 shrink-0 place-items-center rounded-md border bg-muted font-mono text-xs font-semibold',
        muted ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {children}
    </span>
  )
}

function ScriptText({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2.5 rounded-md border bg-muted/50 px-3 py-2.5 text-sm leading-relaxed text-muted-foreground">
      {children}
    </p>
  )
}

function FrameRow({ kind, b, url }: { kind: 'intro' | 'outro'; b: TourDetail['frames'][number]; url?: string }) {
  return (
    <div className="border-b bg-muted/30 px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <Leader muted>{kind === 'intro' ? '▸' : '◼'}</Leader>
        <Badge variant="secondary">{kind}</Badge>
        <span className="font-medium text-muted-foreground">{kind === 'intro' ? 'Welcome aboard' : 'Sign-off'}</span>
        <span className="flex-1" />
        <span className="font-mono text-xs text-muted-foreground">{fmtSec(b.audioDurationMs)}</span>
      </div>
      {url && <audio controls preload="none" src={url} className="mt-2.5 h-9 w-full" />}
      {b.script && (
        <div className="mt-2.5">
          <Disclosure label="Script">
            <ScriptText>{b.script}</ScriptText>
          </Disclosure>
        </div>
      )}
    </div>
  )
}

/** Per-stop tuning: a literal find/replace patch (preview or apply) and a plain re-voice — both
 *  fire a `patch_clip` job at this stop's track. Async: a launched job is watched in Runs. */
function StopActions({ trackId }: { trackId: string }) {
  const qc = useQueryClient()
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const patchMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.createJob({ kind: 'patch_clip', targetId: trackId, ...body }),
    onSuccess: ({ job }) => {
      setMsg({ ok: true, text: job.dryRun ? 'Preview queued.' : 'Queued — re-synthesizing.' })
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
    onError: (e) => setMsg({ ok: false, text: errMsg(e) }),
  })

  function fire(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setMsg(null)
    patchMut.mutate(body)
  }

  return (
    <div className="mt-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Scissors size={12} className="shrink-0 text-muted-foreground" />
        <Input className="h-8 w-36" placeholder="find…" value={find} onChange={(e) => setFind(e.target.value)} />
        <Input className="h-8 w-36" placeholder="replace…" value={replace} onChange={(e) => setReplace(e.target.value)} />
        <Button variant="outline" size="sm" disabled={patchMut.isPending || !find} onClick={() => fire({ find, replace })}>
          Preview
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={patchMut.isPending || !find}
          onClick={() => fire({ find, replace, apply: true, confirm: true }, `Apply “${find}” → “${replace}” and re-synth this clip? Spends TTS credits.`)}
        >
          Apply
        </Button>
        <span className="flex-1" />
        <Button
          variant="outline"
          size="sm"
          disabled={patchMut.isPending}
          onClick={() => fire({ revoice: true, apply: true, confirm: true }, 'Re-voice this clip with no text change? Spends TTS credits.')}
        >
          <RefreshCw size={12} /> Re-voice
        </Button>
      </div>
      {msg && (
        <div className={cn('mt-1.5 text-xs', msg.ok ? 'text-muted-foreground' : 'text-destructive')}>
          {msg.text} {msg.ok && <Link to="/runs" className="font-medium text-foreground hover:underline">Runs →</Link>}
        </div>
      )}
    </div>
  )
}

function StopRow({
  seq,
  trackId,
  type,
  name,
  durationMs,
  hasAudio,
  url,
  script,
  scores,
}: {
  seq: number
  trackId: string
  type: string
  name: string
  durationMs: number | null
  hasAudio: boolean
  url?: string
  script: string | null
  scores: EvalScore[]
}) {
  const grounding = scores.find((s) => s.dimension === 'grounding') ?? null
  const fail = grounding != null && !grounding.pass
  // Every dimension worth a note: anything with findings, a failing dim, or a charm sag.
  const notes = DIM_ORDER.map((dim) => scores.find((s) => s.dimension === dim)).filter(
    (s): s is EvalScore => !!s && (s.findings.length > 0 || !s.pass || !!asCharm(s.detail)?.sag),
  )
  return (
    <div className={cn('border-b px-4 py-3 last:border-b-0', fail && 'bg-destructive/5')}>
      <div className="flex items-center gap-2.5">
        <Leader>{String(seq).padStart(2, '0')}</Leader>
        <Badge variant="outline">{type}</Badge>
        <span className="font-medium">{name}</span>
        <span className="flex-1" />
        {grounding && (
          <Badge variant={grounding.pass ? 'success' : 'warning'}>
            {!grounding.pass && <TriangleAlert className="h-3 w-3" />}
            grounding {fmtScore(grounding.value)}
          </Badge>
        )}
        <span className="font-mono text-xs text-muted-foreground">{fmtSec(durationMs)}</span>
      </div>
      {url ? (
        <audio controls preload="none" src={url} className="mt-2.5 h-9 w-full" />
      ) : (
        !hasAudio && <div className="mt-2 text-xs text-muted-foreground">no audio</div>
      )}
      {(script || notes.length > 0) && (
        <div className="mt-2.5">
          <Disclosure label={notes.length > 0 ? `Script · ${notes.length} note${notes.length === 1 ? '' : 's'}` : 'Script'}>
            {script && <ScriptText>{script}</ScriptText>}
            {notes.map((s) => <DimNote key={s.dimension} score={s} />)}
            <StopActions trackId={trackId} />
          </Disclosure>
        </div>
      )}
    </div>
  )
}

function RunHistory({ runs, currentId }: { runs: EvalRunSummary[]; currentId?: string }) {
  return (
    <Disclosure label={`Run history · ${runs.length} eval${runs.length === 1 ? '' : 's'}`}>
      <div className="mt-2.5 overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Result</TableHead>
              {['Grounding', 'Diversity', 'Charm', 'Veracity'].map((h) => (
                <TableHead key={h} className="text-right">{h}</TableHead>
              ))}
              <TableHead>Model</TableHead>
              <TableHead>SHA</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r, i) => (
              <TableRow key={r.id} className={cn(r.id === currentId && 'bg-muted/50')}>
                <TableCell className="text-muted-foreground" title={fmtDate(r.createdAt)}>
                  {i === 0 && <Badge variant="outline" className="mr-1.5">current</Badge>}
                  {timeAgo(r.createdAt)}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-1.5">
                    <Badge variant={r.pass ? 'success' : 'destructive'}>
                      {r.pass ? <CircleCheck className="h-3 w-3" /> : <CircleX className="h-3 w-3" />}
                      {r.pass ? 'pass' : 'fail'}
                    </Badge>
                    {r.dryRun && <Badge variant="secondary">dry</Badge>}
                  </span>
                </TableCell>
                {(['grounding', 'diversity', 'charm', 'veracity'] as const).map((k) => (
                  <TableCell key={k} className="text-right font-mono">
                    <span className={cn((r[k] ?? 0) < THRESHOLDS[k] && 'text-destructive')}>{fmtScore(r[k])}</span>
                  </TableCell>
                ))}
                <TableCell className="text-muted-foreground">{r.narrationModel ?? '—'}</TableCell>
                <TableCell className="font-mono text-muted-foreground">{r.gitSha ? r.gitSha.slice(0, 7) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Disclosure>
  )
}

// The detail page's silhouette while the tour loads — a header block (title + badges + meta),
// the route-map panel, and a few stop rows — so the page reveals in place instead of snapping
// from a one-line "Loading…".
function TourDetailSkeleton() {
  return (
    <div>
      <Skeleton className="mb-3 h-5 w-16" />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-2.5">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-80 max-w-full" />
          <Skeleton className="h-3 w-96 max-w-full" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      </div>
      <Skeleton className="mb-6 h-56 w-full rounded-xl" />
      <div className="space-y-3 rounded-xl border p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 flex-1 max-w-md" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function TourDetailView() {
  const { id } = useParams({ strict: false })
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, error } = useQuery({ queryKey: ['tour', id], queryFn: () => api.tour(id!), enabled: !!id })
  // Signed audio URLs — a failure here is non-fatal (the page renders without playable audio).
  const { data: signed } = useQuery({ queryKey: ['sign', id], queryFn: () => api.sign(id!), enabled: !!id })
  const { data: evalsData } = useQuery({
    queryKey: ['evals', data?.tour.slug],
    queryFn: () => api.evals(data!.tour.slug),
    enabled: !!data?.tour.slug,
  })
  const runs = evalsData?.runs ?? []

  // Contextual ops — both SPEND, so confirm first, fire, then jump to Runs to watch.
  const jobMut = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.createJob(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      navigate({ to: '/runs' })
    },
  })
  function fireJob(body: Record<string, unknown>, confirmText: string) {
    if (jobMut.isPending || !window.confirm(confirmText)) return
    jobMut.mutate(body)
  }

  if (error) return <Callout variant="error">{errMsg(error)}</Callout>
  if (!data) return <TourDetailSkeleton />

  const { tour, region, stops, frames, eval: ev } = data
  const regenerate = () =>
    fireJob(
      { kind: 'generate', slug: tour.slug, dryRun: false, maxCostUsd: 5, confirm: true },
      `Regenerate “${tour.slug}” from scratch? This spends up to ~$5 of TTS credits.`,
    )
  const resynth = () =>
    fireJob(
      { kind: 'resynth', tourId: tour.id, apply: true, confirm: true },
      `Re-voice every clip of “${tour.slug}”? This spends TTS credits.`,
    )

  const urlForSeq = new Map(signed?.stops.map((s) => [s.seq, s.url]) ?? [])
  const groundingFor = (seq: number) =>
    ev?.scores.find((s) => s.seq === seq && s.dimension === 'grounding') ?? null
  const scoresForSeq = (seq: number) => ev?.scores.filter((s) => s.seq === seq) ?? []
  const intro = frames.find((b) => b.kind === 'intro')
  const outro = frames.find((b) => b.kind === 'outro')
  const failingStops = stops.filter((s) => { const g = groundingFor(s.seq); return g && !g.pass })

  // Integrity (§14.9): a READY tour must have audio on every stop + frame and attribution on
  // every story stop. Computed from already-loaded data — the per-tour view of the fleet audit.
  const isEmptyAttr = (a: unknown) => a == null || (Array.isArray(a) && a.length === 0)
  const integrity = tour.status === 'ready'
    ? {
        silentStops: stops.filter((s) => !s.hasAudio).map((s) => s.seq),
        silentFrames: frames.filter((b) => !b.hasAudio).map((b) => b.kind),
        unattributed: stops.filter((s) => s.stopType === 'story' && isEmptyAttr(s.attribution)).map((s) => s.seq),
      }
    : null
  const integrityBroken =
    integrity != null &&
    (integrity.silentStops.length > 0 || integrity.silentFrames.length > 0 || integrity.unattributed.length > 0)
  const stopPins: RouteStopPin[] = stops
    .filter((s) => s.triggerLat != null && s.triggerLng != null)
    .map((s) => ({ seq: s.seq, name: s.name, stopType: s.stopType, lat: s.triggerLat!, lng: s.triggerLng!, radiusM: s.triggerRadiusM }))

  return (
    <div>
      <button
        className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
        onClick={() => navigate({ to: '/tours' })}
      >
        <ChevronRight size={13} className="rotate-180" />
        Tours
      </button>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-semibold tracking-tight">{tour.headline}</h1>
            <Badge variant={TOUR_STATUS_VARIANT[tour.status] ?? 'secondary'}>{tour.status}</Badge>
            <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{tour.slug}</span>
          </div>
          {tour.summary && <p className="mt-1 text-sm text-muted-foreground">{tour.summary}</p>}
          <p className="mt-2 text-xs text-muted-foreground">
            {region?.displayName} · {tour.startAnchor.name} → {tour.endAnchor.name} · {fmtMiles(tour.distanceMeters)} · {fmtDuration(tour.durationSeconds)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={jobMut.isPending} onClick={() => void regenerate()}>
            <Sparkles size={13} /> Generate
          </Button>
          <Button variant="outline" size="sm" disabled={jobMut.isPending} onClick={() => void resynth()}>
            <RefreshCw size={13} /> Resynth
          </Button>
        </div>
      </div>

      {integrityBroken && integrity && (
        <Callout variant="error" className="mb-6 border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-1.5 font-medium text-destructive">
            <TriangleAlert className="h-3.5 w-3.5" /> Integrity — this ready tour is broken
          </div>
          <div className="mt-1 leading-relaxed text-muted-foreground">
            A <span className="font-medium text-foreground">ready</span> tour must have audio on every stop and frame, and attribution on every story stop.
            {integrity.silentStops.length > 0 && <> Stops with no audio: <span className="font-medium text-foreground">{integrity.silentStops.join(', ')}</span>.</>}
            {integrity.silentFrames.length > 0 && <> Frames with no audio: <span className="font-medium text-foreground">{integrity.silentFrames.join(', ')}</span>.</>}
            {integrity.unattributed.length > 0 && <> Story stops missing CC BY-SA attribution: <span className="font-medium text-foreground">{integrity.unattributed.join(', ')}</span>.</>}
            {' '}Re-run generate or resynth, or flip the status off ready.
          </div>
        </Callout>
      )}

      {tour.polyline.length > 1 && (
        <Card className="mb-6 overflow-hidden">
          <div className="flex items-center gap-2.5 border-b px-4 py-3">
            <span className="text-sm font-semibold">Route</span>
            <span className="ml-auto text-xs text-muted-foreground">{stopPins.length} of {stops.length} stops placed</span>
          </div>
          <RouteMap polyline={tour.polyline} start={tour.startAnchor} end={tour.endAnchor} stops={stopPins} />
          <div className="flex items-center gap-3.5 px-4 py-2.5">
            <LegendDot color="#10b981" label="Start" />
            <LegendDot color="#ef4444" label="End" />
            <LegendDot color={STOP_TYPE_COLOR.story} label="story" />
            <LegendDot color={STOP_TYPE_COLOR.scenic} label="scenic" />
            <LegendDot color={STOP_TYPE_COLOR.break} label="break" />
          </div>
        </Card>
      )}

      {ev && (
        <Card className="mb-6 overflow-hidden">
          <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3">
            <span className="text-sm font-semibold">Latest evaluation</span>
            <Badge variant={ev.pass ? 'success' : 'destructive'}>
              {ev.pass ? <CircleCheck className="h-3 w-3" /> : <CircleX className="h-3 w-3" />}
              {ev.pass ? 'pass' : 'fail'}
            </Badge>
            {failingStops.length > 0 && <Badge variant="warning">{failingStops.length} stop below bar</Badge>}
            <span className="ml-auto text-xs text-muted-foreground">{ev.narrationModel} · {timeAgo(ev.createdAt)}</span>
          </div>
          <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-5 sm:divide-y-0">
            {DIMS.map(([k, label]) => (
              <ScoreCell
                key={k}
                label={label}
                value={ev[k as keyof typeof ev] as number | null}
                threshold={THRESHOLDS[k]}
              />
            ))}
          </div>
        </Card>
      )}

      {runs.length > 0 && <RunHistory runs={runs} currentId={ev?.id} />}

      <SectionLabel className="mb-2.5 mt-6">Itinerary · {stops.length} stops</SectionLabel>
      <div className="overflow-hidden rounded-xl border">
        {intro && <FrameRow kind="intro" b={intro} url={signed?.intro?.url} />}
        {stops.map((s) => (
          <StopRow
            key={s.seq}
            seq={s.seq}
            trackId={s.trackId}
            type={s.stopType}
            name={s.name}
            durationMs={s.audioDurationMs}
            hasAudio={s.hasAudio}
            url={urlForSeq.get(s.seq)}
            script={s.script}
            scores={scoresForSeq(s.seq)}
          />
        ))}
        {outro && <FrameRow kind="outro" b={outro} url={signed?.outro?.url} />}
      </div>
    </div>
  )
}
