import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, Check, Map, Plus, Search, Sparkles, TriangleAlert } from 'lucide-react'
import { api, type IntegrityReport, type TourCard } from '@/lib/api'
import { fmtDuration, fmtMiles, timeAgo } from '@/lib/format'

type SortKey = 'headline' | 'regionName' | 'status' | 'stops' | 'distanceMeters' | 'durationSeconds' | 'eval' | 'updatedAt'

type TourCardEx = TourCard & {
  eval?: { pass: boolean; grounding: number } | null
}

const STATUS_FILTER = ['all', 'ready', 'draft', 'failed', 'generating'] as const
type StatusFilter = (typeof STATUS_FILTER)[number]

const STATUS_BADGE: Record<string, string> = {
  ready: 'badge badge--ok',
  draft: 'badge badge--neutral',
  generating: 'badge badge--run',
  failed: 'badge badge--bad',
}

function EvalCell({ ev }: { ev?: TourCardEx['eval'] }) {
  if (!ev) return <span className="muted">—</span>
  return (
    <span className="row-flex" style={{ gap: 7 }}>
      <span className={`badge ${ev.pass ? 'badge--ok' : 'badge--bad'}`}>
        {ev.pass ? <Check size={11} /> : <TriangleAlert size={11} />}
        {ev.pass ? 'pass' : 'fail'}
      </span>
      <span className="cell-mono" style={{ color: ev.pass ? 'var(--ink-3)' : 'var(--bad)', fontSize: 11.5 }}>
        g {ev.grounding.toFixed(2)}
      </span>
    </span>
  )
}

