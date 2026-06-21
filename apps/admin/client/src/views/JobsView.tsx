import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity, ArrowRight, CircleX, ExternalLink, Filter, RefreshCw, Scissors, Search, Sparkles, Trash2, X, Zap,
} from 'lucide-react'
import { api, type JobStatus, type RunEvent } from '@/lib/api'
import { errMsg, fmtDate, timeAgo } from '@/lib/format'
import { JOB_STATUS_VARIANT } from '@/lib/status'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Callout } from '@/components/ui/callout'
import { SearchInput } from '@/components/ui/search-input'
import { EmptyState } from '@/components/ui/empty-state'
import { TableSkeletonRows } from '@/components/ui/skeleton'
import { SectionLabel } from '@/components/ui/section-label'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/* ─── run kinds + helpers ─── */

// Kind → label/icon. generate / resynth / patch_clip are LEGACY (deferred in V2) — kept so historical
// job rows render with a readable label; they are no longer dispatchable here.
const KIND_META: Record<string, { label: string; icon: React.ElementType }> = {
  generate:        { label: 'Generate',          icon: Sparkles },
  resynth:         { label: 'Resynth',           icon: RefreshCw },
  patch_clip:      { label: 'Patch clip',        icon: Scissors },
  resynth_narration: { label: 'Re-synth narration', icon: RefreshCw },
  refetch_facts:   { label: 'Re-fetch facts',    icon: RefreshCw },
  sweep_orphans:   { label: 'Sweep orphans',     icon: Trash2 },
  discover_pois:   { label: 'Discover POIs',     icon: Filter },
  enrich_pois:     { label: 'Enrich corpus',     icon: Sparkles },
  generate_narrations: { label: 'Generate Narration', icon: Zap },
  offline_audit:   { label: 'Re-score corpus',   icon: Activity },
}

// A job targeting no region (whole-corpus) leaves its slug NULL → "All". Legacy sentinels map to a
// friendly label rather than a raw slug.
const TARGET_SENTINELS: Record<string, string> = {
  'roam-corpus': 'All',
  'region-corpus': 'whole corpus',
  narration: 'all clips',
}

const isLive = (s?: JobStatus | null) => s === 'running' || s === 'queued'
const isFailed = (r: RunEvent) => r.status === 'failed'

function PulseDot() {
  return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
}

function RunTarget({ slug }: { slug: string | null }) {
  if (!slug) return <span className="italic text-muted-foreground">All</span>
  const sentinel = TARGET_SENTINELS[slug]
  if (sentinel) return <span className="italic text-muted-foreground">{sentinel}</span>
  return <>{slug}</>
}

function JobResultCell({ r }: { r: RunEvent }) {
  if (!r.status) return <span className="text-muted-foreground">—</span>
  const variant = JOB_STATUS_VARIANT[r.status] ?? 'secondary'
  const label = r.status === 'running' && r.phase
    ? `running · ${r.phase.split('·')[1]?.trim() ?? ''}`.replace(/·\s*$/, '').trim()
    : r.status
  return (
    <span className="flex items-center gap-2">
      <Badge variant={variant}>
        {isLive(r.status) && <PulseDot />}
        {label}
      </Badge>
      {r.dryRun && <Badge variant="secondary">dry-run</Badge>}
    </span>
  )
}

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

/* ─── main view ─── */

