import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type EvalRunSummary, type EvalScore, type SignResult, type TourDetail } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RouteMap, STOP_TYPE_COLOR, type RouteStopPin } from '@/components/RouteMap'
import { fmtDate, fmtDuration, fmtMiles, fmtScore, fmtSec, timeAgo } from '@/lib/format'

export function TourDetailView() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<TourDetail | null>(null)
  const [signed, setSigned] = useState<SignResult | null>(null)
  const [runs, setRuns] = useState<EvalRunSummary[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.tour(id).then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    api.sign(id).then(setSigned).catch(() => setSigned(null)) // audio is best-effort
  }, [id])

  // Eval history is keyed by slug, so it waits for the tour to resolve.
  useEffect(() => {
    const slug = data?.tour.slug
    if (!slug) return
    api.evals(slug).then((r) => setRuns(r.runs)).catch(() => setRuns([]))
  }, [data?.tour.slug])

  if (err) return <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>
  if (!data) return <div className="text-muted-foreground">Loading…</div>

  const { tour, region, stops, brackets, eval: ev } = data
  const urlForSeq = new Map(signed?.stops.map((s) => [s.seq, s.url]) ?? [])
  const groundingFor = (seq: number) =>
    ev?.scores.find((s) => s.seq === seq && s.dimension === 'grounding') ?? null
  const intro = brackets.find((b) => b.kind === 'intro')
  const outro = brackets.find((b) => b.kind === 'outro')
  const stopPins: RouteStopPin[] = stops
    .filter((s) => s.triggerLat != null && s.triggerLng != null)
    .map((s) => ({ seq: s.seq, name: s.name, stopType: s.stopType, lat: s.triggerLat!, lng: s.triggerLng!, radiusM: s.triggerRadiusM }))

  return (
    <div className="space-y-6">
      <div>
        <Link to="/tours" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          ← Tours
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{tour.headline}</h1>
          <Badge variant={tour.status === 'ready' ? 'success' : 'secondary'}>{tour.status}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{tour.slug}</span>
        </div>
        {tour.summary && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{tour.summary}</p>}
        <p className="mt-1 text-sm text-muted-foreground">
          {region?.displayName} · {tour.startAnchor.name} → {tour.endAnchor.name} · {fmtMiles(tour.distanceMeters)} · {fmtDuration(tour.durationSeconds)}
        </p>
      </div>

      {tour.polyline.length > 1 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Route</h2>
            <span className="text-xs text-muted-foreground">{stopPins.length} of {stops.length} stops placed</span>
          </div>
          <RouteMap polyline={tour.polyline} start={tour.startAnchor} end={tour.endAnchor} stops={stopPins} />
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <LegendDot color="#10b981" label="Start" />
            <LegendDot color="#ef4444" label="End" />
            <LegendDot color={STOP_TYPE_COLOR.story} label="story" />
            <LegendDot color={STOP_TYPE_COLOR.scenic} label="scenic" />
            <LegendDot color={STOP_TYPE_COLOR.break} label="break" />
          </div>
        </section>
      )}

      {ev && (
        <section className="rounded-xl border">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-3">
            <span className="text-sm font-medium">Latest evaluation</span>
            <Badge variant={ev.pass ? 'success' : 'destructive'}>{ev.pass ? 'pass' : 'fail'}</Badge>
            {ev.dryRun && <Badge variant="secondary">dry-run</Badge>}
            <span className="ml-auto text-xs text-muted-foreground">
              {ev.narrationModel} · {timeAgo(ev.createdAt)}
            </span>
          </div>
          <dl className="grid grid-cols-2 divide-x divide-y sm:grid-cols-5 sm:divide-y-0 [&>div]:px-4 [&>div]:py-3">
            <Stat label="grounding" v={ev.grounding} />
            <Stat label="diversity" v={ev.diversity} />
            <Stat label="charm" v={ev.charm} />
            <Stat label="tts" v={ev.tts} />
            <Stat label="veracity" v={ev.veracity} />
          </dl>
        </section>
      )}

      {runs.length > 0 && <RunHistory runs={runs} currentId={ev?.id} />}

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium">Itinerary</h2>
          <span className="text-xs text-muted-foreground">{stops.length} stops</span>
        </div>
        <div className="overflow-hidden rounded-xl border divide-y">
          {intro && (
            <BracketRow kind="intro" b={intro} url={signed?.intro?.url} />
          )}
          {stops.map((s) => (
            <StopRow
              key={s.seq}
              seq={s.seq}
              type={s.stopType}
              name={s.name}
              durationMs={s.audioDurationMs}
              hasAudio={s.hasAudio}
              url={urlForSeq.get(s.seq)}
              script={s.script}
              grounding={groundingFor(s.seq)}
            />
          ))}
          {outro && (
            <BracketRow kind="outro" b={outro} url={signed?.outro?.url} />
          )}
        </div>
      </section>
    </div>
  )
}

