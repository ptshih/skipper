import { useEffect, useMemo, useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, CircleX,
  ExternalLink, Filter, RefreshCw, Scissors, Search, Sparkles, Trash2, X, Zap,
} from 'lucide-react'
import {
  api,
  type EvalScoreRow, type JobStatus, type RunEvent,
} from '@/lib/api'
import { errMsg, fmtCost, fmtDate, timeAgo } from '@/lib/format'
import { JOB_STATUS_VARIANT } from '@/lib/status'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Callout } from '@/components/ui/callout'
import { SearchInput } from '@/components/ui/search-input'
import { Segmented } from '@/components/ui/segmented'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeletonRows } from '@/components/ui/skeleton'
import { SectionLabel } from '@/components/ui/section-label'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/* ─── constants ─── */

const KIND_META: Record<string, { label: string; icon: React.ElementType; desc: string; spends: 'spend' | 'delete' | 'free' }> = {
  // generate / resynth / patch_clip are LEGACY tour-generation kinds (deferred in V2) — kept only so
  // historical run rows still render with a readable label; they are no longer dispatchable here.
  generate:        { label: 'Generate',        icon: Sparkles,   desc: 'Legacy: scripted + synthesized a tour from scratch.', spends: 'spend'  },
  resynth:         { label: 'Resynth',          icon: RefreshCw,  desc: 'Legacy: re-voiced every clip of a tour.',            spends: 'spend'  },
  patch_clip:      { label: 'Patch clip',       icon: Scissors,   desc: "Legacy: find/replace a stop or frame's script, then re-synth it.", spends: 'spend'  },
  resynth_narration: { label: 'Re-synth narration',  icon: RefreshCw,  desc: 'Re-voice one narration unchanged.',              spends: 'spend'  },
  refetch_facts:   { label: 'Re-fetch facts',   icon: RefreshCw,  desc: "Re-fetch a POI's upstream facts (Wikipedia extract).", spends: 'free'   },
  sweep_orphans:   { label: 'Sweep orphans',    icon: Trash2,     desc: 'Delete R2 clips that no roam narration references.', spends: 'delete' },
  discover_pois: { label: 'Discover POIs',     icon: Filter,     desc: "Discover + upsert the region's POI corpus — roam draws from it.", spends: 'free'   },
  enrich_pois:   { label: 'Enrich corpus',    icon: Sparkles,   desc: 'Scout story POIs into verbatim fact sheets (pois.fact_sheet) for roam.', spends: 'spend'  },
  generate_narrations:   { label: 'Generate Narration', icon: Zap,        desc: 'Narrate + synthesize narrations for the corpus.',  spends: 'spend'  },
  offline_audit:   { label: 'Re-score corpus',  icon: Activity,   desc: 'Re-score EXISTING narrations (grounding/tts/diversity) — no regen, no TTS.', spends: 'spend'  },
}

// A run usually targets a region (e.g. 'lake-tahoe'). A whole-corpus generate/audit (explicit POI
// id-list, no region) now leaves its target NULL → shown as "All". Some ops kinds still carry a
// non-region target sentinel — render those as a friendly label, not a raw slug. 'roam-corpus' is the
// LEGACY whole-corpus sentinel (no longer written; mapped here so old rows read "All"). See jobs.ts.
const TARGET_SENTINELS: Record<string, string> = {
  'roam-corpus': 'All',
  'region-corpus': 'whole corpus',
  narration: 'all clips',
}

const isLive = (s?: JobStatus | null) => s === 'running' || s === 'queued'

// An eval run's `pass` is just `withheld === 0`, so a run that gated a few clips but SHIPPED the rest
// is a PARTIAL success, not a failure. A TRUE failure = a job that errored, or an eval run that
// shipped nothing at all (every evaluated clip held back).
const isPartial  = (r: RunEvent) => r.source === 'eval' && r.pass === false && (r.shipped ?? 0) > 0
const isTrueFail = (r: RunEvent) =>
  r.status === 'failed' || (r.source === 'eval' && r.pass === false && (r.shipped ?? 0) === 0 && (r.total ?? 0) > 0)

function RunTarget({ slug }: { slug: string | null }) {
  if (!slug) return <span className="italic text-muted-foreground">All</span>
  const sentinel = TARGET_SENTINELS[slug]
  if (sentinel) return <span className="italic text-muted-foreground">{sentinel}</span>
  return <>{slug}</>
}