function Th({
  sortKey,
  current,
  dir,
  onSort,
  right,
  children,
}: {
  sortKey: SortKey
  current: SortKey
  dir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
  right?: boolean
  children: React.ReactNode
}) {
  const active = current === sortKey
  return (
    <th
      className={`sortable${active ? ' is-sorted' : ''}`}
      onClick={() => onSort(sortKey)}
      style={right ? { textAlign: 'right' } : undefined}
    >
      <span className="th-sort" style={right ? { flexDirection: 'row-reverse' } : undefined}>
        {children}
        <span className="th-arrow">
          {active && dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
        </span>
      </span>
    </th>
  )
}

export function ToursView() {
  const navigate = useNavigate()
  const [tours, setTours] = useState<TourCardEx[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [region, setRegion] = useState('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'updatedAt', dir: 'desc' })
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null)

  useEffect(() => {
    api
      .tours()
      .then((r) => setTours(r.tours as TourCardEx[]))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
    api.integrity().then(setIntegrity).catch(() => {})
  }, [])

  const brokenIds = useMemo(() => new Set(integrity?.tours.map((t) => t.id) ?? []), [integrity])
  const draftSlugs = useMemo(() => tours.filter((t) => t.status === 'draft').map((t) => t.slug), [tours])

  // Fire a real (spending) generate for one or all draft shells, then jump to Runs to watch.
  // The cold-start path after a reset — turns reseeded draft shells into ready tours.
  async function generate(slugs: string[]) {
    if (slugs.length === 0) return
    if (!window.confirm(`Generate ${slugs.length} tour${slugs.length > 1 ? 's' : ''}? This spends LLM + TTS credits.`)) return
    try {
      for (const slug of slugs) await api.createJob({ kind: 'generate', slug, dryRun: false, maxCostUsd: 5, confirm: true })
      navigate('/runs')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const regions = useMemo(() => {
    const seen = new Set<string>()
    return tours.filter((t) => (seen.has(t.regionName) ? false : (seen.add(t.regionName), true)))
  }, [tours])

  const onSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))

  const view = useMemo(() => {
    let rows = tours.filter((t) => {
      if (region !== 'all' && t.regionName !== region) return false
      if (status !== 'all' && t.status !== status) return false
      if (q) {
        const s = `${t.headline} ${t.slug} ${t.regionName}`.toLowerCase()
        if (!s.includes(q.toLowerCase())) return false
      }
      return true
    })
    const dir = sort.dir === 'asc' ? 1 : -1
    const val = (t: TourCardEx) => {
      switch (sort.key) {
        case 'headline': return t.headline.toLowerCase()
        case 'regionName': return t.regionName.toLowerCase()
        case 'status': return t.status
        case 'stops': return t.stops
        case 'distanceMeters': return t.distanceMeters ?? -1
        case 'durationSeconds': return t.durationSeconds ?? -1
        case 'eval': return t.eval ? (t.eval.pass ? 2 : 1) : 0
        default: return t.updatedAt
      }
    }
    return [...rows].sort((a, b) => (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0))
  }, [tours, region, status, q, sort])

  const countFor = (s: StatusFilter) =>
    s === 'all' ? tours.length : tours.filter((t) => t.status === s).length

  return (
    <div>
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">Tours</h1>
          <p className="pagehead__desc">The whole catalog — drafts included. Evals that fall below the bar are flagged in red.</p>
        </div>
        <div className="pagehead__actions" style={{ gap: 8 }}>
          {draftSlugs.length > 0 && (
            <button className="btn btn--default" onClick={() => generate(draftSlugs)}>
              <Sparkles size={15} />
              Generate all drafts ({draftSlugs.length})
            </button>
          )}
          <Link to="/create" className="btn btn--primary">
            <Plus size={15} />
            Create tour
          </Link>
        </div>
      </div>

      {err && (
        <div className="badge badge--bad" style={{ display: 'block', marginBottom: 14, padding: '10px 14px', borderRadius: 'var(--radius)' }}>
          {err}
        </div>
      )}

      {integrity && integrity.tours.length > 0 && (
        <div className="dangerzone dangerzone--del" style={{ marginBottom: 14 }}>
          <div className="dangerzone__title">
            <TriangleAlert size={14} /> {integrity.tours.length} ready tour{integrity.tours.length === 1 ? '' : 's'} failing the integrity check
          </div>
          <div className="dangerzone__body">
            A <b>ready</b> tour must have audio on every stop + bracket and CC BY-SA attribution on every story stop.{' '}
            {integrity.tours.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ', '}
                <Link to={`/tours/${t.id}`} className="row-link">{t.slug}</Link>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="toolbar">
        <div className="search">
          <Search size={15} />
          <input
            placeholder="Search tours, slugs, regions…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="segment">
          {(['all', 'ready', 'draft', 'failed'] as StatusFilter[]).map((v) => (
            <button key={v} className={status === v ? 'is-on' : ''} onClick={() => setStatus(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
              <span className="seg-count">{countFor(v)}</span>
            </button>
          ))}
        </div>
        <div className="selectbox">
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="all">All regions</option>
            {regions.map((r) => (
              <option key={r.regionSlug} value={r.regionName}>{r.regionName}</option>
            ))}
          </select>
        </div>
        <span className="toolbar__spacer" />
        <span className="toolbar__count">{view.length} of {tours.length}</span>
      </div>

      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <Th sortKey="headline" current={sort.key} dir={sort.dir} onSort={onSort}>Tour</Th>
              <Th sortKey="regionName" current={sort.key} dir={sort.dir} onSort={onSort}>Region</Th>
              <Th sortKey="status" current={sort.key} dir={sort.dir} onSort={onSort}>Status</Th>
              <Th sortKey="eval" current={sort.key} dir={sort.dir} onSort={onSort}>Eval</Th>
              <Th sortKey="stops" current={sort.key} dir={sort.dir} onSort={onSort} right>Stops</Th>
              <Th sortKey="distanceMeters" current={sort.key} dir={sort.dir} onSort={onSort} right>Distance</Th>
              <Th sortKey="durationSeconds" current={sort.key} dir={sort.dir} onSort={onSort} right>Duration</Th>
              <Th sortKey="updatedAt" current={sort.key} dir={sort.dir} onSort={onSort} right>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {view.map((t) => (
              <tr key={t.id} className="clickable" onClick={() => navigate(`/tours/${t.id}`)}>
                <td>
                  <div className="cell-strong row-link">{t.headline}</div>
                  <div className="cell-sub">
                    {t.slug}
                    {t.authored === 'seed' && <span style={{ marginLeft: 8, color: 'var(--ink-4)' }}>· seed</span>}
                  </div>
                </td>
                <td className="cell-dim">{t.regionName}</td>
                <td>
                  <span className="row-flex" style={{ gap: 6 }}>
                    <span className={STATUS_BADGE[t.status] ?? 'badge badge--neutral'}>{t.status}</span>
                    {brokenIds.has(t.id) && (
                      <span className="badge badge--bad" title="Fails the audio/attribution integrity check">
                        <TriangleAlert size={11} /> integrity
                      </span>
                    )}
                    {t.status === 'draft' && (
                      <button
                        className="btn btn--default btn--sm"
                        onClick={(e) => { e.stopPropagation(); generate([t.slug]) }}
                        title="Generate this tour (spends credits)"
                      >
                        <Sparkles size={12} /> Generate
                      </button>
                    )}
                  </span>
                </td>
                <td><EvalCell ev={t.eval} /></td>
                <td style={{ textAlign: 'right' }} className="cell-mono">
                  {t.stops}
                  {t.brackets ? <span className="muted"> +{t.brackets}</span> : null}
                </td>
                <td style={{ textAlign: 'right' }} className="cell-mono cell-dim">{fmtMiles(t.distanceMeters)}</td>
                <td style={{ textAlign: 'right' }} className="cell-mono cell-dim">{fmtDuration(t.durationSeconds)}</td>
                <td style={{ textAlign: 'right' }} className="cell-dim" title={t.updatedAt}>{timeAgo(t.updatedAt)}</td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr>
                <td colSpan={8}>
                  <div className="empty">
                    <Map size={22} />
                    <div>No tours match these filters.</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
