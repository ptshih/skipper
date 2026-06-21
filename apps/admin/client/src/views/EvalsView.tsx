import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Search, X } from 'lucide-react'
import { api, type EvalScoreRow, type RunEvent } from '@/lib/api'
import { errMsg, fmtDate, timeAgo } from '@/lib/format'
import { KIND_META, TARGET_SENTINELS, RunTarget, RUNS_REFETCH_MS } from '@/lib/runs'
import { VERDICT_VARIANT, verdictOf, isPartial, isTrueFail } from '@/lib/status'
import { qk } from '@/lib/queryKeys'
import { useAdminList } from '@/lib/useAdminList'
import { PageHeader } from '@/components/PageHeader'
import { DataTable, type Column } from '@/components/ui/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { EmptyState } from '@/components/ui/empty-state'
import { SectionLabel } from '@/components/ui/section-label'
import { DetailList, DetailRow } from '@/components/ui/detail-list'
import { CodeBlock } from '@/components/ui/code-block'
import { StatChip, StatChipRow } from '@/components/ui/stat-chip'
import { AutoRefreshControl } from '@/components/ui/auto-refresh-control'
import { FilterToolbar, FilterSelect } from '@/components/ui/filter-toolbar'
import {
  Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

/* ─── run kinds + helpers ─── */

// grounding/tts/diversity; grounding turns red below the gate.
function RunScores({ r }: { r: RunEvent }) {
  const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(2))
  return (
    <span className="flex gap-2 font-mono text-xs text-muted-foreground">
      <span className={cn(r.grounding != null && r.grounding < 0.75 && 'text-destructive')}>g {fmt(r.grounding)}</span>
      <span>tts {fmt(r.tts)}</span>
      <span>div {fmt(r.diversity)}</span>
    </span>
  )
}

function EvalResultCell({ r }: { r: RunEvent }) {
  const withheld = r.withheld ?? 0
  if (withheld === 0) return <Badge variant="success">pass</Badge>
  const verdict = verdictOf(r)
  return (
    <span className="flex items-center gap-2">
      <Badge variant={VERDICT_VARIANT[verdict]}>{verdict}</Badge>
      <span className="font-mono text-xs text-muted-foreground">
        {r.shipped != null && r.total != null ? `${r.shipped}/${r.total} · ` : ''}{withheld} withheld
      </span>
    </span>
  )
}

/* ─── main view ─── */

// The /evals page — grounding/TTS/diversity scores behind generated clips. Shares the ['runs'] cache
// with JobsView and filters to source === 'eval'. Standalone evals appear as rows here; a JOB-parented
// eval is suppressed from the list (it rides its job row) but JobsView links to it by id, so the
// drawer fetches its report by id rather than looking it up in the list.
export function EvalsView() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { run?: string }
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [q, setQ] = useState('')
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null)

  const { data: runs, error, isPending, isFetching, refetch } = useAdminList(
    qk.runs(),
    async () => (await api.runs()).runs,
    { refetchInterval: RUNS_REFETCH_MS },
  )
  const rows = useMemo(() => runs.filter((r) => r.source === 'eval'), [runs])

  // Deep-link: ?run=<id> opens that eval's drawer, then strips the param. The id need not be in the
  // list — a job links here for its (suppressed) eval, and the drawer resolves it by id.
  useEffect(() => {
    if (!search.run) return
    setDrawerRunId(search.run)
    navigate({ to: '/evals', search: (prev) => ({ ...prev, run: undefined }), replace: true })
  }, [search.run, navigate])

  const filtered = useMemo(() => rows.filter((r) => {
    if (kindFilter !== 'all' && r.kind !== kindFilter) return false
    if (statusFilter !== 'all') {
      if (statusFilter === 'failed')  return isTrueFail(r)
      if (statusFilter === 'partial') return isPartial(r)
      if (statusFilter === 'ok')      return r.pass === true
    }
    if (q) {
      const s = `${r.kind} ${r.id} ${r.narrationModel ?? ''} ${r.gitSha ?? ''}`.toLowerCase()
      if (!s.includes(q.toLowerCase())) return false
    }
    return true
  }), [rows, kindFilter, statusFilter, q])

  const partialN = rows.filter(isPartial).length
  const failedN  = rows.filter(isTrueFail).length

  // Kind options scoped to the rows actually on screen (every eval row is kind 'generation' today).
  const kindsInView = useMemo(() => [...new Set(rows.map((r) => r.kind))].sort(), [rows])

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
              <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                <span className="truncate">{r.narrationModel ?? r.id}</span>
                {r.gitSha && (
                  <span className="shrink-0 rounded border bg-muted px-1 py-0.5 text-[11px]">{r.gitSha.slice(0, 7)}</span>
                )}
              </div>
            </div>
          </div>
        )
      },
    },
    { header: 'Target', cellClassName: 'text-xs', cell: (r) => <RunTarget slug={r.slug} /> },
    { header: 'Result', cell: (r) => <EvalResultCell r={r} /> },
    { header: 'Scores', cell: (r) => <RunScores r={r} /> },
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
        title="Evals"
        description="Grounding / TTS / diversity scores behind generated clips, newest first. Click a row for the per-place gate report."
      />

      {error && (
        <Callout variant="error">
          <span className="font-medium">Error loading evals:</span> {errMsg(error)}
        </Callout>
      )}

      {/* Clickable status KPIs (left) + auto-refresh + manual refresh (right). */}
      <StatChipRow
        aside={<AutoRefreshControl intervalMs={RUNS_REFETCH_MS} isFetching={isFetching} onRefresh={() => void refetch()} />}
      >
        <StatChip count={partialN} label="partial" variant="warning" onClick={() => setStatusFilter('partial')} />
        <StatChip count={failedN} label="failed" variant="destructive" onClick={() => setStatusFilter('failed')} />
      </StatChipRow>

      <div className="space-y-3">
        <FilterToolbar
          search={q}
          onSearch={setQ}
          searchPlaceholder="Search model, commit, id…"
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
              { value: 'ok', label: 'Pass' },
              { value: 'partial', label: 'Partial' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
        </FilterToolbar>

        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(r) => r.id}
          loading={isPending}
          onRowClick={(r) => setDrawerRunId(r.id)}
          empty={<EmptyState icon={Search}>No evals match these filters.</EmptyState>}
        />
      </div>

      {drawerRunId && <EvalDrawer runId={drawerRunId} onClose={() => setDrawerRunId(null)} />}
    </div>
  )
}

