import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Locate, MapPin, Plus, RefreshCw, Search, Trash2, Wrench } from 'lucide-react'
import { api, type CorrectionOverride, type PoiCorrections, type PoiRow, type RoamClipDetail } from '@/lib/api'
import { timeAgo } from '@/lib/format'

type Tab = 'corpus' | 'coverage' | 'retire'

const SOURCE_META: Record<string, { label: string; color: string }> = {
  wikidata: { label: 'Wikidata', color: 'var(--run)' },
  osm:      { label: 'OSM',      color: 'var(--ok)'  },
  manual:   { label: 'Manual',   color: 'var(--warn)' },
}

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

export function PoisView() {
  const [pois, setPois] = useState<PoiRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('corpus')

  useEffect(() => {
    api.pois()
      .then((r) => setPois(r.pois))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])

  const live = pois  // no retired field; all pois are live for now
  const flagged = pois.filter((p) => p.staleFacts || p.suspiciousDuration || (!p.attributed && p.tourCount > 0))
  const coverage = useMemo(() => buildCoverage(pois), [pois])

  const tabs: { id: Tab; label: string; count: number; alert?: boolean }[] = [
    { id: 'corpus',   label: 'Corpus',   count: live.length },
    { id: 'coverage', label: 'Coverage', count: coverage.length },
    { id: 'retire',   label: 'Retire',   count: flagged.length, alert: flagged.length > 0 },
  ]

  return (
    <div>
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">POIs</h1>
          <p className="pagehead__desc">The place corpus — sources, tour + roam usage, attribution, and region coverage for free-roam.</p>
        </div>
      </div>

      {err && (
        <div className="dangerzone dangerzone--del" style={{ marginBottom: 16 }}>
          <div className="dangerzone__title">Error loading POIs</div>
          <div className="dangerzone__body">{err}</div>
        </div>
      )}

      <div className="segment" style={{ marginBottom: 20 }}>
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
            <span className={`seg-count${t.alert ? ' is-alert' : ''}`}>{t.count}</span>
          </button>
        ))}
      </div>

      {tab === 'corpus'   && <CorpusTab pois={live} />}
      {tab === 'coverage' && <CoverageTab coverage={coverage} />}
      {tab === 'retire'   && <RetireTab flagged={flagged} />}
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

  useEffect(() => {
    setLoading(true)
    api.roamSign(poiId)
      .then((r) => setClip(r.clip))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [poiId])

  if (loading) return <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>Loading…</div>
  if (err) return <div style={{ fontSize: 12, color: 'var(--bad)', padding: '8px 0' }}>{err}</div>
  if (!clip) return null

  const durationSec = Math.round(clip.audioDurationMs / 1000)
  const mins = Math.floor(durationSec / 60)
  const secs = durationSec % 60
  const durLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  const wordCount = clip.script?.trim().split(/\s+/).filter(Boolean).length ?? 0
  const wpm = wordCount > 0 ? Math.round(wordCount / (clip.audioDurationMs / 1000 / 60)) : 0
  const suspicious = wpm > 0 && wpm < 90

  async function handleResynth() {
    if (!window.confirm(`Re-synthesize the roam clip for this POI? This spends ~$0.01 in TTS credits and replaces the current clip.`)) return
    setResynthing(true)
    try {
      const { job } = await api.createJob({ kind: 'resynth_roam_clip', poiId, apply: true, confirm: true })
      navigate(`/runs#${job.id}`)
    } catch (e) {
      alert(`Re-synth failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setResynthing(false)
    }
  }

  return (
    <div style={{ paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <audio controls preload="none" src={clip.url} style={{ width: '100%', height: 36 }} />
      <div style={{ fontSize: 12, color: 'var(--ink-3)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="cell-mono">{durLabel}</span>
        {wpm > 0 && (
          <span className={`cell-mono${suspicious ? '' : ''}`} style={{ color: suspicious ? 'var(--bad)' : 'var(--ink-4)' }}>
            {wpm} wpm{suspicious ? ' ⚠ suspicious' : ''}
          </span>
        )}
        {clip.factsHash && <span className="tag">{clip.factsHash.slice(0, 7)}</span>}
        <span style={{ flex: 1 }} />
        <button
          className="btn btn--default btn--sm"
          onClick={handleResynth}
          disabled={resynthing}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <RefreshCw size={12} />
          {resynthing ? 'Queuing…' : 'Re-synth clip'}
        </button>
      </div>
      {suspicious && (
        <div style={{ fontSize: 12, color: 'var(--bad)', background: 'var(--bad-bg)', padding: '6px 10px', borderRadius: 4 }}>
          Clip duration ({durLabel} for {wordCount} words) looks like a TTS duplicate-audio defect. Re-synth to fix.
        </div>
      )}
      <div style={{ fontSize: 12, color: 'var(--ink-2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
        {clip.script}
      </div>
    </div>
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
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [poiId])

  async function run(fn: () => Promise<PoiCorrections>) {
    setSaving(true)
    setErr(null)
    try {
      setData(await fn())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
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

  if (loading) return <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>Loading corrections…</div>

  const label = { display: 'block', fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase' as const, letterSpacing: '0.05em', fontWeight: 600, marginBottom: 4 }
  const input = { width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--ink-1)' }

  return (
    <div style={{ paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-2)', fontWeight: 600 }}>
        <Wrench size={13} /> Corrections
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5, background: 'var(--surface)', padding: '6px 10px', borderRadius: 4 }}>
        Corrections apply on the <strong>next generate / regeneration</strong> of a tour or roam (the generator loads
        these overrides + reads the speakable anchor fresh per run). They do <strong>not</strong> rewrite existing audio.
      </div>

      {err && (
        <div style={{ fontSize: 12, color: 'var(--bad)', background: 'var(--bad-bg)', padding: '6px 10px', borderRadius: 4 }}>{err}</div>
      )}

      {/* Existing fact-edits */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={label}>Fact edits</div>
        {data && data.overrides.length === 0 && (
          <div className="muted" style={{ fontSize: 12 }}>No corrections yet.</div>
        )}
        {data?.overrides.map((o: CorrectionOverride, i) => (
          <div
            key={`${o.find ?? '∅'}-${i}`}
            style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', borderRadius: 4, background: 'var(--surface)', opacity: o.active ? 1 : 0.6 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: 'var(--ink-1)', wordBreak: 'break-word' }}>
                <code className="mono" style={{ fontSize: 11.5 }}>{o.find ?? '∅'}</code>
                <span style={{ color: 'var(--ink-4)', margin: '0 6px' }}>→</span>
                <code className="mono" style={{ fontSize: 11.5 }}>{o.replace === '' ? '(deleted)' : o.replace ?? '∅'}</code>
                {!o.active && <span className="tag" style={{ marginLeft: 8 }}>retired</span>}
                {o.upstreamStatus !== 'not_filed' && <span className="tag" style={{ marginLeft: 6 }}>{o.upstreamStatus}</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 3 }}>{o.reason}</div>
              {o.sourceUrl && (
                <a href={o.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: 'var(--run)', wordBreak: 'break-all' }}>{o.sourceUrl}</a>
              )}
            </div>
            {o.active && o.find && (
              <button className="btn btn--ghost btn--sm" disabled={saving} onClick={() => retire(o.find!)} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <Trash2 size={12} /> Retire
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add correction */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 4, border: '1px dashed var(--border)' }}>
        <div style={label}>Add correction</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={{ ...label, textTransform: 'none', letterSpacing: 0 }}>Find (exact substring)</label>
            <input style={input} value={find} onChange={(e) => setFind(e.target.value)} placeholder="Leonard Palme" />
          </div>
          <div>
            <label style={{ ...label, textTransform: 'none', letterSpacing: 0 }}>Replace (blank = delete)</label>
            <input style={input} value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Lennart Palme" />
          </div>
        </div>
        <div>
          <label style={{ ...label, textTransform: 'none', letterSpacing: 0 }}>Reason *</label>
          <input style={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the source is wrong (required)" />
        </div>
        <div>
          <label style={{ ...label, textTransform: 'none', letterSpacing: 0 }}>Source URL (optional)</label>
          <input style={input} value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://… authoritative source for the fix" />
        </div>
        <div>
          <button className="btn btn--default btn--sm" disabled={saving} onClick={addCorrection} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Plus size={12} /> {saving ? 'Saving…' : 'Add correction'}
          </button>
        </div>
      </div>

      {/* Speakable anchor */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={label}>Speakable anchor</div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          The vantage point side-of-road content speaks from — only needed when the POI's own centroid is misleading.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Locate size={13} style={{ color: 'var(--ink-3)' }} />
          {data?.speakable
            ? <span className="cell-mono" style={{ fontSize: 12 }}>{data.speakable.lat.toFixed(5)}, {data.speakable.lng.toFixed(5)}</span>
            : <span className="muted" style={{ fontSize: 12 }}>not set — speaks from the POI pin</span>
          }
          {data?.speakable && (
            <button className="btn btn--ghost btn--sm" disabled={saving} onClick={clearSpeakable} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ width: 130 }}>
            <label style={{ ...label, textTransform: 'none', letterSpacing: 0 }}>Lat</label>
            <input style={input} value={lat} onChange={(e) => setLat(e.target.value)} placeholder="38.9540" inputMode="decimal" />
          </div>
          <div style={{ width: 130 }}>
            <label style={{ ...label, textTransform: 'none', letterSpacing: 0 }}>Lng</label>
            <input style={input} value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-120.0950" inputMode="decimal" />
          </div>
          <button className="btn btn--default btn--sm" disabled={saving} onClick={setSpeakable} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {saving ? 'Saving…' : 'Set anchor'}
          </button>
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
    <div>
      <div className="wrap-flex" style={{ marginBottom: 16, gap: 10 }}>
        <span className="badge badge--neutral">{totals.total} total</span>
        <span className="badge badge--run">{totals.withClips} with roam clips</span>
        <span className="badge badge--ok">{totals.inTours} in tours</span>
        {totals.unattrib > 0 && (
          <span className="badge badge--bad">
            <span className="badge__dot" />
            {totals.unattrib} unattributed
          </span>
        )}
        {totals.defects > 0 && (
          <span className="badge badge--bad" style={{ cursor: 'pointer' }} onClick={() => setFlags('defect')}>
            <span className="badge__dot" />
            {totals.defects} clip defect{totals.defects > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="toolbar">
        <div className="search">
          <Search size={15} />
          <input placeholder="Search name, source id…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="selectbox">
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="all">All regions</option>
            {regions.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}
          </select>
        </div>
        <div className="selectbox">
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">All sources</option>
            <option value="wikidata">Wikidata</option>
            <option value="osm">OSM</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <div className="selectbox">
          <select value={flags} onChange={(e) => setFlags(e.target.value)}>
            <option value="all">All flags</option>
            <option value="defect">⚠ Clip defects</option>
            <option value="stale">Stale facts</option>
            <option value="unattrib">Unattributed</option>
          </select>
        </div>
        <span className="toolbar__spacer" />
        <span className="toolbar__count">{filtered.length} of {pois.length}</span>
      </div>

      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 28 }} />
              <th>Name</th>
              <th>Source</th>
              <th>Region</th>
              <th style={{ textAlign: 'right' }}>Tours</th>
              <th style={{ textAlign: 'right' }}>Roam clips</th>
              <th>Attribution</th>
              <th>Facts hash</th>
              <th style={{ textAlign: 'right' }}>Added</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const sm = SOURCE_META[p.source]
              const isOpen = expanded === p.id
              const toggleExpand = () => setExpanded(isOpen ? null : p.id)
              return (
                <>
                  <tr key={p.id}>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={toggleExpand}
                        aria-label={isOpen ? 'Collapse' : 'Expand'}
                        style={{ display: 'inline-flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)', padding: 0 }}
                      >
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    </td>
                    <td>
                      <div className="cell-strong" style={{ cursor: 'pointer' }} onClick={toggleExpand}>{p.name}</div>
                      {(p.staleFacts || p.suspiciousDuration) && (
                        <div style={{ marginTop: 2, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {p.staleFacts && <span className="badge badge--warn" style={{ fontSize: 10.5 }}>stale facts</span>}
                          {p.suspiciousDuration && <span className="badge badge--bad" style={{ fontSize: 10.5 }}>⚠ clip defect</span>}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: sm?.color ?? 'var(--ink-4)', flexShrink: 0 }} />
                        <span className="cell-dim">{sm?.label ?? p.source}</span>
                        <span className="tag">{p.sourceId}</span>
                      </span>
                    </td>
                    <td className="cell-dim">{p.regionName ?? <span className="muted">—</span>}</td>
                    <td style={{ textAlign: 'right' }} className="cell-mono">
                      {p.tourCount > 0 ? p.tourCount : <span className="muted">—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }} className="cell-mono">
                      {p.roamClipCount > 0
                        ? <span style={{ color: 'var(--run)' }}>{p.roamClipCount}</span>
                        : <span className="muted">—</span>
                      }
                    </td>
                    <td>
                      {p.tourCount > 0
                        ? <span className={`badge ${p.attributed ? 'badge--ok' : 'badge--bad'}`}>{p.attributed ? '✓' : 'missing'}</span>
                        : <span className="muted">n/a</span>
                      }
                    </td>
                    <td className="cell-mono cell-dim">
                      {p.factsHash ? p.factsHash.slice(0, 7) : <span className="muted">—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }} className="cell-dim">{timeAgo(p.createdAt)}</td>
                  </tr>
                  {isOpen && (
                    <tr key={`${p.id}-detail`}>
                      <td colSpan={9} style={{ paddingTop: 0, paddingBottom: 12, background: 'var(--surface-2)' }}>
                        {p.roamClipCount > 0 && <RoamPlayer poiId={p.id} />}
                        <Corrections poiId={p.id} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9}>
                  <div className="empty">
                    <Search size={22} />
                    <div>No POIs match these filters.</div>
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

/* ── COVERAGE ── */

const DENSITY_META = {
  ok:     { variant: 'badge--ok',      label: 'Roam-ready',  desc: '≥5 clips, ≥50% coverage' },
  thin:   { variant: 'badge--warn',    label: 'Thin',        desc: '2+ clips — below the roam bar' },
  sparse: { variant: 'badge--neutral', label: 'Sparse',      desc: 'Not enough for the ambient contract' },
}

function CoverageTab({ coverage }: { coverage: RegionCoverage[] }) {
  if (coverage.length === 0) {
    return (
      <div className="empty">
        <MapPin size={22} />
        <div>No regions with POI data yet.</div>
      </div>
    )
  }

  const maxTotal = Math.max(...coverage.map((r) => r.total), 1)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <p className="muted" style={{ fontSize: 13, marginBottom: 4 }}>
        Per-region density for free-roam eligibility — a region qualifies when its main roads offer an encounter within ~5 minutes at typical speeds.
      </p>
      {coverage.map((r) => {
        const m = DENSITY_META[r.density]
        const clipPct = r.total > 0 ? (r.withClips / r.total) * 100 : 0
        const totalPct = (r.total / maxTotal) * 100

        return (
          <div key={r.regionSlug} className="card" style={{ padding: '14px 16px' }}>
            <div className="row-flex" style={{ marginBottom: 10 }}>
              <span className="card__title" style={{ flex: 1 }}>{r.regionName}</span>
              <span className={`badge ${m.variant}`}>{m.label}</span>
              {r.roamReady && <span className="badge badge--ok">Roam enabled</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
              <CoverageStat label="Total POIs" value={r.total} />
              <CoverageStat label="With roam clips" value={r.withClips} dim={r.withClips === 0} />
              <CoverageStat label="Coverage" value={r.withClips > 0 ? `${Math.round(clipPct)}%` : '—'} dim={r.withClips === 0} />
            </div>
            <div>
              <div style={{ height: 6, background: 'var(--bar-track)', borderRadius: 3, overflow: 'hidden', position: 'relative', marginBottom: 4 }}>
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${totalPct}%`, background: 'var(--border-strong)', borderRadius: 3 }} />
                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${clipPct}%`, background: r.roamReady ? 'var(--ok)' : r.density === 'thin' ? 'var(--warn)' : 'var(--neutral)', borderRadius: 3 }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--mono)' }}>{m.desc}</div>
            </div>
            {!r.roamReady && (
              <div style={{ marginTop: 10 }}>
                <button
                  className="btn btn--default btn--sm"
                  onClick={() => alert(`New run → generate_roam --bbox=<${r.regionName} bbox>`)}
                >
                  Run generate_roam (dry-run)
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function CoverageStat({ label, value, dim }: { label: string; value: string | number; dim?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600, marginBottom: 3 }}>
        {label}
      </div>
      <div className={`mono ${dim ? 'muted' : 'cell-strong'}`} style={{ fontSize: 18, letterSpacing: '-0.02em' }}>
        {value}
      </div>
    </div>
  )
}

/* ── RETIRE ── */

function RetireTab({ flagged }: { flagged: PoiRow[] }) {
  if (flagged.length === 0) {
    return (
      <div className="empty">
        <span style={{ color: 'var(--ok)', fontSize: 22 }}>✓</span>
        <div>No flagged POIs — corpus is clean.</div>
      </div>
    )
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16 }}>
        Flagged POIs — stale facts need a re-fetch or retire; unattributed story stops violate CC BY-SA.
        Retire removes the DB record; run <code className="mono" style={{ fontSize: 11 }}>sweep_roam_pois</code> afterward to purge R2 clips.
      </p>
      <div className="itin">
        {flagged.map((p) => {
          const tone = p.staleFacts ? 'badge--warn' : 'badge--bad'
          const label = p.staleFacts ? 'Stale facts' : 'Unattributed'
          const desc = p.staleFacts ? 'factsHash changed — re-fetch or retire' : 'story stop missing CC BY-SA attribution'
          return (
            <div key={p.id} className="stop" style={{ background: p.staleFacts ? 'var(--warn-bg)' : 'var(--bad-bg)' }}>
              <div className="stop__row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row-flex" style={{ gap: 8, marginBottom: 3 }}>
                    <span className="stop__name">{p.name}</span>
                    <span className={`badge ${tone}`}>{label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    <span className="tag">{p.sourceId}</span>
                    {p.regionName && <span style={{ marginLeft: 6 }}>{p.regionName}</span>}
                    <span style={{ marginLeft: 6 }}>{desc}</span>
                    {p.roamClipCount > 0 && (
                      <span style={{ marginLeft: 8, color: 'var(--warn)' }}>
                        {p.roamClipCount} roam clip{p.roamClipCount > 1 ? 's' : ''} to sweep
                      </span>
                    )}
                  </div>
                </div>
                <div className="row-flex" style={{ gap: 8 }}>
                  {p.staleFacts && (
                    <button className="btn btn--default btn--sm" onClick={() => alert(`Re-fetch facts for ${p.id}`)}>
                      <RefreshCw size={13} /> Re-fetch
                    </button>
                  )}
                  <button className="btn btn--ghost btn--sm" onClick={() => alert(`Retire ${p.id}`)}>
                    <Trash2 size={13} /> Retire
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
