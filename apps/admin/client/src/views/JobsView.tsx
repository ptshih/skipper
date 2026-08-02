import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowRight, ExternalLink, Search, Trash2, X } from 'lucide-react'
import { api, type JobStatus, type RunEvent } from '@/lib/api'
import { errMsg, fmtDate, timeAgo } from '@/lib/format'
import { JOB_STATUS_VARIANT } from '@/lib/status'
import { KIND_META, TARGET_SENTINELS, RunTarget, RUNS_REFETCH_MS, useRunsFilter } from '@/lib/runs'
import { qk } from '@/lib/queryKeys'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PendingButton } from '@/components/ui/pending-button'
import { Callout } from '@/components/ui/callout'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/ui/section-label'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DetailList, DetailRow } from '@/components/ui/detail-list'
import { CodeBlock } from '@/components/ui/code-block'
import { ErrorCallout } from '@/components/ui/error-callout'
import { PulseDot } from '@/components/ui/pulse-dot'
import { StatChip, StatChipRow } from '@/components/ui/stat-chip'
import { AutoRefreshControl } from '@/components/ui/auto-refresh-control'
import { FilterToolbar, FilterSelect } from '@/components/ui/filter-toolbar'
import {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'

/* ─── run kinds + helpers ─── */

const isLive = (s?: JobStatus | null) => s === 'running' || s === 'queued'
const isFailed = (r: RunEvent) => r.status === 'failed'

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

/* ─── main view ─── */

// The /jobs page — admin-triggered Cloud Run jobs. Shares the ['runs'] cache with EvalsView (every
// dispatch invalidates it) and filters to source === 'job'.
export function JobsView() {
  const qc = useQueryClient()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { run?: string }
  const [drawerRun, setDrawerRun] = useState<RunEvent | null>(null)

  const {
    rows, filtered, kindsInView,
    kindFilter, setKindFilter, statusFilter, setStatusFilter, q, setQ,
    error, isPending, isFetching, refetch,
  } = useRunsFilter(
    'job',
    (r, status) =>
      status === 'running' ? r.status === 'running' || r.status === 'queued'
      : status === 'failed' ? isFailed(r)
      : status === 'ok' ? r.status === 'succeeded'
      : true,
    (r) => `${r.kind} ${r.id} ${r.triggeredBy ?? ''}`,
  )

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
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.runs() }),
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

  const runningN = rows.filter((r) => r.status === 'running').length
  const failedN  = rows.filter(isFailed).length

  const columns: Column<RunEvent>[] = [
    {
      header: 'Run',
      cell: (r) => {
        const km = KIND_META[r.kind]
        const Icon = km?.icon ?? Activity
        return (
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md border bg-muted text-muted-foreground">
              <Icon size={13} />
            </span>
            <div className="min-w-0">
              <div className="font-medium">{km?.label ?? r.kind}</div>
              <div className="font-mono text-xs text-muted-foreground">{r.id}</div>
            </div>
          </div>
        )
      },
    },
    { header: 'Target', cellClassName: 'text-xs', cell: (r) => <RunTarget slug={r.slug} /> },
    { header: 'Result', cell: (r) => <JobResultCell r={r} /> },
    { header: 'Triggered by', cellClassName: 'text-xs text-muted-foreground', cell: (r) => r.triggeredBy ?? '—' },
    {
      header: 'When',
      headClassName: 'text-right',
      cellClassName: 'text-right text-xs text-muted-foreground',
      cell: (r) => <span title={fmtDate(r.createdAt)}>{timeAgo(r.createdAt)}</span>,
    },
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Jobs"
        description="Admin-triggered Cloud Run jobs, newest first. Click a row for run details."
        actions={
          <PendingButton
            variant="outline"
            pending={sweepMut.isPending}
            onClick={() => void sweepOrphans()}
            title="Maintenance — delete R2 clips no narration references"
            icon={<Trash2 className="h-4 w-4" />}
            idleLabel="Sweep orphans"
            pendingLabel="Sweeping…"
          />
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
      <StatChipRow
        aside={<AutoRefreshControl intervalMs={RUNS_REFETCH_MS} isFetching={isFetching} onRefresh={() => void refetch()} />}
      >
        <StatChip count={runningN} label="running" variant="info" pulse onClick={() => setStatusFilter('running')} />
        <StatChip count={failedN} label="failed" variant="destructive" onClick={() => setStatusFilter('failed')} />
      </StatChipRow>

      <div className="space-y-3">
        <FilterToolbar
          search={q}
          onSearch={setQ}
          searchPlaceholder="Search kind, id…"
          shown={filtered.length}
          total={rows.length}
        >
          <FilterSelect
            value={kindFilter}
            onChange={setKindFilter}
            allLabel="All kinds"
            options={kindsInView.map((k) => ({ value: k, label: KIND_META[k]?.label ?? k }))}
          />
          <FilterSelect
            value={statusFilter}
            onChange={setStatusFilter}
            allLabel="Any result"
            options={[
              { value: 'running', label: 'Running / queued' },
              { value: 'ok', label: 'Succeeded' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
        </FilterToolbar>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={isPending}
          onRowClick={(r) => setDrawerRun(r)}
          rowClassName={(r) => (r.status === 'running' ? 'bg-info/5' : undefined)}
          empty={<EmptyState icon={Search}>No jobs match these filters.</EmptyState>}
        />
      </div>

      {drawerRun && <JobDrawer run={drawerRun} onClose={() => setDrawerRun(null)} />}
    </div>
  )
}

function JobDrawer({ run, onClose }: { run: RunEvent; onClose: () => void }) {
  const confirm = useConfirm()
  const qc = useQueryClient()

  const { data: jobData } = useQuery({
    queryKey: qk.job(run.id),
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
      qc.invalidateQueries({ queryKey: qk.job(run.id) })
      qc.invalidateQueries({ queryKey: qk.runs() })
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
          {error && <ErrorCallout title="Run failed" error={error} />}

          <div className="space-y-2">
            <SectionLabel>Details</SectionLabel>
            <DetailList>
              <DetailRow label="Kind"><span className="flex items-center gap-1.5"><Icon size={13} /> {km?.label ?? run.kind}</span></DetailRow>
              <DetailRow label="Mode">
                {run.dryRun ? <Badge variant="secondary">dry-run</Badge> : <Badge variant="outline">applied</Badge>}
              </DetailRow>
              <DetailRow label="Triggered by" mono>{run.triggeredBy ?? '—'}</DetailRow>
              {job?.cloudRunExecution && <DetailRow label="Execution" mono breakAll>{job.cloudRunExecution}</DetailRow>}
              <DetailRow label="Started" mono>{fmtDate(run.createdAt)}</DetailRow>
              {job?.startedAt && <DetailRow label="Ended" mono>{fmtDate(job.endedAt)}</DetailRow>}
            </DetailList>
          </div>

          {args && args.length > 0 && (
            <div className="space-y-2">
              <SectionLabel>Command</SectionLabel>
              <CodeBlock><span className="text-muted-foreground">$ skipper-studio {run.kind} </span>{args.join(' ')}</CodeBlock>
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
            <CodeBlock>
              {job?.outputData && Object.keys(job.outputData).length > 0
                ? JSON.stringify(job.outputData, null, 2)
                : <span className="text-muted-foreground">—</span>}
            </CodeBlock>
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
            <CodeBlock className="max-h-80 overflow-y-auto whitespace-pre">
              {job?.outputLog ?? <span className="text-muted-foreground">—</span>}
            </CodeBlock>
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
          {cancelMut.error && <ErrorCallout title="Cancel failed" error={cancelMut.error} />}
        </div>

        <SheetFooter>
          {cancelable && (
            <PendingButton
              variant="destructive"
              pending={cancelMut.isPending}
              // ⚠ The only destructive action in the console that fired straight off the click. Every
              // sibling — region release, per-clip release, POI delete, place delete, sweep orphans,
              // re-synth, regenerate — goes through useConfirm or a JobActionDialog. And cancelling is
              // not free: generation has no checkpoint/resume (shelved, deliberately), so whatever the
              // run has already spent is gone.
              onClick={async () => {
                const ok = await confirm({
                  title: 'Cancel this run?',
                  body:
                    'It stops where it is. Generation has no resume, so anything this run has already ' +
                    'spent is lost — restarting it begins from the top.',
                  confirmLabel: 'Cancel run',
                  tone: 'destructive',
                })
                if (ok) cancelMut.mutate()
              }}
              icon={<X size={14} />}
              idleLabel="Cancel run"
              pendingLabel="Canceling…"
            />
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