// The drawer resolves the run BY ID (api.runScores) rather than from the list row — so a job's
// suppressed eval, linked here from JobsView, opens just the same. The report body lives below.
function EvalDrawer({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data } = useQuery({ queryKey: qk.runScores(runId), queryFn: () => api.runScores(runId) })
  const run = data?.run ?? null
  const km = run ? KIND_META[run.kind] : undefined
  const Icon = km?.icon ?? Activity
  const verdict = run ? verdictOf(run) : null

  return (
    <Sheet open onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent>
        <SheetHeader>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <SheetTitle>{km?.label ?? run?.kind ?? 'Eval run'}</SheetTitle>
              {verdict && <Badge variant={VERDICT_VARIANT[verdict]}>{verdict}</Badge>}
            </div>
            <SheetDescription className="mt-0.5">{run?.region ? (TARGET_SENTINELS[run.region] ?? run.region) : 'All'}</SheetDescription>
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon" className="-mr-1.5 -mt-1 shrink-0" aria-label="Close">
              <X size={16} />
            </Button>
          </SheetClose>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {run && (
            <div className="space-y-2">
              <SectionLabel>Details</SectionLabel>
              <DetailList>
                <DetailRow label="Kind"><span className="flex items-center gap-1.5"><Icon size={13} /> {km?.label ?? run.kind}</span></DetailRow>
                <DetailRow label="Model" mono>{run.narrationModel ?? '—'}</DetailRow>
                {run.gitSha && <DetailRow label="Commit" mono>{run.gitSha.slice(0, 7)}</DetailRow>}
                <DetailRow label="Started" mono>{fmtDate(run.createdAt)}</DetailRow>
              </DetailList>
            </div>
          )}

          <EvalReport runId={runId} />
        </div>
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
    queryKey: qk.runScores(runId),
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
        <DetailList>
          <DetailRow label="Clips">
            {run.total} total · {run.shipped} shipped ·{' '}
            <span className={cn(run.withheld > 0 && 'font-medium text-warning')}>{run.withheld} withheld</span>
          </DetailRow>
          <DetailRow label="Scores" mono>
            g {score(run.grounding)} · tts {score(run.tts)} · div {score(run.diversity)}
            {charmMean != null && ` · charm ${score(charmMean)}`}
            {verMean != null && ` · ver ${score(verMean)}`}
          </DetailRow>
          {run.judgeModel && <DetailRow label="Judge" mono>{run.judgeModel}</DetailRow>}
        </DetailList>
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
          <CodeBlock className="mt-1.5 max-h-64 overflow-y-auto whitespace-pre-wrap">{place.script}</CodeBlock>
        </details>
      )}
    </div>
  )
}
