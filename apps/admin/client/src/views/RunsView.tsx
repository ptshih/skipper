import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity, CircleCheck, CircleX, DollarSign,
  ExternalLink, Filter, Map, RefreshCw, Scissors, Search, Sparkles, Trash2, X, Zap,
} from 'lucide-react'
import {
  api, ApiError,
  type GenJob, type JobKind, type JobStatus, type RunEvent,
} from '@/lib/api'
import { fmtCost, fmtDate, timeAgo } from '@/lib/format'

/* ─── constants ─── */

const KIND_META: Record<string, { label: string; icon: React.ElementType; desc: string; spends: 'spend' | 'delete' | 'free' }> = {
  generate:        { label: 'Generate',        icon: Sparkles,   desc: 'Script + synthesize a tour from scratch.',           spends: 'spend'  },
  resynth:         { label: 'Resynth',          icon: RefreshCw,  desc: 'Re-voice every clip of an existing tour.',           spends: 'spend'  },
  patch_clip:      { label: 'Patch clip',       icon: Scissors,   desc: "Find/replace in one stop's script + re-synth it.",   spends: 'spend'  },
  sweep_orphans:   { label: 'Sweep orphans',    icon: Trash2,     desc: 'Delete R2 clips with no stop reference.',            spends: 'delete' },
  sweep_roam_pois: { label: 'Sweep roam POIs',  icon: Filter,     desc: 'Fetch + upsert roam POIs for a bbox (free).',        spends: 'free'   },
  generate_roam:   { label: 'Generate roam',    icon: Zap,        desc: 'Narrate + synthesize roam clips for the corpus.',    spends: 'spend'  },
}

const JOB_STATUS_CLASS: Record<JobStatus, string> = {
  succeeded: 'badge--ok',
  failed:    'badge--bad',
  running:   'badge--run',
  queued:    'badge--neutral',
  canceled:  'badge--neutral',
}

/* ─── main view ─── */