// The /jobs page — admin-triggered Cloud Run jobs. Shares the ['runs'] cache with EvalsView (every
// dispatch invalidates it) and filters to source === 'job'.
export function JobsView() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { run?: string }
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [q, setQ] = useState('')
  const [drawerRun, setDrawerRun] = useState<RunEvent | null>(null)

  const { data: runs = [], error, isPending, isFetching, refetch } = useQuery({
    queryKey: ['runs'],
    queryFn: async () => (await api.runs()).runs,
    refetchInterval: 15000,
  })
  const rows = useMemo(() => runs.filter((r) => r.source === 'job'), [runs])

  // Deep-link: ?run=<id> opens that job's drawer once the list resolves, then strips the param —
  // so re-synth/regenerate's "jump to the run" works, and a job is shareable/bookmarkable.
  useEffect(() => {
    if (!search.run) return
    const r = rows.find((x) => x.id === search.run)
    if (!r) return
    setDrawerRun(r)
    navigate({ to: '/jobs', search: (prev) => ({ ...prev, run: undefined }), replace: true })
  }, [search.run, rows, navigate])

  // Sweep: delete R2 clips no narration references. Spends nothing but DELETES bytes, so gate behind
  // a confirm; the launched job lands on this same timeline.
  const sweepMut = useMutation({
    mutationFn: () => api.createJob({ kind: 'sweep_orphans', apply: true, confirm: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  })
  async function sweepOrphans() {
    if (!(await confirm({
      title: 'Sweep orphaned clips?',
      body: 'Permanently DELETES R2 bytes that no narration references — across the whole corpus.',
      confirmLabel: 'Sweep',
      tone: 'destructive',
    }))) return
    sweepMut.mutate()
  }

  const filtered = useMemo(() => rows.filter((r) => {
    if (kindFilter !== 'all' && r.kind !== kindFilter) return false
    if (statusFilter !== 'all') {
      if (statusFilter === 'running') return r.status === 'running' || r.status === 'queued'
      if (statusFilter === 'failed')  return isFailed(r)
      if (statusFilter === 'ok')      return r.status === 'succeeded'
    }
    if (q) {
      const s = `${r.kind} ${r.id} ${r.triggeredBy ?? ''}`.toLowerCase()
      if (!s.includes(q.toLowerCase())) return false
    }
    return true
  }), [rows, kindFilter, statusFilter, q])

  const runningN = rows.filter((r) => r.status === 'running').length
  const failedN  = rows.filter(isFailed).length

  // Kind options scoped to the rows actually on screen (no dead options for kinds that never ran).
  const kindsInView = useMemo(() => [...new Set(rows.map((r) => r.kind))].sort(), [rows])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Jobs"
        description="Admin-triggered Cloud Run jobs, newest first. Click a row for run details."
        actions={
          <Button
            variant="outline"
            disabled={sweepMut.isPending}
            onClick={() => void sweepOrphans()}
            title="Maintenance — delete R2 clips no narration references"
          >
            <Trash2 className="h-4 w-4" /> {sweepMut.isPending ? 'Sweeping…' : 'Sweep orphans'}
          </Button>
        }
      />

      {error && (
        <Callout variant="error">
          <span className="font-medium">Error loading jobs:</span> {errMsg(error)}
        </Callout>
      )}

      {sweepMut.error && (
        <Callout variant="error">
          <span className="font-medium">Sweep failed:</span> {errMsg(sweepMut.error)}
        </Callout>
      )}

      {/* Clickable status KPIs (left) + auto-refresh + manual refresh (right). */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Badge asChild variant={runningN ? 'info' : 'secondary'} className="cursor-pointer">
          <button onClick={() => setStatusFilter('running')}>
            {runningN > 0 && <PulseDot />}
            {runningN} running
          </button>
        </Badge>
        <Badge asChild variant={failedN ? 'destructive' : 'secondary'} className="cursor-pointer">
          <button onClick={() => setStatusFilter('failed')}>{failedN} failed</button>
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">auto-refresh · 15s</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground"
            onClick={() => void refetch()}
            title="Refresh now"
            aria-label="Refresh"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
          </Button>
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
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All kinds</SelectItem>
              {kindsInView.map((k) => <SelectItem key={k} value={k}>{KIND_META[k]?.label ?? k}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any result</SelectItem>
              <SelectItem value="running">Running / queued</SelectItem>
              <SelectItem value="ok">Succeeded</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>
          <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {rows.length}</span>
        </div>

        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Triggered by</TableHead>
                <TableHead className="text-right">When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending && <TableSkeletonRows rows={6} cols={5} />}
              {filtered.map((r) => {
                const km = KIND_META[r.kind]
                const Icon = km?.icon ?? Activity
                return (
                  <TableRow
                    key={r.id}
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
                    <TableCell className="text-xs">
                      <RunTarget slug={r.slug} />
                    </TableCell>
                    <TableCell><JobResultCell r={r} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.triggeredBy ?? '—'}</TableCell>
                    <TableCell className="text-right text-xs text-muted-foreground" title={fmtDate(r.createdAt)}>
                      {timeAgo(r.createdAt)}
                    </TableCell>
                  </TableRow>
                )
              })}
              {!isPending && filtered.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5}>
                    <EmptyState icon={Search}>No jobs match these filters.</EmptyState>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {drawerRun && <JobDrawer run={drawerRun} onClose={() => setDrawerRun(null)} />}
    </div>
  )
}

function JobDrawer({ run, onClose }: { run: RunEvent; onClose: () => void }) {
  const qc = useQueryClient()

  const { data: jobData } = useQuery({
    queryKey: ['job', run.id],
    queryFn: () => api.job(run.id),
    // Poll 5s only while the run is LIVE (running/queued). The job writes its own log/summary/metrics
    // at finishJob, atomically with the status flip — so a terminal row is already complete.
    refetchInterval: (query) => {
      const j = query.state.data?.job
      if (!j) return 5000
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
  const cancelable = status === 'running' || status === 'queued'
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
              {status && (
                <Badge variant={JOB_STATUS_VARIANT[status] ?? 'secondary'}>
                  {isLive(status) && <PulseDot />}
                  {status}
                </Badge>
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
                {run.dryRun ? <Badge variant="secondary">dry-run</Badge> : <Badge variant="outline">applied</Badge>}
              </Def>
              <Def label="Triggered by" mono>{run.triggeredBy ?? '—'}</Def>
              {job?.cloudRunExecution && <Def label="Execution" mono breakAll>{job.cloudRunExecution}</Def>}
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

          {/* A generate_narrations job produced an eval run — link to its per-place gate report on the
              Evals page (which resolves it by id even though it's suppressed from the eval list). */}
          {run.evalRunId && (
            <div className="space-y-2">
              <SectionLabel>Eval report</SectionLabel>
              <Link
                to="/evals"
                search={{ run: run.evalRunId }}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-4 hover:opacity-80"
              >
                View the per-place gate report <ArrowRight size={14} />
              </Link>
            </div>
          )}

          {/* Cancel failure — a cancel of a live job that errored. Surfaced so the button doesn't just
              silently flip back. Matches the run-failed box above. */}
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
