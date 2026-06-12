import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ChevronRight, CircleCheck, CircleX, RefreshCw, Scissors, TriangleAlert } from 'lucide-react'
import { api, type CharmDetail, type EvalRunSummary, type EvalScore, type SignResult, type TourDetail } from '@/lib/api'
import { RouteMap, STOP_TYPE_COLOR, type RouteStopPin } from '@/components/RouteMap'
import { fmtDate, fmtDuration, fmtMiles, fmtScore, fmtSec, timeAgo } from '@/lib/format'

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
    <div className="dimnote">
      <div className="dimnote__head">
        <span>{DIM_LABEL[score.dimension] ?? score.dimension}</span>
        <span className={`badge ${score.pass ? 'badge--ok' : 'badge--warn'}`} style={{ fontSize: 10 }}>
          {fmtScore(score.value)}
        </span>
      </div>
      {score.findings.length > 0 && (
        <ul className="findings">
          {score.findings.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
      {charm?.best && (
        <div className="dimnote__best">★ best — <span className="dimnote__quote">“{charm.best}”</span></div>
      )}
      {charm?.sag && (
        <div className="dimnote__sag">▽ sag — <span className="dimnote__quote">“{charm.sag}”</span></div>
      )}
    </div>
  )
}

const STATUS_BADGE: Record<string, string> = {
  ready: 'badge badge--ok',
  draft: 'badge badge--neutral',
  generating: 'badge badge--run',
  failed: 'badge badge--bad',
}

function ScoreCell({ label, value, threshold }: { label: string; value: number | null; threshold: number }) {
  const pass = value != null && value >= threshold
  const pct = value != null ? Math.min(100, Math.round(value * 100)) : 0
  const threshPct = Math.round(threshold * 100)
  return (
    <div className={`score ${value == null ? '' : pass ? 'is-pass' : 'is-fail'}`}>
      <div className="score__label">{label}</div>
      <div className="score__val">{fmtScore(value)}</div>
      <div className="score__bar">
        <i style={{ width: `${pct}%` }} />
        <span className="thresh" style={{ left: `${threshPct}%` }} />
      </div>
    </div>
  )
}

function Disclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button className="disclose" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={13} style={{ transform: open ? 'rotate(90deg)' : undefined, transition: 'transform .15s' }} />
        {label}
      </button>
      {open && <div>{children}</div>}
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="row-flex" style={{ gap: 6, fontSize: 12 }}>
      <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  )
}

function BracketRow({ kind, b, url }: { kind: 'intro' | 'outro'; b: TourDetail['brackets'][number]; url?: string }) {
  return (
    <div className="stop stop--bracket">
      <div className="stop__row">
        <span className="leader leader--muted">{kind === 'intro' ? '▸' : '◼'}</span>
        <span className="badge badge--neutral">{kind}</span>
        <span className="stop__name muted">{kind === 'intro' ? 'Welcome aboard' : 'Sign-off'}</span>
        <span className="stop__spacer" />
        <span className="stop__dur">{fmtSec(b.audioDurationMs)}</span>
      </div>
      {url && <audio controls preload="none" src={url} style={{ marginTop: 11, width: '100%', height: 36 }} />}
      {b.script && (
        <Disclosure label="Script">
          <p className="script">{b.script}</p>
        </Disclosure>
      )}
    </div>
  )
}

/** Per-stop tuning: a literal find/replace patch (preview or apply) and a plain re-voice — both
 *  fire a `patch_clip` job at this stop's track. Async: a launched job is watched in Runs. */
