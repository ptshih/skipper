import { useMemo, useState, type ElementType } from 'react'
import { Activity, Combine, Filter, MapPin, RefreshCw, Scissors, Sparkles, Trash2, Zap } from 'lucide-react'
import { api, type RunEvent } from '@/lib/api'
import { qk } from '@/lib/queryKeys'
import { useAdminList } from '@/lib/useAdminList'

// Shared run-presentation vocabulary for the two run pages (Jobs + Evals) and their drawers — they read
// the same ['runs'] cache, so this used to be duplicated verbatim in both views.

// Poll cadence for the shared ['runs'] cache. Both run lists auto-refresh at this interval AND label it
// (via <AutoRefreshControl>), from ONE constant so the cadence and its label can't drift apart.
export const RUNS_REFETCH_MS = 15_000

// Kind → label/icon. generate / resynth / patch_clip are LEGACY (deferred in V2) — kept so historical
// job rows render a readable label; they are no longer dispatchable here.
export const KIND_META: Record<string, { label: string; icon: ElementType }> = {
  generate:        { label: 'Generate',          icon: Sparkles },
  resynth:         { label: 'Resynth',           icon: RefreshCw },
  patch_clip:      { label: 'Patch clip',        icon: Scissors },
  resynth_narration: { label: 'Re-synth narration', icon: RefreshCw },
  refetch_facts:   { label: 'Re-fetch facts',    icon: RefreshCw },
  sweep_orphans:   { label: 'Sweep orphans',     icon: Trash2 },
  discover_pois:   { label: 'Discover POIs',     icon: Filter },
  enrich_pois:     { label: 'Enrich corpus',     icon: Sparkles },
  generate_narrations: { label: 'Generate Narration', icon: Zap },
  generate_cluster_narrations: { label: 'Fuse clusters', icon: Combine },
  curate_places:   { label: 'Curate places',     icon: MapPin },
  offline_audit:   { label: 'Re-score corpus',   icon: Activity },
}

// A run targeting no region (whole-corpus) leaves its slug NULL → "All". Legacy sentinels map to a
// friendly label rather than a raw slug.
export const TARGET_SENTINELS: Record<string, string> = {
  'roam-corpus': 'All',
  'region-corpus': 'whole corpus',
  narration: 'all clips',
}

// The Target cell shared by both run lists + drawers: a null slug or a known sentinel renders
// italic + muted; anything else shows the raw slug.
export function RunTarget({ slug }: { slug: string | null }) {
  if (!slug) return <span className="italic text-muted-foreground">All</span>
  const sentinel = TARGET_SENTINELS[slug]
  if (sentinel) return <span className="italic text-muted-foreground">{sentinel}</span>
  return <>{slug}</>
}

/**
 * The filter state both run pages need, over the shared ['runs'] cache.
 *
 * Jobs and Evals read the same cache and had grown the same scaffolding side by side: a
 * kind/status/search state trio, a `filtered` memo of the same shape, and a `kindsInView` memo. This
 * module already exists because the PRESENTATIONAL half of that pair was deduped once; this is the
 * half that was left behind.
 *
 * What genuinely differs stays with the caller and is passed in: which `source` the page shows, what
 * its status buckets mean (Jobs has running/failed/ok, Evals has failed/partial/ok), and which fields
 * its search box looks at. The deep-link effect deliberately stays in each view too — Jobs opens its
 * drawer from a row it must find in the list, Evals opens by id and re-fetches, so they are not the
 * same effect wearing different names.
 */
export function useRunsFilter(
  source: RunEvent['source'],
  matchesStatus: (r: RunEvent, status: string) => boolean,
  searchText: (r: RunEvent) => string,
) {
  const [kindFilter, setKindFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [q, setQ] = useState('')

  const list = useAdminList(qk.runs(), async () => (await api.runs()).runs, { refetchInterval: RUNS_REFETCH_MS })
  const rows = useMemo(() => list.data.filter((r) => r.source === source), [list.data, source])

  const filtered = useMemo(
    () =>
      rows.filter((r) => {
        if (kindFilter !== 'all' && r.kind !== kindFilter) return false
        if (statusFilter !== 'all' && !matchesStatus(r, statusFilter)) return false
        if (q && !searchText(r).toLowerCase().includes(q.toLowerCase())) return false
        return true
      }),
    // matchesStatus/searchText are inline arrows at both call sites, so they are new every render;
    // depending on them would rebuild this memo every time and defeat it. They are pure functions of
    // their arguments, so the values below are the real inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, kindFilter, statusFilter, q],
  )

  /** Kind options scoped to the rows actually on screen — no dead options for kinds that never ran. */
  const kindsInView = useMemo(() => [...new Set(rows.map((r) => r.kind))].sort(), [rows])

  return {
    rows,
    filtered,
    kindsInView,
    kindFilter,
    setKindFilter,
    statusFilter,
    setStatusFilter,
    q,
    setQ,
    error: list.error,
    isPending: list.isPending,
    isFetching: list.isFetching,
    refetch: list.refetch,
  }
}
