import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type SignResult, type TourDetail } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { fmtDuration, fmtMiles, fmtScore, fmtSec } from '@/lib/format'

export function TourDetailView() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<TourDetail | null>(null)
  const [signed, setSigned] = useState<SignResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.tour(id).then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    api.sign(id).then(setSigned).catch(() => setSigned(null)) // audio is best-effort
  }, [id])

  if (err) return <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>
  if (!data) return <div className="text-muted-foreground">Loading…</div>

  const { tour, region, stops, brackets, eval: ev } = data
  const urlForSeq = new Map(signed?.stops.map((s) => [s.seq, s.url]) ?? [])
  const groundingFor = (seq: number) =>
    ev?.scores.find((s) => s.seq === seq && s.dimension === 'grounding') ?? null
  const intro = brackets.find((b) => b.kind === 'intro')
  const outro = brackets.find((b) => b.kind === 'outro')

  return (
    <div className="space-y-5">
      <div>
        <Link to="/tours" className="text-sm text-muted-foreground hover:underline">← Tours</Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold">{tour.headline}</h1>
          <Badge variant={tour.status === 'ready' ? 'success' : 'secondary'}>{tour.status}</Badge>
        </div>
        <div className="font-mono text-xs text-muted-foreground">{tour.slug}</div>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{tour.summary}</p>
        <div className="mt-2 text-sm text-muted-foreground">
          {region?.displayName} · {tour.startAnchor.name} → {tour.endAnchor.name} · {fmtMiles(tour.distanceMeters)} · {fmtDuration(tour.durationSeconds)}
        </div>
      </div>

      {ev && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Latest eval{' '}
              <Badge variant={ev.pass ? 'success' : 'destructive'}>{ev.pass ? 'pass' : 'fail'}</Badge>{' '}
              {ev.dryRun && <Badge variant="secondary">dry-run</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-4 text-sm">
            <Metric label="grounding" v={ev.grounding} />
            <Metric label="diversity" v={ev.diversity} />
            <Metric label="charm" v={ev.charm} />
            <Metric label="tts" v={ev.tts} />
            <Metric label="veracity" v={ev.veracity} />
            <div className="text-xs text-muted-foreground">{ev.narrationModel}</div>
          </CardContent>
        </Card>
      )}

      {intro && <Bracket kind="intro" b={intro} url={signed?.intro?.url} />}

      <div className="space-y-3">
        {stops.map((s) => {
          const g = groundingFor(s.seq)
          const url = urlForSeq.get(s.seq)
          return (
            <Card key={s.seq}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{String(s.seq).padStart(2, '0')}</span>
                  <Badge variant="outline">{s.stopType}</Badge>
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  <span className="ml-auto text-xs text-muted-foreground">{fmtSec(s.audioDurationMs)}</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {url ? <audio controls preload="none" src={url} className="w-full" /> : !s.hasAudio && <div className="text-xs text-muted-foreground">no audio</div>}
                {s.script && <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.script}</p>}
                {g && (
                  <div className="text-xs">
                    <Badge variant={g.pass ? 'success' : 'warning'}>grounding {fmtScore(g.value)}</Badge>
                    {g.findings.length > 0 && (
                      <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                        {g.findings.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {outro && <Bracket kind="outro" b={outro} url={signed?.outro?.url} />}
    </div>
  )
}

function Metric({ label, v }: { label: string; v: number | null }) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className="font-mono">{fmtScore(v)}</div>
    </div>
  )
}

function Bracket({ kind, b, url }: { kind: string; b: TourDetail['brackets'][number]; url?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base uppercase tracking-wide text-muted-foreground">{kind}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {url && <audio controls preload="none" src={url} className="w-full" />}
        {b.script && <p className="whitespace-pre-wrap text-sm leading-relaxed">{b.script}</p>}
      </CardContent>
    </Card>
  )
}