function StopActions({ trackId }: { trackId: string }) {
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function fire(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(true)
    setMsg(null)
    try {
      const { job } = await api.createJob({ kind: 'patch_clip', targetId: trackId, ...body })
      setMsg({ ok: true, text: job.dryRun ? 'Preview queued.' : 'Queued — re-synthesizing.' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div className="row-flex" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Scissors size={12} style={{ color: 'var(--ink-3)', flexShrink: 0 }} />
        <input style={{ width: 140 }} placeholder="find…" value={find} onChange={(e) => setFind(e.target.value)} />
        <input style={{ width: 140 }} placeholder="replace…" value={replace} onChange={(e) => setReplace(e.target.value)} />
        <button className="btn btn--default btn--sm" disabled={busy || !find} onClick={() => fire({ find, replace })}>
          Preview
        </button>
        <button
          className="btn btn--default btn--sm"
          disabled={busy || !find}
          onClick={() => fire({ find, replace, apply: true, confirm: true }, `Apply “${find}” → “${replace}” and re-synth this clip? Spends TTS credits.`)}
        >
          Apply
        </button>
        <span className="stop__spacer" />
        <button
          className="btn btn--default btn--sm"
          disabled={busy}
          onClick={() => fire({ revoice: true, apply: true, confirm: true }, 'Re-voice this clip with no text change? Spends TTS credits.')}
        >
          <RefreshCw size={12} /> Re-voice
        </button>
      </div>
      {msg && (
        <div style={{ marginTop: 6, fontSize: 12, color: msg.ok ? 'var(--ink-3)' : 'var(--bad)' }}>
          {msg.text} {msg.ok && <Link to="/runs" className="row-link">Runs →</Link>}
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
    <div className="stop" style={fail ? { background: 'var(--bad-bg)' } : undefined}>
      <div className="stop__row">
        <span className="leader">{String(seq).padStart(2, '0')}</span>
        <span className="badge badge--outline">{type}</span>
        <span className="stop__name">{name}</span>
        <span className="stop__spacer" />
        {grounding && (
          <span className={`badge ${grounding.pass ? 'badge--ok' : 'badge--warn'}`}>
            {!grounding.pass && <TriangleAlert size={11} />}
            grounding {fmtScore(grounding.value)}
          </span>
        )}
        <span className="stop__dur">{fmtSec(durationMs)}</span>
      </div>
      {url ? (
        <audio controls preload="none" src={url} style={{ marginTop: 11, width: '100%', height: 36 }} />
      ) : (
        !hasAudio && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--ink-3)' }}>no audio</div>
      )}
      {(script || notes.length > 0) && (
        <Disclosure label={notes.length > 0 ? `Script · ${notes.length} note${notes.length === 1 ? '' : 's'}` : 'Script'}>
          {script && <p className="script">{script}</p>}
          {notes.map((s) => <DimNote key={s.dimension} score={s} />)}
          <StopActions trackId={trackId} />
        </Disclosure>
      )}
    </div>
  )
}

function RunHistory({ runs, currentId }: { runs: EvalRunSummary[]; currentId?: string }) {
  return (
    <Disclosure label={`Run history · ${runs.length} eval${runs.length === 1 ? '' : 's'}`}>
      <div className="tablewrap" style={{ marginTop: 10 }}>
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Result</th>
              {['Grounding', 'Diversity', 'Charm', 'Veracity'].map((h) => (
                <th key={h} style={{ textAlign: 'right' }}>{h}</th>
              ))}
              <th>Model</th>
              <th>SHA</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={r.id} className={r.id === currentId ? 'is-active' : ''}>
                <td className="cell-dim" title={fmtDate(r.createdAt)}>
                  {i === 0 && <span className="badge badge--outline" style={{ marginRight: 6 }}>current</span>}
                  {timeAgo(r.createdAt)}
                </td>
                <td>
                  <span className="row-flex" style={{ gap: 6 }}>
                    <span className={`badge ${r.pass ? 'badge--ok' : 'badge--bad'}`}>
                      {r.pass ? <CircleCheck size={11} /> : <CircleX size={11} />}
                      {r.pass ? 'pass' : 'fail'}
                    </span>
                    {r.dryRun && <span className="badge badge--neutral">dry</span>}
                  </span>
                </td>
                {(['grounding', 'diversity', 'charm', 'veracity'] as const).map((k) => (
                  <td key={k} style={{ textAlign: 'right' }} className="cell-mono">
                    <span style={{ color: (r[k] ?? 0) < THRESHOLDS[k] ? 'var(--bad)' : undefined }}>
                      {fmtScore(r[k])}
                    </span>
                  </td>
                ))}
                <td className="cell-dim" style={{ fontSize: 12 }}>{r.narrationModel ?? '—'}</td>
                <td className="cell-mono cell-dim">{r.gitSha ? r.gitSha.slice(0, 7) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  )
}

export function TourDetailView() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<TourDetail | null>(null)
  const [signed, setSigned] = useState<SignResult | null>(null)
  const [runs, setRuns] = useState<EvalRunSummary[]>([])
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    api.tour(id).then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    api.sign(id).then(setSigned).catch(() => setSigned(null))
  }, [id])

  useEffect(() => {
    const slug = data?.tour.slug
    if (!slug) return
    api.evals(slug).then((r) => setRuns(r.runs)).catch(() => setRuns([]))
  }, [data?.tour.slug])

  if (err) return <div className="badge badge--bad" style={{ display: 'block', padding: '10px 14px', borderRadius: 'var(--radius)' }}>{err}</div>
  if (!data) return <div className="muted">Loading…</div>

  const { tour, region, stops, brackets, eval: ev } = data
  const urlForSeq = new Map(signed?.stops.map((s) => [s.seq, s.url]) ?? [])
  const groundingFor = (seq: number) =>
    ev?.scores.find((s) => s.seq === seq && s.dimension === 'grounding') ?? null
  const scoresForSeq = (seq: number) => ev?.scores.filter((s) => s.seq === seq) ?? []
  const intro = brackets.find((b) => b.kind === 'intro')
  const outro = brackets.find((b) => b.kind === 'outro')
  const failingStops = stops.filter((s) => { const g = groundingFor(s.seq); return g && !g.pass })

  // Integrity (§14.9): a READY tour must have audio on every stop + bracket and attribution on
  // every story stop. Computed from already-loaded data — the per-tour view of the fleet audit.
  const isEmptyAttr = (a: unknown) => a == null || (Array.isArray(a) && a.length === 0)
  const integrity = tour.status === 'ready'
    ? {
        silentStops: stops.filter((s) => !s.hasAudio).map((s) => s.seq),
        silentBrackets: brackets.filter((b) => !b.hasAudio).map((b) => b.kind),
        unattributed: stops.filter((s) => s.stopType === 'story' && isEmptyAttr(s.attribution)).map((s) => s.seq),
      }
    : null
  const integrityBroken =
    integrity != null &&
    (integrity.silentStops.length > 0 || integrity.silentBrackets.length > 0 || integrity.unattributed.length > 0)
  const stopPins: RouteStopPin[] = stops
    .filter((s) => s.triggerLat != null && s.triggerLng != null)
    .map((s) => ({ seq: s.seq, name: s.name, stopType: s.stopType, lat: s.triggerLat!, lng: s.triggerLng!, radiusM: s.triggerRadiusM }))

  return (
    <div>
      <button className="pill-link" onClick={() => navigate('/tours')} style={{ marginBottom: 14 }}>
        <ChevronRight size={13} style={{ transform: 'rotate(180deg)' }} />
        Tours
      </button>

      <div className="pagehead">
        <div>
          <div className="wrap-flex" style={{ gap: 11 }}>
            <h1 className="pagehead__title">{tour.headline}</h1>
            <span className={STATUS_BADGE[tour.status] ?? 'badge badge--neutral'}>{tour.status}</span>
            <span className="tag">{tour.slug}</span>
          </div>
          {tour.summary && <p className="pagehead__desc">{tour.summary}</p>}
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            {region?.displayName} · {tour.startAnchor.name} → {tour.endAnchor.name} · {fmtMiles(tour.distanceMeters)} · {fmtDuration(tour.durationSeconds)}
          </p>
        </div>
        <div className="pagehead__actions" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div className="row-flex" style={{ gap: 8 }}>
            <button className="btn btn--default btn--sm" onClick={() => navigate('/runs')}>
              <RefreshCw size={13} />
              Resynth
            </button>
          </div>
        </div>
      </div>

      {integrityBroken && integrity && (
        <div className="dangerzone dangerzone--del" style={{ marginBottom: 'var(--gap)' }}>
          <div className="dangerzone__title"><TriangleAlert size={14} /> Integrity — this ready tour is broken</div>
          <div className="dangerzone__body">
            A <b>ready</b> tour must have audio on every stop and bracket, and attribution on every story stop.
            {integrity.silentStops.length > 0 && <> Stops with no audio: <b>{integrity.silentStops.join(', ')}</b>.</>}
            {integrity.silentBrackets.length > 0 && <> Brackets with no audio: <b>{integrity.silentBrackets.join(', ')}</b>.</>}
            {integrity.unattributed.length > 0 && <> Story stops missing CC BY-SA attribution: <b>{integrity.unattributed.join(', ')}</b>.</>}
            {' '}Re-run generate or resynth, or flip the status off ready.
          </div>
        </div>
      )}

      {tour.polyline.length > 1 && (
        <div className="card" style={{ marginBottom: 'var(--gap)', overflow: 'hidden' }}>
          <div className="card__head">
            <span className="card__title">Route</span>
            <span className="muted card__more" style={{ fontSize: 12 }}>{stopPins.length} of {stops.length} stops placed</span>
          </div>
          <RouteMap polyline={tour.polyline} start={tour.startAnchor} end={tour.endAnchor} stops={stopPins} />
          <div className="row-flex" style={{ padding: '10px 16px', gap: 14 }}>
            <LegendDot color="#10b981" label="Start" />
            <LegendDot color="#ef4444" label="End" />
            <LegendDot color={STOP_TYPE_COLOR.story} label="story" />
            <LegendDot color={STOP_TYPE_COLOR.scenic} label="scenic" />
            <LegendDot color={STOP_TYPE_COLOR.break} label="break" />
          </div>
        </div>
      )}

      {ev && (
        <div className="card" style={{ marginBottom: 'var(--gap)' }}>
          <div className="card__head">
            <span className="card__title">Latest evaluation</span>
            <span className={`badge ${ev.pass ? 'badge--ok' : 'badge--bad'}`}>
              {ev.pass ? <CircleCheck size={11} /> : <CircleX size={11} />}
              {ev.pass ? 'pass' : 'fail'}
            </span>
            {failingStops.length > 0 && (
              <span className="badge badge--warn">{failingStops.length} stop below bar</span>
            )}
            <span className="card__more muted" style={{ fontSize: 12 }}>
              {ev.narrationModel} · {timeAgo(ev.createdAt)}
            </span>
          </div>
          <div className="scoregrid">
            {DIMS.map(([k, label]) => (
              <ScoreCell
                key={k}
                label={label}
                value={ev[k as keyof typeof ev] as number | null}
                threshold={THRESHOLDS[k]}
              />
            ))}
          </div>
        </div>
      )}

      {runs.length > 0 && <RunHistory runs={runs} currentId={ev?.id} />}

      <div className="seclabel" style={{ marginTop: 26, display: 'flex', justifyContent: 'space-between' }}>
        <span>Itinerary · {stops.length} stops</span>
      </div>
      <div className="itin">
        {intro && <BracketRow kind="intro" b={intro} url={signed?.intro?.url} />}
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
        {outro && <BracketRow kind="outro" b={outro} url={signed?.outro?.url} />}
      </div>
    </div>
  )
}