export function RunsView() {
  const [runs, setRuns] = useState<RunEvent[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [src, setSrc] = useState<'all' | 'job' | 'eval'>('all')
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [q, setQ] = useState('')
  const [drawerRun, setDrawerRun] = useState<RunEvent | null>(null)
  const [newRunOpen, setNewRunOpen] = useState(false)

  const refresh = async () => {
    try {
      setRuns((await api.runs()).runs)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 15000)
    return () => clearInterval(t)
  }, [])

  const filtered = useMemo(() => runs.filter((r) => {
    if (src !== 'all' && r.source !== src) return false
    if (kindFilter !== 'all' && r.kind !== kindFilter) return false
    if (statusFilter !== 'all') {
      if (statusFilter === 'running') return r.status === 'running' || r.status === 'queued'
      if (statusFilter === 'failed')  return r.status === 'failed' || r.pass === false
      if (statusFilter === 'ok')      return r.status === 'succeeded' || r.pass === true
    }
    if (q) {
      const s = `${r.slug ?? ''} ${r.kind} ${r.id}`.toLowerCase()
      if (!s.includes(q.toLowerCase())) return false
    }
    return true
  }), [runs, src, kindFilter, statusFilter, q])

  const runningN    = runs.filter((r) => r.status === 'running').length
  const failedN     = runs.filter((r) => r.status === 'failed' || r.pass === false).length
  const todaySpend  = runs
    .filter((r) => r.createdAt?.slice(0, 10) === new Date().toISOString().slice(0, 10))
    .reduce((a, r) => a + (r.costUsd ?? 0), 0)

  const srcCounts = {
    all:  runs.length,
    job:  runs.filter((r) => r.source === 'job').length,
    eval: runs.filter((r) => r.source === 'eval').length,
  }

  return (
    <div>
      <div className="pagehead">
        <div>
          <h1 className="pagehead__title">Runs</h1>
          <p className="pagehead__desc">Every run on one timeline — admin-triggered Cloud Run jobs and the eval history behind them. Click a row for details.</p>
        </div>
        <div className="pagehead__actions">
          <button className="btn btn--primary" onClick={() => setNewRunOpen(true)}>
            <Activity size={15} /> New run…
          </button>
        </div>
      </div>

      {err && (
        <div className="dangerzone dangerzone--del" style={{ marginBottom: 16 }}>
          <div className="dangerzone__title"><CircleX size={14} /> Error loading runs</div>
          <div className="dangerzone__body">{err}</div>
        </div>
      )}

      {/* summary chips */}
      <div className="wrap-flex" style={{ marginBottom: 16, gap: 10 }}>
        <span style={{ cursor: 'pointer' }} onClick={() => { setSrc('all'); setStatusFilter('running') }}>
          <span className={`badge ${runningN ? 'badge--run' : 'badge--neutral'}`}>
            {runningN > 0 && <span className="badge__dot" />}
            {runningN} running
          </span>
        </span>
        <span style={{ cursor: 'pointer' }} onClick={() => { setSrc('all'); setStatusFilter('failed') }}>
          <span className="badge badge--bad">{failedN} failed</span>
        </span>
        <span className="badge badge--warn"><DollarSign size={11} />{fmtCost(todaySpend)} today</span>
        <span style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 12 }}>auto-refresh · 15s</span>
      </div>

      <div className="toolbar">
        <div className="search">
          <Search size={15} />
          <input placeholder="Search slug, kind, id…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="segment">
          {(['all', 'job', 'eval'] as const).map((v) => (
            <button key={v} className={src === v ? 'is-on' : ''} onClick={() => setSrc(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
              <span className="seg-count">{srcCounts[v]}</span>
            </button>
          ))}
        </div>
        <div className="selectbox">
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="all">All kinds</option>
            {Object.entries(KIND_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
          </select>
        </div>
        <div className="selectbox">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Any result</option>
            <option value="running">Running / queued</option>
            <option value="ok">Succeeded / pass</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <span className="toolbar__spacer" />
        <span className="toolbar__count">{filtered.length} of {runs.length}</span>
      </div>

      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Target</th>
              <th>Result</th>
              <th>Mode</th>
              <th>Cost</th>
              <th>Detail</th>
              <th style={{ textAlign: 'right' }}>When</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const km = KIND_META[r.kind]
              const Icon = km?.icon ?? Activity
              return (
                <tr
                  key={`${r.source}:${r.id}`}
                  className={`clickable${r.status === 'running' ? ' row-live' : ''}`}
                  onClick={() => setDrawerRun(r)}
                >
                  <td>
                    <div className="row-flex">
                      <span className="leader" style={{ width: 26, height: 26, borderRadius: 6 }}>
                        <Icon size={13} />
                      </span>
                      <div>
                        <div className="cell-strong">{km?.label ?? r.kind}</div>
                        <div className="cell-sub">{r.source === 'job' ? r.id : r.id}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    {r.slug
                      ? <span className="row-link" onClick={(e) => { e.stopPropagation(); if (r.tourId) window.__go?.('tour', r.tourId) }}>{r.slug}</span>
                      : <span className="muted">—</span>
                    }
                  </td>
                  <td><RunResultCell r={r} /></td>
                  <td>
                    {r.dryRun
                      ? <span className="badge badge--neutral">dry-run</span>
                      : r.source === 'eval'
                        ? <span className="muted">—</span>
                        : <span className="badge badge--warn">spend</span>
                    }
                  </td>
                  <td className="cell-mono">{fmtCost(r.costUsd)}</td>
                  <td className="cell-dim" style={{ fontSize: 12 }}>
                    {r.source === 'job'
                      ? (r.triggeredBy ?? '—')
                      : <span className="row-flex" style={{ gap: 6 }}>
                          {r.narrationModel}
                          {r.gitSha && <span className="tag">{r.gitSha.slice(0, 7)}</span>}
                        </span>
                    }
                  </td>
                  <td style={{ textAlign: 'right' }} className="cell-dim" title={fmtDate(r.createdAt)}>
                    {timeAgo(r.createdAt)}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7}>
                <div className="empty"><Search size={22} /><div>No runs match these filters.</div></div>
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {drawerRun && (
        <RunDrawer run={drawerRun} onClose={() => setDrawerRun(null)} onChanged={() => void refresh()} />
      )}
      {newRunOpen && (
        <NewRunModal onClose={() => setNewRunOpen(false)} onSubmitted={() => { setNewRunOpen(false); void refresh() }} />
      )}
    </div>
  )
}

function RunResultCell({ r }: { r: RunEvent }) {
  if (r.source === 'job') {
    if (!r.status) return <span className="muted">—</span>
    const cls = JOB_STATUS_CLASS[r.status] ?? 'badge--neutral'
    const label = r.status === 'running' && r.phase
      ? `running · ${r.phase.split('·')[1]?.trim() ?? ''}`.replace(/·\s*$/, '').trim()
      : r.status
    return (
      <span className={`badge ${cls}`}>
        {(r.status === 'running' || r.status === 'queued') && <span className="badge__dot" />}
        {label}
      </span>
    )
  }
  return (
    <span className="row-flex" style={{ gap: 7 }}>
      <span className={`badge ${r.pass ? 'badge--ok' : 'badge--bad'}`}>
        {r.pass ? 'pass' : 'fail'}
      </span>
      {r.grounding != null && (
        <span className="cell-mono" style={{ color: r.grounding < 0.75 ? 'var(--bad)' : 'var(--ink-3)' }}>
          g {r.grounding.toFixed(2)}
        </span>
      )}
    </span>
  )
}

/* ─── Run detail drawer ─── */

function RunDrawer({ run, onClose, onChanged }: { run: RunEvent; onClose: () => void; onChanged?: () => void }) {
  const [job, setJob] = useState<GenJob | null>(null)
  const [logsUrl, setLogsUrl] = useState<string | null>(null)
  const [canceling, setCanceling] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [onClose])

  useEffect(() => {
    if (run.source === 'job') {
      api.job(run.id).then((r) => { setJob(r.job); setLogsUrl(r.logsUrl) }).catch(() => {})
    }
  }, [run.id, run.source])

  const km = KIND_META[run.kind]
  const Icon = km?.icon ?? Activity
  const isJob = run.source === 'job'
  const status = (job?.status ?? run.status) as JobStatus | null
  const cancelable = isJob && (status === 'running' || status === 'queued')
  // 'canceled by operator' is the server's marker — not a failure, so don't paint it red.
  const error = status === 'failed' ? job?.error : null
  const args = job?.args

  async function cancel() {
    setCanceling(true)
    try {
      const r = await api.cancelJob(run.id)
      setJob(r.job)
      onChanged?.()
    } catch (e) {
      // surface inline via the job error block on next poll; keep the drawer open
      console.error('cancel failed', e)
    } finally {
      setCanceling(false)
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal>
        <div className="drawer__head">
          <div style={{ minWidth: 0 }}>
            <div className="row-flex">
              <span className="drawer__title">{km?.label ?? run.kind}</span>
              {isJob && status && (
                <span className={`badge ${JOB_STATUS_CLASS[status] ?? 'badge--neutral'}`}>
                  {(status === 'running' || status === 'queued') && <span className="badge__dot" />}
                  {status}
                </span>
              )}
              {!isJob && run.pass != null && (
                <span className={`badge ${run.pass ? 'badge--ok' : 'badge--bad'}`}>
                  {run.pass ? 'pass' : 'fail'}
                </span>
              )}
            </div>
            {run.slug && <div className="drawer__sub">{run.slug}</div>}
          </div>
          <button className="iconbtn drawer__close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="drawer__body">
          {error && (
            <div className="dangerzone dangerzone--del" style={{ marginBottom: 18 }}>
              <div className="dangerzone__title"><CircleX size={15} /> Run failed</div>
              <div className="dangerzone__body">{error}</div>
            </div>
          )}

          <div className="seclabel">Details</div>
          <dl className="deflist">
            <dt>Kind</dt><dd className="row-flex"><Icon size={13} /> {km?.label ?? run.kind}</dd>
            {run.slug && <><dt>Target</dt><dd className="mono">{run.slug}</dd></>}
            <dt>Mode</dt>
            <dd>{run.dryRun
              ? <span className="badge badge--neutral">dry-run</span>
              : isJob
                ? <span className="badge badge--warn">spend</span>
                : '—'
            }</dd>
            <dt>Cost</dt><dd className="mono">{fmtCost(run.costUsd)}</dd>
            {isJob && <><dt>Triggered by</dt><dd className="mono">{run.triggeredBy ?? '—'}</dd></>}
            {!isJob && <><dt>Model</dt><dd className="mono">{run.narrationModel ?? '—'}</dd></>}
            {job?.cloudRunExecution && (
              <><dt>Execution</dt><dd className="mono" style={{ wordBreak: 'break-all' }}>{job.cloudRunExecution}</dd></>
            )}
            {!isJob && run.gitSha && <><dt>Commit</dt><dd className="mono">{run.gitSha.slice(0, 7)}</dd></>}
            <dt>Started</dt><dd className="mono">{fmtDate(run.createdAt)}</dd>
            {job?.startedAt && <><dt>Ended</dt><dd className="mono">{fmtDate(job.endedAt)}</dd></>}
          </dl>

          {args && args.length > 0 && (
            <>
              <div className="seclabel">Command</div>
              <div className="logblock">
                <span className="lg-dim">$ skipper-gen {run.kind} </span>{args.join(' ')}
              </div>
            </>
          )}

          {/* Output summary + raw log (succeeded jobs with captured output) */}
          {isJob && (
            <>
              <div className="seclabel">Summary</div>
              <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--ink)' }}>
                {job?.outputSummary ?? <span className="muted">Available after the next succeeded run.</span>}
              </div>
              <div className="seclabel" style={{ marginTop: 14 }}>Metrics</div>
              <div className="logblock" style={{ fontSize: 12 }}>
                {job?.outputData && Object.keys(job.outputData).length > 0
                  ? JSON.stringify(job.outputData, null, 2)
                  : <span className="muted">—</span>}
              </div>
              <div className="seclabel" style={{ marginTop: 14 }}>
                Raw log
                {job?.outputLog && (
                  <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                    {job.outputLog.split('\n').length} lines
                  </span>
                )}
              </div>
              <div className="logblock" style={{ fontSize: 11, maxHeight: 320, overflowY: 'auto', whiteSpace: 'pre' }}>
                {job?.outputLog ?? <span className="muted">—</span>}
              </div>
            </>
          )}

          {/* Eval scores for eval-source runs */}
          {!isJob && run.grounding != null && (
            <>
              <div className="seclabel">Eval scores</div>
              <dl className="deflist">
                {run.grounding != null && <><dt>Grounding</dt><dd className="mono">{run.grounding.toFixed(3)}</dd></>}
                {(run as RunEvent & { diversity?: number | null }).diversity != null && (
                  <><dt>Diversity</dt><dd className="mono">{((run as RunEvent & { diversity?: number | null }).diversity ?? 0).toFixed(3)}</dd></>
                )}
              </dl>
            </>
          )}
        </div>

        <div className="drawer__foot">
          {run.tourId && (
            <button className="btn btn--default" onClick={() => { onClose(); navigate(`/tours/${run.tourId}`) }}>
              <Map size={14} /> Open tour
            </button>
          )}
          {cancelable && (
            <button className="btn btn--danger" disabled={canceling} onClick={() => void cancel()}>
              <X size={14} /> {canceling ? 'Canceling…' : 'Cancel run'}
            </button>
          )}
          {logsUrl && (
            <a className="btn btn--ghost" style={{ marginLeft: 'auto' }} href={logsUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Cloud Run logs
            </a>
          )}
        </div>
      </aside>
    </>
  )
}

/* ─── New run modal ─── */

const KINDS: JobKind[] = ['generate', 'resynth', 'patch_clip', 'sweep_orphans', 'sweep_roam_pois', 'generate_roam']

function NewRunModal({ onClose, onSubmitted }: { onClose: () => void; onSubmitted: () => void }) {
  const [kind, setKind] = useState<JobKind>('generate')
  const [f, setF] = useState<Record<string, string>>({ maxCostUsd: '5', jokeLevel: 'dadpocalypse', duration: 'standard' })
  const [dryRun, setDryRun] = useState(true)
  const [apply, setApply] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const set = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }))

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const meta = KIND_META[kind]
  const target =
    kind === 'generate'        ? f.slug
    : kind === 'patch_clip'    ? f.targetId
    : kind === 'sweep_roam_pois' || kind === 'generate_roam' ? 'roam-corpus'
    : f.tourId
  const spends =
    kind === 'generate'        ? !dryRun
    : kind === 'sweep_roam_pois' ? false
    : apply
  const isDelete = meta?.spends === 'delete'
  const estCost = kind === 'generate' ? Number(f.maxCostUsd || 0) : kind === 'resynth' ? 2.2 : kind === 'patch_clip' ? 0.05 : 0
  const confirmed = !spends || confirmText.trim() === (target ?? '').trim()
  const canRun = !!target && confirmed

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = { kind }
      if (kind === 'generate')
        Object.assign(body, { slug: f.slug, dryRun, maxCostUsd: Number(f.maxCostUsd), jokeLevel: f.jokeLevel, duration: f.duration })
      if (kind === 'patch_clip') Object.assign(body, { targetId: f.targetId, find: f.find, replace: f.replace, apply })
      if (kind === 'resynth') Object.assign(body, { tourId: f.tourId, apply })
      if (kind === 'sweep_orphans') Object.assign(body, { tourId: f.tourId, apply })
      if (kind === 'sweep_roam_pois') Object.assign(body, { bbox: f.bbox || undefined, apply })
      if (kind === 'generate_roam')
        Object.assign(body, {
          bbox: f.bbox || undefined,
          limit: f.limit ? Number(f.limit) : undefined,
          force: f.force === 'true' || undefined,
          minExtract: f.minExtract ? Number(f.minExtract) : undefined,
          apply,
        })
      if (spends) body.confirm = true
      await api.createJob(body)
      onSubmitted()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal">
        <div className="modal__head">
          <div className="modal__title">New run</div>
          <div className="modal__desc">Triggers a skipper-gen Cloud Run job. Dry-run by default — spend is always opt-in.</div>
        </div>
        <div className="modal__body">
          {/* kind picker */}
          <div>
            <div className="field__label" style={{ marginBottom: 8 }}>Kind</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {KINDS.map((k) => {
                const m = KIND_META[k]
                const Icon = m?.icon ?? Activity
                return (
                  <button
                    key={k}
                    onClick={() => { setKind(k); setConfirmText('') }}
                    style={{
                      textAlign: 'left', padding: '10px 11px', borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      border: `1px solid ${kind === k ? 'var(--primary)' : 'var(--border)'}`,
                      background: kind === k ? 'color-mix(in srgb, var(--primary) 5%, var(--panel))' : 'var(--panel)',
                    }}
                  >
                    <div className="row-flex" style={{ fontSize: 13, fontWeight: 600 }}>
                      <Icon size={15} /> {m?.label ?? k}
                      {m?.spends === 'delete' && <span className="badge badge--bad" style={{ marginLeft: 'auto' }}>deletes</span>}
                      {m?.spends === 'spend' && <span className="badge badge--warn" style={{ marginLeft: 'auto' }}>$</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.4 }}>{m?.desc}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* kind-specific fields */}
          {kind === 'generate' && (
            <>
              <label className="field">
                <span className="field__label">Tour slug</span>
                <input value={f.slug ?? ''} onChange={set('slug')} placeholder="emerald-bay-run" />
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <label className="field">
                  <span className="field__label">Max cost ($)</span>
                  <input value={f.maxCostUsd} onChange={set('maxCostUsd')} className="mono" />
                </label>
                <label className="field">
                  <span className="field__label">Joke level</span>
                  <div className="selectbox"><select value={f.jokeLevel} onChange={set('jokeLevel')}>
                    {['off','mild','dad','dadpocalypse'].map((o) => <option key={o}>{o}</option>)}
                  </select></div>
                </label>
                <label className="field">
                  <span className="field__label">Duration</span>
                  <div className="selectbox"><select value={f.duration} onChange={set('duration')}>
                    {['short','standard','long'].map((o) => <option key={o}>{o}</option>)}
                  </select></div>
                </label>
              </div>
              <label className="checkrow">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                <span>Dry-run — write scripts only, no TTS spend. <b>Recommended first pass.</b></span>
              </label>
            </>
          )}
          {kind === 'resynth' && (
            <>
              <label className="field">
                <span className="field__label">Tour id</span>
                <input value={f.tourId ?? ''} onChange={set('tourId')} placeholder="t_abc123" />
              </label>
              <ApplyCheckbox apply={apply} setApply={setApply} verb="re-synthesize every clip" />
            </>
          )}
          {kind === 'patch_clip' && (
            <>
              <label className="field">
                <span className="field__label">Stop / bracket id</span>
                <input value={f.targetId ?? ''} onChange={set('targetId')} placeholder="s_bixby_06" className="mono" />
              </label>
              <div className="grid-2">
                <label className="field">
                  <span className="field__label">Find</span>
                  <input value={f.find ?? ''} onChange={set('find')} placeholder="Rainbow Bridge" />
                </label>
                <label className="field">
                  <span className="field__label">Replace</span>
                  <input value={f.replace ?? ''} onChange={set('replace')} placeholder="Bixby Creek Bridge" />
                </label>
              </div>
              <ApplyCheckbox apply={apply} setApply={setApply} verb="re-synthesize the clip" />
            </>
          )}
          {kind === 'sweep_orphans' && (
            <>
              <label className="field">
                <span className="field__label">Tour id (blank = all)</span>
                <input value={f.tourId ?? ''} onChange={set('tourId')} placeholder="leave blank for all tours" />
              </label>
              <ApplyCheckbox apply={apply} setApply={setApply} verb="delete orphaned clips" del />
            </>
          )}
          {kind === 'sweep_roam_pois' && (
            <>
              <label className="field">
                <span className="field__label">Bbox (optional)</span>
                <input value={f.bbox ?? ''} onChange={set('bbox')} placeholder="-120.25,38.86,-119.55,39.65" />
              </label>
              <ApplyCheckbox apply={apply} setApply={setApply} verb="upsert POIs into DB (free)" />
            </>
          )}
          {kind === 'generate_roam' && (
            <>
              <label className="field">
                <span className="field__label">Bbox (optional)</span>
                <input value={f.bbox ?? ''} onChange={set('bbox')} placeholder="-120.25,38.86,-119.55,39.65" />
              </label>
              <div className="grid-2">
                <label className="field">
                  <span className="field__label">Limit</span>
                  <input value={f.limit ?? ''} onChange={set('limit')} placeholder="all" />
                </label>
                <label className="field">
                  <span className="field__label">Min extract chars</span>
                  <input value={f.minExtract ?? ''} onChange={set('minExtract')} placeholder="400" />
                </label>
              </div>
              <label className="checkrow">
                <input type="checkbox" checked={f.force === 'true'} onChange={(e) => setF((p) => ({ ...p, force: e.target.checked ? 'true' : '' }))} />
                <span>Force (regenerate clips whose facts_hash is still fresh)</span>
              </label>
              <ApplyCheckbox apply={apply} setApply={setApply} verb="narrate + synthesize clips" />
            </>
          )}

          {/* danger zone */}
          {spends && (
            <div className={`dangerzone${isDelete ? ' dangerzone--del' : ''}`}>
              <div className="dangerzone__title">
                {isDelete ? <Trash2 size={14} /> : <DollarSign size={14} />}
                {isDelete ? 'This permanently deletes bytes' : `This will spend up to ~$${estCost.toFixed(2)}`}
              </div>
              <div className="dangerzone__body">
                {isDelete ? "Orphaned clips can't be recovered." : 'Real TTS minutes will be billed to skipper-prod.'}
                {' '}To confirm, type <span className="mono" style={{ fontWeight: 700 }}>{target ?? '…'}</span> below.
              </div>
              <div className="confirm-input field">
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={target ?? 'target'} />
              </div>
            </div>
          )}
          {!spends && (
            <div className="muted" style={{ fontSize: 12, display: 'flex', gap: 7, alignItems: 'center' }}>
              <CircleCheck size={14} style={{ color: 'var(--ok)' }} />
              Safe preview — no spend, no deletion. Flip the toggle above to make it real.
            </div>
          )}

          {err && (
            <div className="dangerzone dangerzone--del">
              <div className="dangerzone__title"><CircleX size={14} /> Error</div>
              <div className="dangerzone__body">{err}</div>
            </div>
          )}
        </div>
        <div className="modal__foot">
          <button className="btn btn--ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button
            className={`btn ${spends ? (isDelete ? 'btn--danger' : 'btn--warn') : 'btn--primary'}`}
            disabled={busy || !canRun}
            onClick={() => void submit()}
          >
            {busy
              ? 'Triggering…'
              : spends
                ? (isDelete ? 'Delete for real' : `Spend ~$${estCost.toFixed(2)} & run`)
                : 'Run dry-run'
            }
          </button>
        </div>
      </div>
    </>
  )
}

function ApplyCheckbox({ apply, setApply, verb, del }: { apply: boolean; setApply: (v: boolean) => void; verb: string; del?: boolean }) {
  return (
    <label className="checkrow">
      <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} />
      <span>Apply — actually {verb}. Off = {del ? 'report only' : 'dry-run preview'}.</span>
    </label>
  )
}

// Augment window for cross-view navigation (legacy bridge)
declare global {
  interface Window { __go?: (view: string, id: string) => void }
}