// The eval score triple (eval rows only) — grounding/tts/diversity; grounding turns red below the gate.
function RunScores({ r }: { r: RunEvent }) {
  if (r.source !== 'eval') return <span className="text-muted-foreground">—</span>
  const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(2))
  return (
    <span className="flex gap-2 font-mono text-xs text-muted-foreground">
      <span className={cn(r.grounding != null && r.grounding < 0.75 && 'text-destructive')}>g {fmt(r.grounding)}</span>
      <span>tts {fmt(r.tts)}</span>
      <span>div {fmt(r.diversity)}</span>
    </span>
  )
}

function PulseDot() {
  return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
}

/* ─── main view ─── */

const runsRoute = getRouteApi('/runs')

export function RunsView() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const search = runsRoute.useSearch()
  const [src, setSrc] = useState<'all' | 'job' | 'eval'>('all')
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [q, setQ] = useState('')
  const [drawerRun, setDrawerRun] = useState<RunEvent | null>(null)

  // Auto-refreshing list — the setInterval poll is now a TanStack Query refetchInterval.
  const { data: runs = [], error, isPending } = useQuery({
    queryKey: ['runs'],
    queryFn: async () => (await api.runs()).runs,
    refetchInterval: 15000,
  })

  // Deep-link: ?run=<id> opens that run's drawer once the list resolves, then strips the param —
  // so re-synth/regenerate's "jump to the run" works, and a run is shareable/bookmarkable.
  useEffect(() => {
    if (!search.run) return
    const r = runs.find((x) => x.id === search.run)
    if (!r) return
    setDrawerRun(r)
    navigate({ to: '/runs', search: (prev) => ({ ...prev, run: undefined }), replace: true })
  }, [search.run, runs, navigate])

  // The one homeless global op: delete R2 clips no track/frame references. Spends nothing
  // but DELETES bytes, so gate behind a confirm; the launched job is watched on the timeline.
  const sweepMut = useMutation({
    mutationFn: () => api.createJob({ kind: 'sweep_orphans', apply: true, confirm: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  })
  async function sweepOrphans() {
    if (!(await confirm({
      title: 'Sweep orphaned clips?',
      body: 'Permanently DELETES R2 bytes that no roam narration references — across the whole roam corpus.',
      confirmLabel: 'Sweep',
      tone: 'destructive',
    }))) return
    sweepMut.mutate()
  }

  const filtered = useMemo(() => runs.filter((r) => {
    if (src !== 'all' && r.source !== src) return false
    if (kindFilter !== 'all' && r.kind !== kindFilter) return false
    if (statusFilter !== 'all') {
      if (statusFilter === 'running') return r.status === 'running' || r.status === 'queued'
      if (statusFilter === 'failed')  return isTrueFail(r)
      if (statusFilter === 'ok')      return r.status === 'succeeded' || r.pass === true
    }
    if (q) {
      const s = `${r.kind} ${r.id}`.toLowerCase()
      if (!s.includes(q.toLowerCase())) return false
    }
    return true
  }), [runs, src, kindFilter, statusFilter, q])

  const runningN    = runs.filter((r) => r.status === 'running').length
  const failedN     = runs.filter(isTrueFail).length
  const todaySpend  = runs
    .filter((r) => r.createdAt?.slice(0, 10) === new Date().toISOString().slice(0, 10))
    .reduce((a, r) => a + (r.costUsd ?? 0), 0)

  const srcCounts = {
    all:  runs.length,
    job:  runs.filter((r) => r.source === 'job').length,
    eval: runs.filter((r) => r.source === 'eval').length,
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Runs"
        description="Every run on one timeline — admin-triggered Cloud Run jobs and the eval history behind them. Click a row for details."
        actions={
          <Button
            variant="outline"
            disabled={sweepMut.isPending}
            onClick={() => void sweepOrphans()}
            title="Maintenance — delete R2 clips no track or frame references"
          >
            <Trash2 className="h-4 w-4" /> {sweepMut.isPending ? 'Sweeping…' : 'Sweep orphans'}
          </Button>
        }
      />

      {error && (
        <Callout variant="error">
          <span className="font-medium">Error loading runs:</span> {errMsg(error)}
        </Callout>
      )}

      {sweepMut.error && (
        <Callout variant="error">
          <span className="font-medium">Sweep failed:</span> {errMsg(sweepMut.error)}
        </Callout>
      )}

      {/* Clickable status filters (left) + readouts (right). Filters are pills; spend is a KPI. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Badge asChild variant={runningN ? 'info' : 'secondary'} className="cursor-pointer">
          <button onClick={() => { setSrc('all'); setStatusFilter('running') }}>
            {runningN > 0 && <PulseDot />}
            {runningN} running
          </button>
        </Badge>
        <Badge asChild variant={failedN ? 'destructive' : 'secondary'} className="cursor-pointer">
          <button onClick={() => { setSrc('all'); setStatusFilter('failed') }}>{failedN} failed</button>
        </Badge>
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xs text-muted-foreground">Spent today</span>
            <span className={cn(
              'font-mono text-sm font-semibold tabular-nums',
              todaySpend > 0 ? 'text-warning' : 'text-foreground',
            )}>
              {fmtCost(todaySpend)}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">auto-refresh · 15s</span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            wrapperClassName="min-w-[16rem] max-w-sm flex-1"
            placeholder="Search kind, id…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Segmented
            value={src}
            onChange={setSrc}
            options={[
              { value: 'all', label: 'All', count: srcCounts.all },
              { value: 'job', label: 'Job', count: srcCounts.job },
              { value: 'eval', label: 'Eval', count: srcCounts.eval },
            ]}
          />
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {Object.entries(KIND_META).map(([v, m]) => <SelectItem key={v} value={v}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any result</SelectItem>
              <SelectItem value="running">Running / queued</SelectItem>
              <SelectItem value="ok">Succeeded / pass</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {runs.length}</span>
        </div>

        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Scores</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Triggered by</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending && <TableSkeletonRows rows={6} cols={7} />}
              {filtered.map((r) => {
                const km = KIND_META[r.kind]
                const Icon = km?.icon ?? Activity
                return (
                  <TableRow
                    key={`${r.source}:${r.id}`}
                    onClick={() => setDrawerRun(r)}
                    className={cn('cursor-pointer', r.status === 'running' && 'bg-info/5')}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
                          <Icon size={13} />
                        </span>
                        <div className="min-w-0">
                          <div className="font-medium">{km?.label ?? r.kind}</div>
                          {r.source === 'eval' ? (
                            <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                              <span className="truncate">{r.narrationModel ?? r.id}</span>
                              {r.gitSha && (
                                <span className="shrink-0 rounded border bg-muted px-1 py-0.5 text-[11px]">{r.gitSha.slice(0, 7)}</span>
                              )}
                            </div>
                          ) : (
                            <div className="font-mono text-xs text-muted-foreground">{r.id}</div>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">
                      <RunTarget slug={r.slug} />
                    </TableCell>
                    <TableCell><RunResultCell r={r} /></TableCell>
                    <TableCell><RunScores r={r} /></TableCell>
                    <TableCell>
                      {r.dryRun
                        ? <Badge variant="secondary">dry-run</Badge>
                        : r.source === 'eval'
                          ? <span className="text-muted-foreground">—</span>
                          : <Badge variant="warning">spend</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.source === 'job' ? (r.triggeredBy ?? '—') : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground" title={fmtDate(r.createdAt)}>
                      {timeAgo(r.createdAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
              {!isPending && filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7}>
                    <EmptyState icon={Search}>No runs match these filters.</EmptyState>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {drawerRun && <RunDrawer run={drawerRun} onClose={() => setDrawerRun(null)} />}
    </div>
  )
}

function RunResultCell({ r }: { r: RunEvent }) {
  if (r.source === 'job') {
    if (!r.status) return <span className="text-muted-foreground">—</span>
    const variant = JOB_STATUS_VARIANT[r.status] ?? 'secondary'
    const label = r.status === 'running' && r.phase
      ? `running · ${r.phase.split('·')[1]?.trim() ?? ''}`.replace(/·\s*$/, '').trim()
      : r.status
    return (
      <Badge variant={variant}>
        {isLive(r.status) && <PulseDot />}
        {label}
      </Badge>
    )
  }
  // eval: `pass` is just `withheld === 0`. A run that gated some clips but SHIPPED the rest is a
  // PARTIAL success (amber), not a failure — only a run that shipped NOTHING is a true fail (red).
  const withheld = r.withheld ?? 0
  if (withheld === 0) return <Badge variant="success">pass</Badge>
  const partial = isPartial(r)
  return (
    <span className="flex items-center gap-2">
      <Badge variant={partial ? 'warning' : 'destructive'}>{partial ? 'partial' : 'fail'}</Badge>
      <span className="font-mono text-xs text-muted-foreground">
        {r.shipped != null && r.total != null ? `${r.shipped}/${r.total} · ` : ''}{withheld} withheld
      </span>
    </span>
  )
}

/* ─── Run detail drawer ─── */

function Def({ label, children, mono, breakAll }: { label: string; children: React.ReactNode; mono?: boolean; breakAll?: boolean }) {
  return (
    <>
      <dt className="bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('bg-card px-3 py-2 text-xs', mono && 'font-mono', breakAll && 'break-all')}>{children}</dd>
    </>
  )
}

function LogBlock({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-x-auto whitespace-pre-wrap break-words rounded-lg border bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed', className)}>
      {children}
    </div>
  )
}

function RunDrawer({ run, onClose }: { run: RunEvent; onClose: () => void }) {
  const qc = useQueryClient()
  const isJob = run.source === 'job'

  const { data: jobData } = useQuery({
    queryKey: ['job', run.id],
    queryFn: () => api.job(run.id),
    enabled: isJob,
    // Poll 5s only while the run is LIVE (running/queued). The job writes its own
    // log/summary/metrics at finishJob, atomically with the status flip — so a terminal row is
    // already complete and never needs polling.
    refetchInterval: (query) => {
      const j = query.state.data?.job
      if (!j) return isJob ? 5000 : false
      const settled = j.status === 'succeeded' || j.status === 'failed' || j.status === 'canceled'
      return settled ? false : 5000
    },
  })
  const job = jobData?.job ?? null
  const logsUrl = jobData?.logsUrl ?? null

  // Cancel is a mutation; on success refetch this job + the runs list so the row updates.
  const cancelMut = useMutation({
    mutationFn: () => api.cancelJob(run.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job', run.id] })
      qc.invalidateQueries({ queryKey: ['runs'] })
    },
  })

  const km = KIND_META[run.kind]
  const Icon = km?.icon ?? Activity
  const status = (job?.status ?? run.status) as JobStatus | null
  const cancelable = isJob && (status === 'running' || status === 'queued')
  // 'canceled by operator' is the server's marker — not a failure, so don't paint it red.
  const error = status === 'failed' ? job?.error : null
  const args = job?.args
  const live = status === 'running' || status === 'queued'

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <SheetTitle>{km?.label ?? run.kind}</SheetTitle>
              {isJob && status && (
                <Badge variant={JOB_STATUS_VARIANT[status] ?? 'secondary'}>
                  {isLive(status) && <PulseDot />}
                  {status}
                </Badge>
              )}
              {!isJob && run.pass != null && (
                <Badge variant={run.pass ? 'success' : 'destructive'}>{run.pass ? 'pass' : 'fail'}</Badge>
              )}
            </div>
            <SheetDescription className="mt-0.5">{run.slug ? (TARGET_SENTINELS[run.slug] ?? run.slug) : 'All'}</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="-mr-1.5 -mt-1 shrink-0" aria-label="Close">
              <X size={16} />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <div className="flex items-center gap-1.5 font-medium"><CircleX size={15} /> Run failed</div>
              <div className="mt-1 leading-relaxed">{error}</div>
            </div>
          )}

          <div className="space-y-2">
            <SectionLabel>Details</SectionLabel>
            <dl className="grid grid-cols-[120px_1fr] gap-px overflow-hidden rounded-lg border bg-border">
              <Def label="Kind"><span className="flex items-center gap-1.5"><Icon size={13} /> {km?.label ?? run.kind}</span></Def>
              <Def label="Mode">
                {run.dryRun
                  ? <Badge variant="secondary">dry-run</Badge>
                  : isJob
                    ? <Badge variant="warning">spend</Badge>
                    : '—'}
              </Def>
              <Def label="Cost" mono>{fmtCost(run.costUsd)}</Def>
              {isJob && <Def label="Triggered by" mono>{run.triggeredBy ?? '—'}</Def>}
              {!isJob && <Def label="Model" mono>{run.narrationModel ?? '—'}</Def>}
              {job?.cloudRunExecution && <Def label="Execution" mono breakAll>{job.cloudRunExecution}</Def>}
              {!isJob && run.gitSha && <Def label="Commit" mono>{run.gitSha.slice(0, 7)}</Def>}
              <Def label="Started" mono>{fmtDate(run.createdAt)}</Def>
              {job?.startedAt && <Def label="Ended" mono>{fmtDate(job.endedAt)}</Def>}
            </dl>
          </div>

          {args && args.length > 0 && (
            <div className="space-y-2">
              <SectionLabel>Command</SectionLabel>
              <LogBlock><span className="text-muted-foreground">$ skipper-studio {run.kind} </span>{args.join(' ')}</LogBlock>
            </div>
          )}

          {/* Output summary + raw log (succeeded jobs with captured output) */}
          {isJob && (
            <>
              <div className="space-y-2">
                <SectionLabel>Summary</SectionLabel>
                <div className="text-sm leading-relaxed">
                  {job?.outputSummary ?? (
                    <span className="text-muted-foreground">
                      {live ? 'Available when the run finishes.' : 'No summary recorded for this run.'}
                    </span>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <SectionLabel>Metrics</SectionLabel>
                <LogBlock>
                  {job?.outputData && Object.keys(job.outputData).length > 0
                    ? JSON.stringify(job.outputData, null, 2)
                    : <span className="text-muted-foreground">—</span>}
                </LogBlock>
              </div>
              <div className="space-y-2">
                <SectionLabel className="flex items-center gap-1.5">
                  Raw log
                  {job?.outputLog && (
                    <span className="font-normal normal-case tracking-normal text-muted-foreground">
                      {job.outputLog.split('\n').length} lines
                    </span>
                  )}
                </SectionLabel>
                <LogBlock className="max-h-80 overflow-y-auto whitespace-pre">
                  {job?.outputLog ?? <span className="text-muted-foreground">—</span>}
                </LogBlock>
              </div>
            </>
          )}

          {/* The eval report — per-poi gate verdicts + the held-back tellings (eval-source rows AND
              a generate_narrations job that produced an eval run). */}
          {run.evalRunId && <EvalReport runId={run.evalRunId} />}

          {/* Cancel failure — a cancel of a live (possibly spending) job that errored. Surfaced
              here so the button doesn't just silently flip back. Matches the run-failed box above. */}
          {cancelMut.error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <div className="flex items-center gap-1.5 font-medium"><CircleX size={15} /> Cancel failed</div>
              <div className="mt-1 leading-relaxed">{errMsg(cancelMut.error)}</div>
            </div>
          )}
        </div>

        <SheetFooter>
          {cancelable && (
            <Button variant="destructive" disabled={cancelMut.isPending} onClick={() => cancelMut.mutate()}>
              <X size={14} /> {cancelMut.isPending ? 'Canceling…' : 'Cancel run'}
            </Button>
          )}
          {logsUrl && (
            <a
              className="ml-auto inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              href={logsUrl}
              target="_blank"
              rel="noreferrer"
            >
              <ExternalLink size={14} /> Cloud Run logs
            </a>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/* ─── Eval report (per-poi gate verdicts + the held-back tellings) ─── */

type PoiGroup = {
  key: string
  name: string | null
  qid: string | null
  withheld: boolean
  script: string | null
  dims: EvalScoreRow[]
}

/** Collapse the per-(poi × dimension) rows into one entry per place, worst-first. */
function groupByPoi(scores: EvalScoreRow[]): PoiGroup[] {
  const map = new Map<string, PoiGroup>()
  for (const s of scores) {
    const key = s.poiId ?? s.qid ?? s.name ?? s.dimension
    let g = map.get(key)
    if (!g) {
      g = { key, name: s.name, qid: s.qid, withheld: false, script: null, dims: [] }
      map.set(key, g)
    }
    g.dims.push(s)
    if (s.withheld) g.withheld = true
    if (s.script) g.script = s.script
  }
  const failing = (g: PoiGroup) => g.dims.some((d) => !d.pass)
  return [...map.values()].sort(
    (a, b) => Number(b.withheld) - Number(a.withheld) || Number(failing(b)) - Number(failing(a)),
  )
}

function EvalReport({ runId }: { runId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['runScores', runId],
    queryFn: () => api.runScores(runId),
  })
  if (isPending) return <div className="text-xs text-muted-foreground">Loading eval report…</div>
  if (error) return <Callout variant="error">{errMsg(error)}</Callout>
  if (!data) return null

  const { run, scores } = data
  const groups = groupByPoi(scores)
  const withheld = groups.filter((p) => p.withheld)
  // Advisory-only flags: a place that cleared the gate but has a failing advisory dim (charm /
  // veracity / diversity) — invisible in the withheld section, surfaced on its own below.
  const advisory = groups.filter((p) => !p.withheld && p.dims.some((d) => !d.pass))
  const score = (v: number | null) => (v == null ? '—' : v.toFixed(2))
  // charm/veracity have no eval_runs rollup column — average their per-clip scores here so the run
  // summary shows them when present (an offline_audit run with --charm / --veracity).
  const advMean = (dim: string): number | null => {
    const rows = scores.filter((s) => s.dimension === dim)
    return rows.length ? rows.reduce((a, s) => a + s.value, 0) / rows.length : null
  }
  const charmMean = advMean('charm')
  const verMean = advMean('veracity')

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <SectionLabel>Eval report</SectionLabel>
        <dl className="grid grid-cols-[120px_1fr] gap-px overflow-hidden rounded-lg border bg-border">
          <Def label="Clips">
            {run.total} total · {run.shipped} shipped ·{' '}
            <span className={cn(run.withheld > 0 && 'font-medium text-warning')}>{run.withheld} withheld</span>
          </Def>
          <Def label="Scores" mono>
            g {score(run.grounding)} · tts {score(run.tts)} · div {score(run.diversity)}
            {charmMean != null && ` · charm ${score(charmMean)}`}
            {verMean != null && ` · ver ${score(verMean)}`}
          </Def>
          {run.judgeModel && <Def label="Judge" mono>{run.judgeModel}</Def>}
        </dl>
      </div>

      {scores.length === 0 ? (
        <div className="text-xs text-muted-foreground">No per-clip scores recorded for this run.</div>
      ) : (
        <>
          {withheld.length > 0 && (
            <div className="space-y-2">
              <SectionLabel className="text-warning">
                Withheld — {withheld.length} {withheld.length === 1 ? 'place' : 'places'} held back (gate)
              </SectionLabel>
              <div className="space-y-3">{withheld.map((p) => <PlaceReport key={p.key} place={p} />)}</div>
            </div>
          )}
          {advisory.length > 0 && (
            <div className="space-y-2">
              <SectionLabel>
                Advisory flags — {advisory.length} {advisory.length === 1 ? 'place' : 'places'} (charm / veracity / diversity)
              </SectionLabel>
              <div className="space-y-3">{advisory.map((p) => <PlaceReport key={p.key} place={p} advisory />)}</div>
            </div>
          )}
          {withheld.length === 0 && advisory.length === 0 && (
            <div className="text-xs text-muted-foreground">Every clip cleared every dimension — nothing flagged.</div>
          )}
        </>
      )}
    </div>
  )
}

function PlaceReport({ place, advisory = false }: { place: PoiGroup; advisory?: boolean }) {
  const failing = place.dims.filter((d) => !d.pass)
  return (
    <div className={cn('space-y-2 rounded-lg border p-3', advisory ? 'border-border bg-muted/30' : 'border-warning/40 bg-warning/5')}>
      <div className="flex items-center gap-2">
        {advisory ? <Badge variant="outline">advisory</Badge> : <Badge variant="warning">withheld</Badge>}
        <span className="font-medium">{place.name ?? place.qid ?? 'unknown place'}</span>
      </div>
      {failing.map((d, i) => (
        <div key={i} className="space-y-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{d.dimension}</div>
          <ul className="space-y-0.5 text-xs text-foreground">
            {d.findings.map((f, j) => <li key={j}>• {f}</li>)}
          </ul>
        </div>
      ))}
      {place.script && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Show the held-back telling ({place.script.trim().split(/\s+/).filter(Boolean).length} words)
          </summary>
          <LogBlock className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap">{place.script}</LogBlock>
        </details>
      )}
    </div>
  )
}