function RunHistory({ runs, currentId }: { runs: EvalRunSummary[]; currentId?: string }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Run history</h2>
        <span className="text-xs text-muted-foreground">{runs.length} eval{runs.length === 1 ? '' : 's'}</span>
      </div>
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {['When', 'Result', 'Grounding', 'Diversity', 'Charm', 'TTS', 'Veracity', 'Model', 'SHA'].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id} className={r.id === currentId ? 'bg-muted/40' : undefined}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground" title={fmtDate(r.createdAt)}>
                  {r.id === currentId && <Badge variant="outline" className="mr-2">current</Badge>}
                  {timeAgo(r.createdAt)}
                </TableCell>
                <TableCell>
                  <Badge variant={r.pass ? 'success' : 'destructive'}>{r.pass ? 'pass' : 'fail'}</Badge>
                  {r.dryRun && <Badge variant="secondary" className="ml-1">dry</Badge>}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{fmtScore(r.grounding)}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{fmtScore(r.diversity)}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{fmtScore(r.charm)}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{fmtScore(r.tts)}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">{fmtScore(r.veracity)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.narrationModel ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{r.gitSha ? r.gitSha.slice(0, 7) : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  )
}

function Stat({ label, v }: { label: string; v: number | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-mono text-lg tabular-nums">{fmtScore(v)}</dd>
    </div>
  )
}

/** A leading square: a stop's sequence number, or a frame glyph for intro/outro. */
function Leader({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md font-mono text-xs ' +
        (muted ? 'bg-muted text-muted-foreground' : 'bg-muted text-foreground')
      }
    >
      {children}
    </span>
  )
}

function StopRow({
  seq,
  type,
  name,
  durationMs,
  hasAudio,
  url,
  script,
  grounding,
}: {
  seq: number
  type: string
  name: string
  durationMs: number | null
  hasAudio: boolean
  url?: string
  script: string | null
  grounding: EvalScore | null
}) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Leader>{String(seq).padStart(2, '0')}</Leader>
        <Badge variant="outline">{type}</Badge>
        <span className="truncate font-medium">{name}</span>
        <div className="ml-auto flex items-center gap-2">
          {grounding && (
            <Badge variant={grounding.pass ? 'success' : 'warning'}>grounding {fmtScore(grounding.value)}</Badge>
          )}
          <span className="text-xs tabular-nums text-muted-foreground">{fmtSec(durationMs)}</span>
        </div>
      </div>
      {url ? (
        <audio controls preload="none" src={url} className="mt-3 h-9 w-full" />
      ) : (
        !hasAudio && <div className="mt-2 text-xs text-muted-foreground">no audio</div>
      )}
      {(script || (grounding && grounding.findings.length > 0)) && (
        <details className="group mt-2">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
            Script
          </summary>
          {script && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{script}</p>}
          {grounding && grounding.findings.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
              {grounding.findings.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
        </details>
      )}
    </div>
  )
}

function BracketRow({ kind, b, url }: { kind: 'intro' | 'outro'; b: TourDetail['brackets'][number]; url?: string }) {
  return (
    <div className="bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-3">
        <Leader muted>{kind === 'intro' ? '▸' : '◼'}</Leader>
        <Badge variant="secondary">{kind}</Badge>
        <span className="truncate font-medium text-muted-foreground">
          {kind === 'intro' ? 'Welcome aboard' : 'Sign-off'}
        </span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{fmtSec(b.audioDurationMs)}</span>
      </div>
      {url && <audio controls preload="none" src={url} className="mt-3 h-9 w-full" />}
      {b.script && (
        <details className="group mt-2">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
            Script
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{b.script}</p>
        </details>
      )}
    </div>
  )
}
