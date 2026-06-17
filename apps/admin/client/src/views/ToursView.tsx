import { useMemo, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Check, Map, Plus, Sparkles, TriangleAlert } from 'lucide-react'
import { api, type TourCard } from '@/lib/api'
import { errMsg, fmtDuration, fmtMiles, timeAgo } from '@/lib/format'
import { TOUR_STATUS_VARIANT } from '@/lib/status'
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
import { useConfirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

type SortKey = 'headline' | 'regionName' | 'status' | 'stops' | 'distanceMeters' | 'durationSeconds' | 'eval' | 'updatedAt'

type TourCardEx = TourCard & {
  eval?: { pass: boolean; grounding: number } | null
}

const STATUS_FILTER = ['all', 'ready', 'draft', 'failed', 'generating'] as const
type StatusFilter = (typeof STATUS_FILTER)[number]

function EvalCell({ ev }: { ev?: TourCardEx['eval'] }) {
  if (!ev) return <span className="text-muted-foreground">—</span>
  return (
    <span className="flex items-center gap-2">
      <Badge variant={ev.pass ? 'success' : 'destructive'}>
        {ev.pass ? <Check className="h-3 w-3" /> : <TriangleAlert className="h-3 w-3" />}
        {ev.pass ? 'pass' : 'fail'}
      </Badge>
      <span className={cn('font-mono text-xs', ev.pass ? 'text-muted-foreground' : 'text-destructive')}>
        g {ev.grounding.toFixed(2)}
      </span>
    </span>
  )
}

function SortHead({
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
    <TableHead
      className={cn('cursor-pointer select-none whitespace-nowrap hover:text-foreground', right && 'text-right')}
      onClick={() => onSort(sortKey)}
    >
      <span className={cn('inline-flex items-center gap-1', right && 'flex-row-reverse')}>
        {children}
        <span className={cn('transition-opacity', active ? 'text-foreground opacity-100' : 'opacity-0')}>
          {active && dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
        </span>
      </span>
    </TableHead>
  )
}

export function ToursView() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [region, setRegion] = useState('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'updatedAt', dir: 'desc' })

  const { data: tours = [], error, isPending } = useQuery({
    queryKey: ['tours'],
    queryFn: async () => (await api.tours()).tours as TourCardEx[],
  })
  const { data: integrity } = useQuery({ queryKey: ['integrity'], queryFn: () => api.integrity() })

  const brokenIds = useMemo(() => new Set(integrity?.tours.map((t) => t.id) ?? []), [integrity])
  const draftSlugs = useMemo(() => tours.filter((t) => t.status === 'draft').map((t) => t.slug), [tours])

  // Fire a real (spending) generate for one or all draft shells, then jump to Runs to watch.
  // The cold-start path after a reset — turns reseeded draft shells into ready tours.
  const generateMut = useMutation({
    mutationFn: async (slugs: string[]) => {
      for (const slug of slugs) await api.createJob({ kind: 'generate', slug, dryRun: false, maxCostUsd: 5, confirm: true })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      navigate({ to: '/runs' })
    },
  })
  async function generate(slugs: string[]) {
    if (slugs.length === 0) return
    if (!(await confirm({
      title: `Generate ${slugs.length} tour${slugs.length > 1 ? 's' : ''}?`,
      body: 'Spends LLM + TTS credits.',
      confirmLabel: 'Generate',
    }))) return
    generateMut.mutate(slugs)
  }

  const err = error ?? generateMut.error

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
    <div className="space-y-4">
      <PageHeader
        title="Tours"
        description="The whole catalog — drafts included. Evals that fall below the bar are flagged in red."
        actions={
          <>
            {draftSlugs.length > 0 && (
              <Button variant="outline" onClick={() => void generate(draftSlugs)}>
                <Sparkles className="h-4 w-4" /> Generate all drafts ({draftSlugs.length})
              </Button>
            )}
            <Button asChild>
              <Link to="/create">
                <Plus className="h-4 w-4" /> Create tour
              </Link>
            </Button>
          </>
        }
      />

      {err && <Callout variant="error">{errMsg(err)}</Callout>}

      {integrity && integrity.tours.length > 0 && (
        <Callout variant="error" className="border-destructive/30 bg-destructive/5">
          <div className="flex items-center gap-1.5 font-medium text-destructive">
            <TriangleAlert className="h-3.5 w-3.5" />
            {integrity.tours.length} ready tour{integrity.tours.length === 1 ? '' : 's'} failing the integrity check
          </div>
          <div className="mt-1 leading-relaxed text-muted-foreground">
            A <span className="font-medium text-foreground">ready</span> tour must have audio on every stop + frame and CC BY-SA attribution on every story stop.{' '}
            {integrity.tours.map((t, i) => (
              <span key={t.id}>
                {i > 0 && ', '}
                <Link to="/tours/$id" params={{ id: t.id }} className="font-medium text-foreground hover:underline">{t.slug}</Link>
              </span>
            ))}
          </div>
        </Callout>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            wrapperClassName="min-w-[16rem] max-w-sm flex-1"
            placeholder="Search tours, slugs, regions…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <Segmented
            value={status}
            onChange={setStatus}
            options={(['all', 'ready', 'draft', 'failed'] as StatusFilter[]).map((v) => ({
              value: v,
              label: v.charAt(0).toUpperCase() + v.slice(1),
              count: countFor(v),
            }))}
          />
          <Select value={region} onValueChange={setRegion}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All regions</SelectItem>
              {regions.map((r) => (
                <SelectItem key={r.regionSlug} value={r.regionName}>{r.regionName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-sm text-muted-foreground">{view.length} of {tours.length}</span>
        </div>

        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead sortKey="headline" current={sort.key} dir={sort.dir} onSort={onSort}>Tour</SortHead>
                <SortHead sortKey="regionName" current={sort.key} dir={sort.dir} onSort={onSort}>Region</SortHead>
                <SortHead sortKey="status" current={sort.key} dir={sort.dir} onSort={onSort}>Status</SortHead>
                <SortHead sortKey="eval" current={sort.key} dir={sort.dir} onSort={onSort}>Eval</SortHead>
                <SortHead sortKey="stops" current={sort.key} dir={sort.dir} onSort={onSort} right>Stops</SortHead>
                <SortHead sortKey="distanceMeters" current={sort.key} dir={sort.dir} onSort={onSort} right>Distance</SortHead>
                <SortHead sortKey="durationSeconds" current={sort.key} dir={sort.dir} onSort={onSort} right>Duration</SortHead>
                <SortHead sortKey="updatedAt" current={sort.key} dir={sort.dir} onSort={onSort} right>Updated</SortHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isPending && <TableSkeletonRows rows={6} cols={8} />}
              {view.map((t) => (
                <TableRow key={t.id} className="cursor-pointer" onClick={() => navigate({ to: '/tours/$id', params: { id: t.id } })}>
                  <TableCell>
                    <div className="font-medium hover:underline">{t.headline}</div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {t.slug}
                      {t.authored === 'seed' && <span className="ml-2 text-muted-foreground/70">· seed</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{t.regionName}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <Badge variant={TOUR_STATUS_VARIANT[t.status] ?? 'secondary'}>{t.status}</Badge>
                      {brokenIds.has(t.id) && (
                        <Badge variant="destructive" title="Fails the audio/attribution integrity check">
                          <TriangleAlert className="h-3 w-3" /> integrity
                        </Badge>
                      )}
                      {t.status === 'draft' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); void generate([t.slug]) }}
                          title="Generate this tour (spends credits)"
                        >
                          <Sparkles className="h-3 w-3" /> Generate
                        </Button>
                      )}
                    </span>
                  </TableCell>
                  <TableCell><EvalCell ev={t.eval} /></TableCell>
                  <TableCell className="text-right font-mono">
                    {t.stops}
                    {t.frames ? <span className="text-muted-foreground"> +{t.frames}</span> : null}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{fmtMiles(t.distanceMeters)}</TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{fmtDuration(t.durationSeconds)}</TableCell>
                  <TableCell className="text-right text-muted-foreground" title={t.updatedAt}>{timeAgo(t.updatedAt)}</TableCell>
                </TableRow>
              ))}
              {!isPending && view.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8}>
                    <EmptyState icon={Map}>No tours match these filters.</EmptyState>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
