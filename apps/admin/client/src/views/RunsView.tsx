import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, CircleX,
  ExternalLink, Filter, RefreshCw, Scissors, Search, Sparkles, Trash2, X, Zap,
} from 'lucide-react'
import {
  api,
  type JobStatus, type RunEvent,
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
  resynth_roam_clip: { label: 'Re-synth narration',  icon: RefreshCw,  desc: 'Re-voice one narration unchanged.',              spends: 'spend'  },
  refetch_facts:   { label: 'Re-fetch facts',   icon: RefreshCw,  desc: "Re-fetch a POI's upstream facts (Wikipedia extract).", spends: 'free'   },
  sweep_orphans:   { label: 'Sweep orphans',    icon: Trash2,     desc: 'Delete R2 clips that no roam narration references.', spends: 'delete' },
  discover_pois: { label: 'Discover POIs',     icon: Filter,     desc: "Discover + upsert the region's POI corpus — roam draws from it.", spends: 'free'   },
  enrich_pois:   { label: 'Enrich corpus',    icon: Sparkles,   desc: 'Scout story POIs into verbatim fact sheets (pois.fact_sheet) for roam.', spends: 'spend'  },
  generate_narrations:   { label: 'Generate Narration', icon: Zap,        desc: 'Narrate + synthesize narrations for the corpus.',  spends: 'spend'  },
}

const isLive = (s?: JobStatus | null) => s === 'running' || s === 'queued'

function PulseDot() {
  return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
}

/* ─── main view ─── */

export function RunsView() {
  const qc = useQueryClient()
  const confirm = useConfirm()
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

  const err = error ?? sweepMut.error

  const filtered = useMemo(() => runs.filter((r) => {
    if (src !== 'all' && r.source !== src) return false
    if (kindFilter !== 'all' && r.kind !== kindFilter) return false
    if (statusFilter !== 'all') {
      if (statusFilter === 'running') return r.status === 'running' || r.status === 'queued'
      if (statusFilter === 'failed')  return r.status === 'failed' || r.pass === false
      if (statusFilter === 'ok')      return r.status === 'succeeded' || r.pass === true
    }
    if (q) {
      const s = `${r.kind} ${r.id}`.toLowerCase()
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

      {err && (
        <Callout variant="error">
          <span className="font-medium">Error loading runs:</span> {errMsg(err)}
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
                <TableHead>Result</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Detail</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending && <TableSkeletonRows rows={6} cols={6} />}
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
                          <div className="font-mono text-xs text-muted-foreground">{r.id}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><RunResultCell r={r} /></TableCell>
                    <TableCell>
                      {r.dryRun
                        ? <Badge variant="secondary">dry-run</Badge>
                        : r.source === 'eval'
                          ? <span className="text-muted-foreground">—</span>
                          : <Badge variant="warning">spend</Badge>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{fmtCost(r.costUsd)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.source === 'job'
                        ? (r.triggeredBy ?? '—')
                        : (
                          <span className="flex items-center gap-1.5">
                            {r.narrationModel}
                            {r.gitSha && (
                              <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px]">{r.gitSha.slice(0, 7)}</span>
                            )}
                          </span>
                        )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground" title={fmtDate(r.createdAt)}>
                      {timeAgo(r.createdAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
              {!isPending && filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6}>
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
  return (
    <span className="flex items-center gap-2">
      <Badge variant={r.pass ? 'success' : 'destructive'}>{r.pass ? 'pass' : 'fail'}</Badge>
      {r.grounding != null && (
        <span className={cn('font-mono text-xs', r.grounding < 0.75 ? 'text-destructive' : 'text-muted-foreground')}>
          g {r.grounding.toFixed(2)}
        </span>
      )}
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
            <SheetDescription className="mt-0.5">{run.slug ?? run.id}</SheetDescription>
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
              <LogBlock><span className="text-muted-foreground">$ skipper-gen {run.kind} </span>{args.join(' ')}</LogBlock>
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

          {/* Eval scores for eval-source runs */}
          {!isJob && run.grounding != null && (
            <div className="space-y-2">
              <SectionLabel>Eval scores</SectionLabel>
              <dl className="grid grid-cols-[120px_1fr] gap-px overflow-hidden rounded-lg border bg-border">
                {run.grounding != null && <Def label="Grounding" mono>{run.grounding.toFixed(3)}</Def>}
                {(run as RunEvent & { diversity?: number | null }).diversity != null && (
                  <Def label="Diversity" mono>{((run as RunEvent & { diversity?: number | null }).diversity ?? 0).toFixed(3)}</Def>
                )}
              </dl>
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
