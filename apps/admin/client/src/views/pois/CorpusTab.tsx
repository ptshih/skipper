import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Activity, Search, Sparkles, X, Zap } from 'lucide-react'
import { api, type PoiRow } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { SOURCE_META, STORY_ELIGIBILITY_META, NARRATION_META } from '@/lib/poiMeta'
import { qk } from '@/lib/queryKeys'
import { useAdminList } from '@/lib/useAdminList'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchInput } from '@/components/ui/search-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, type Column } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { SelectionBar } from '@/components/ui/selection-bar'
import type { EnrichSelection, ScopeDescriptor } from './types'
import { EnrichDialog, NarrateDialog, RescoreDialog } from './dialogs'
import { PoiDetailSheet } from './PoiDetailSheet'
import { useCorpusSelection } from './useCorpusSelection'

export function CorpusTab({ pois, loading, openPoiId }: { pois: PoiRow[]; loading: boolean; openPoiId?: string }) {
  const [q, setQ] = useState('')
  const [region, setRegion] = useState('all')
  const [source, setSource] = useState('all')
  const [flags, setFlags] = useState('all')
  const [sheetPoi, setSheetPoi] = useState<{
    id: string
    name: string
    canDelete: boolean
    hasNarration: boolean
    coveredByCluster: boolean
  } | null>(null)

  const [enrichOpen, setEnrichOpen] = useState(false)
  const [narrateOpen, setNarrateOpen] = useState(false)
  const [rescoreOpen, setRescoreOpen] = useState(false)
  const navigate = useNavigate()
  // "Select all matching" sends the region SLUG; the CLI resolves it to a server-side bbox filter
  // (geometry-first). Shared ['regions'] cache; the `regions` list below is just slug+name for the dropdown.
  const { data: regionDefs } = useAdminList(qk.regions(), async () => (await api.regions()).regions)

  // Deep-link: ?poi=<id> opens that POI's detail sheet once the cached list resolves, then strips the param.
  useEffect(() => {
    if (!openPoiId) return
    const p = pois.find((x) => x.id === openPoiId)
    if (!p) return // not loaded yet / unknown id — the effect re-runs when `pois` arrives
    setSheetPoi({
      id: p.id,
      name: p.name,
      // ⚠ narrationCount counts the poi's OWN clip. A member of a group whose fused telling is
      // released has none — but removing it rewrites that live clip's geometry, so the server
      // 409s. `coveredByCluster` is exactly "its fused telling is RELEASED".
      canDelete: p.narrationCount === 0 && !p.coveredByCluster,
      hasNarration: p.narrationCount > 0,
      coveredByCluster: p.coveredByCluster,
    })
    navigate({ to: '/pois', search: (prev) => ({ ...prev, poi: undefined }), replace: true })
  }, [openPoiId, pois, navigate])

  // Every region any poi falls in — a place can be in several, so this walks all of them.
  const regions = useMemo(() => {
    const bySlug = new Map<string, string>()
    for (const p of pois) {
      p.regionSlugs.forEach((slug, i) => {
        if (!bySlug.has(slug)) bySlug.set(slug, p.regionNames[i] ?? slug)
      })
    }
    return [...bySlug].map(([slug, name]) => ({ slug, name }))
  }, [pois])

  const filtered = useMemo(() => pois.filter((p) => {
    // ⚠ CONTAINS, not equals. A poi in two overlapping bboxes must appear under BOTH — otherwise the
    // Region filter hides it from one of them, and since a paid run now dispatches the ids of the
    // FILTERED rows, "select all" under that region would silently omit it from the job.
    if (region !== 'all' && !p.regionSlugs.includes(region)) return false
    if (source !== 'all' && p.source !== source) return false
    // The combined remediation queue (the old "Retire" tab): any POI needing attention — stale facts, a
    // narration defect, an unattributed story clip, or a drifted speakable anchor. Fix each from its row's
    // detail sheet (Re-fetch facts / Regenerate / Corrections / Delete).
    if (flags === 'flagged' && !(p.staleFacts || p.suspiciousDuration || (!p.attributed && p.narrationCount > 0) || p.speakableDrift)) return false
    if (flags === 'defect' && !p.suspiciousDuration) return false
    if (flags === 'stale' && !p.staleFacts) return false
    if (flags === 'unattrib' && (p.attributed || p.narrationCount === 0)) return false
    if (flags === 'story-eligible' && p.storyEligibility !== 'eligible') return false
    if (flags === 'story-filtered' && !p.storyEligibility.startsWith('filtered-')) return false
    if (flags === 'enriched' && !p.enriched) return false
    // The actionable gap: story-grade but no fact well yet — exactly the rows an Enrich run will bill for.
    if (flags === 'needs-enrich' && (p.storyEligibility !== 'eligible' || p.enriched)) return false
    if (flags === 'narrated' && p.narrationCount === 0) return false
    if (flags === 'narration-stale' && (p.narrationStatus !== 'stale' || p.coveredByCluster)) return false
    // region-release-gate: a narrated-but-not-yet-public clip waiting on a release.
    if (flags === 'staged' && (p.narrationStatus === 'none' || p.released)) return false
    if (flags === 'sheet-drift' && !p.sheetDrift) return false
    if (flags === 'speakable-drift' && !p.speakableDrift) return false
    if (flags === 'off-road' && !p.offRoad) return false
    if (q) {
      const s = `${p.name} ${p.sourceId}`.toLowerCase()
      if (!s.includes(q.toLowerCase())) return false
    }
    return true
  }), [pois, region, source, flags, q])

  const {
    selMode,
    selIds,
    isSelected,
    selectedIds,
    numSelected,
    numEligibleSelected,
    numNarratableSelected,
    numWithNarrationSelected,
    headerChecked,
    headerIndeterminate,
    toggleRow,
    toggleAll,
    clearSel,
  } = useCorpusSelection(filtered, pois)

  // The table-filter axes (search/region/source/flags) are independent of the row SELECTION above.
  const filtersActive = q !== '' || region !== 'all' || source !== 'all' || flags !== 'all'
  function clearFilters() {
    setQ('')
    setRegion('all')
    setSource('all')
    setFlags('all')
  }
  // The header stat badges are QUICK FILTERS — reset the other axes first so the badge's count always
  // matches what lands in the table (a stale region/source/search would otherwise silently narrow it).
  function applyQuickFilter(flag: string) {
    setQ('')
    setRegion('all')
    setSource('all')
    setFlags(flag)
  }

  // The selection IS the id list — see ./types for why the server-resolvable-filter branch was removed.
  // `selectedIds` is the same array every count on this page is derived from, so the number on a spend
  // button and the rows the job receives cannot disagree.
  function buildSelection(): EnrichSelection {
    const regionName = region !== 'all' ? (regions.find((r) => r.slug === region)?.name ?? region) : null
    const label =
      selMode === 'explicit'
        ? `${numSelected} hand-picked`
        : `${numSelected} POIs${regionName ? ` · ${regionName}` : ' · all regions'}`
    return {
      ids: selectedIds,
      label,
      // Only a whole-region select-all takes the lock — see ./types.
      ...(selMode === 'all' && region !== 'all' ? { lockRegion: region } : {}),
    }
  }
  const selectionSummary =
    (selMode === 'explicit'
      ? `${numSelected} hand-picked POI${numSelected === 1 ? '' : 's'}`
      : `all ${numSelected} POIs matching this filter${selIds.size ? ` (minus ${selIds.size} deselected)` : ''}`) +
    ` — ${numEligibleSelected} story-eligible`

  // The active filters, surfaced in every action's confirm dialog so a spend can't run on an unseen scope.
  const FLAG_LABELS: Record<string, string> = {
    flagged: 'Needs attention',
    'story-eligible': 'Story: eligible', 'story-filtered': 'Story: filtered out', enriched: 'Enriched',
    'needs-enrich': 'Eligible · un-enriched', narrated: 'Has narration', 'narration-stale': 'Narration: stale', staged: 'Narration: staged',
    'sheet-drift': 'Story: sheet drifted', 'speakable-drift': 'Speakable: drifted', defect: 'Narration defects',
    stale: 'Stale facts', unattrib: 'Unattributed', 'off-road': 'Off-road (no road anchor)',
  }
  // ⚠ Chips describe the FILTER, which only equals the run in 'all' mode. A hand-picked selection is
  // deliberately filter-independent, so showing "Region: Tahoe" beside 40 ids picked across two regions
  // would be the same lie in a new place — say so instead.
  const scopeChips: { label: string; value: string }[] = []
  if (selMode === 'explicit') {
    scopeChips.push({ label: 'Scope', value: `${numSelected} hand-picked (filters not applied)` })
  } else {
    if (region !== 'all') scopeChips.push({ label: 'Region', value: regions.find((r) => r.slug === region)?.name ?? region })
    else scopeChips.push({ label: 'Region', value: 'all regions' })
    if (source !== 'all') scopeChips.push({ label: 'Source', value: source })
    if (flags !== 'all') scopeChips.push({ label: 'Flag', value: FLAG_LABELS[flags] ?? flags })
    if (q) scopeChips.push({ label: 'Search', value: q })
  }
  const scope: ScopeDescriptor = { selection: buildSelection(), summary: selectionSummary, chips: scopeChips }

  const totals = {
    withClips: pois.filter((p) => p.narrationCount > 0).length,
    eligible: pois.filter((p) => p.storyEligibility === 'eligible').length,
    enriched: pois.filter((p) => p.enriched).length,
    // Attribution applies to STORY narrations (CC BY-SA): an unattributed narration is one that exists.
    unattrib: pois.filter((p) => !p.attributed && p.narrationCount > 0).length,
    defects: pois.filter((p) => p.suspiciousDuration).length,
    // The combined remediation queue (the folded-in "Retire" tab) — anything needing attention.
    flagged: pois.filter((p) => p.staleFacts || p.suspiciousDuration || (!p.attributed && p.narrationCount > 0) || p.speakableDrift).length,
    // Off-road = no road anchor in a snapped region (won't trigger). Its OWN stat, NOT in `flagged`:
    // backcountry isn't a fixable defect, it's a "know these won't fire" awareness count.
    offRoad: pois.filter((p) => p.offRoad).length,
  }

  // The 8-col corpus table. `colSpan`/skeleton cols derive from the column count (DataTable); the select
  // column guards its own clicks (`cellStopPropagation`) so toggling a checkbox never opens the row sheet.
  const columns: Column<PoiRow>[] = [
    {
      header: (
        <Checkbox
          checked={headerChecked}
          indeterminate={headerIndeterminate}
          onCheckedChange={toggleAll}
          aria-label="Select all"
        />
      ),
      headClassName: 'w-10',
      cellClassName: 'w-10',
      cellStopPropagation: true,
      cell: (p) => (
        <Checkbox
          checked={isSelected(p.id)}
          onCheckedChange={() => toggleRow(p.id)}
          aria-label={`Select ${p.name}`}
        />
      ),
    },
    {
      header: 'Name',
      cell: (p) => (
        <>
          <span className="font-medium hover:underline">{p.name}</span>
          {(p.staleFacts || p.suspiciousDuration) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {p.staleFacts && <Badge variant="warning">stale facts</Badge>}
              {p.suspiciousDuration && <Badge variant="destructive">narration defect</Badge>}
            </div>
          )}
        </>
      ),
    },
    {
      header: 'Source',
      cell: (p) => {
        const sm = SOURCE_META[p.source]
        return (
          <span className="inline-flex items-center gap-1.5">
            <Badge variant={sm?.variant ?? 'outline'}>{sm?.label ?? p.source}</Badge>
            <code className="font-mono text-xs text-muted-foreground">{p.sourceId}</code>
          </span>
        )
      },
    },
    {
      header: 'Region',
      cellClassName: 'text-muted-foreground',
      // Shows every region a place is in — the set a region release would publish it from.
      cell: (p) =>
        p.regionNames.length ? p.regionNames.join(' · ') : <span className="text-muted-foreground">—</span>,
    },
    {
      header: 'Story',
      cell: (p) => {
        const em = STORY_ELIGIBILITY_META[p.storyEligibility]
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant={em.variant} title={em.hint}>{em.label}</Badge>
            {p.enriched && !p.sheetDrift && (
              <Badge variant="success" title="Has a curated fact sheet — the telling grounds on it">
                enriched
              </Badge>
            )}
            {p.sheetDrift && (
              <Badge
                variant="warning"
                title="Article drifted — a curated sheet span no longer appears in the current article. Re-enrich (enrich --force) to pick up the change."
              >
                sheet drift
              </Badge>
            )}
            {p.speakableDrift && (
              <Badge
                variant="warning"
                title="Speakable anchor is implausibly far from the pin — likely a typo or hallucinated coordinate. Re-verify + reset it in the POI's Corrections tab."
              >
                speakable drift
              </Badge>
            )}
            {p.offRoad && (
              <Badge
                variant="outline"
                title="No road-snapped anchor — the nearest drivable road is beyond the kind-aware bound, so this POI triggers off its raw centroid or never. Genuine backcountry; decide whether to keep it in the corpus."
              >
                off-road
              </Badge>
            )}
            {/* A clustered member reports narrationStatus 'none' because it has no clip of its OWN —
                identical to "never generated" unless we say otherwise. It is live, via the group. */}
            {p.coveredByCluster && (
              <Badge
                variant="outline"
                title="Spoken for by its cluster's fused telling — this place is live through the group's clip, and its own clip (if it had one) no longer serves. Not a generation gap."
              >
                in a fused clip
              </Badge>
            )}
            {p.narrationStatus !== 'none' && !p.coveredByCluster && (
              <Badge variant={NARRATION_META[p.narrationStatus].variant} title={NARRATION_META[p.narrationStatus].hint}>
                {NARRATION_META[p.narrationStatus].label}
              </Badge>
            )}
            {p.narrationStatus !== 'none' && !p.released && !p.coveredByCluster && (
              <Badge variant="warning" title="Staged — not yet public (release the region or the clip)">
                staged
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      header: 'Attribution',
      cell: (p) =>
        p.narrationCount > 0 ? (
          <Badge variant={p.attributed ? 'success' : 'destructive'}>{p.attributed ? '✓' : 'missing'}</Badge>
        ) : (
          <span className="text-muted-foreground">n/a</span>
        ),
    },
    {
      header: 'Facts hash',
      cellClassName: 'font-mono text-muted-foreground',
      cell: (p) => (p.factsHash ? p.factsHash.slice(0, 7) : <span className="text-muted-foreground">—</span>),
    },
    {
      header: 'Added',
      headClassName: 'text-right',
      cellClassName: 'text-right text-muted-foreground',
      cell: (p) => timeAgo(p.createdAt),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {totals.withClips > 0 && (
          <button onClick={() => applyQuickFilter('narrated')}>
            <Badge className="cursor-pointer">{totals.withClips} with narrations</Badge>
          </button>
        )}
        {totals.eligible > 0 && (
          <button onClick={() => applyQuickFilter('story-eligible')}>
            <Badge variant="default" className="cursor-pointer">{totals.eligible} story-eligible</Badge>
          </button>
        )}
        {totals.eligible > 0 && (
          <button onClick={() => applyQuickFilter(totals.enriched < totals.eligible ? 'needs-enrich' : 'enriched')}>
            <Badge variant={totals.enriched > 0 ? 'success' : 'outline'} className="cursor-pointer">
              {totals.enriched}/{totals.eligible} enriched
            </Badge>
          </button>
        )}
        {totals.unattrib > 0 && <Badge variant="destructive">{totals.unattrib} unattributed</Badge>}
        {totals.defects > 0 && (
          <button onClick={() => applyQuickFilter('defect')}>
            <Badge variant="destructive" className="cursor-pointer">
              {totals.defects} narration defect{totals.defects > 1 ? 's' : ''}
            </Badge>
          </button>
        )}
        {totals.flagged > 0 && (
          <button onClick={() => applyQuickFilter('flagged')} title="Stale facts, narration defects, unattributed clips, or drifted speakable anchors">
            <Badge variant="warning" className="cursor-pointer">{totals.flagged} need attention</Badge>
          </button>
        )}
        {totals.offRoad > 0 && (
          <button onClick={() => applyQuickFilter('off-road')} title="No road-snapped anchor in a snapped region — these fire off their centroid or not at all. Genuine backcountry (peaks, wilderness); review whether to keep them in the corpus.">
            <Badge variant="outline" className="cursor-pointer">{totals.offRoad} off-road</Badge>
          </button>
        )}
        <span className="ml-auto text-sm text-muted-foreground">{filtered.length} of {pois.length}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          wrapperClassName="min-w-[16rem] flex-1"
          placeholder="Search name, source id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select value={region} onValueChange={setRegion}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {regions.map((r) => <SelectItem key={r.slug} value={r.slug}>{r.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={setSource}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            <SelectItem value="wikipedia">Wikipedia</SelectItem>
            <SelectItem value="wikidata">Wikidata</SelectItem>
          </SelectContent>
        </Select>
        <Select value={flags} onValueChange={setFlags}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All flags</SelectItem>
            <SelectItem value="flagged">Needs attention (any flag)</SelectItem>
            <SelectItem value="story-eligible">Story: eligible</SelectItem>
            <SelectItem value="story-filtered">Story: filtered out</SelectItem>
            <SelectItem value="enriched">Enriched</SelectItem>
            <SelectItem value="needs-enrich">Eligible · un-enriched</SelectItem>
            <SelectItem value="narrated">Narration: any</SelectItem>
            <SelectItem value="narration-stale">Narration: stale</SelectItem>
            <SelectItem value="staged">Narration: staged (unreleased)</SelectItem>
            <SelectItem value="sheet-drift">Story: sheet drifted</SelectItem>
            <SelectItem value="speakable-drift">Speakable: drifted</SelectItem>
            <SelectItem value="off-road">Off-road: no road anchor</SelectItem>
            <SelectItem value="defect">Narration defects</SelectItem>
            <SelectItem value="stale">Stale facts</SelectItem>
            <SelectItem value="unattrib">Unattributed</SelectItem>
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearFilters}>
            <X className="h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
      </div>

      {numSelected > 0 && (
        <SelectionBar>
          <span className="mr-1 font-medium">{selectionSummary}</span>
          <Button size="sm" onClick={() => setEnrichOpen(true)}>
            <Sparkles className="h-4 w-4" /> Enrich {numEligibleSelected}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setNarrateOpen(true)}>
            <Zap className="h-4 w-4" /> Narrate {numNarratableSelected}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRescoreOpen(true)}>
            <Activity className="h-4 w-4" /> Re-score {numWithNarrationSelected}
          </Button>
          <button className="text-xs text-muted-foreground hover:text-foreground" onClick={clearSel}>
            Clear
          </button>
        </SelectionBar>
      )}

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(p) => p.id}
        loading={loading}
        skeletonRows={8}
        pageSize={50}
        onRowClick={(p) => setSheetPoi({
      id: p.id,
      name: p.name,
      // ⚠ narrationCount counts the poi's OWN clip. A member of a group whose fused telling is
      // released has none — but removing it rewrites that live clip's geometry, so the server
      // 409s. `coveredByCluster` is exactly "its fused telling is RELEASED".
      canDelete: p.narrationCount === 0 && !p.coveredByCluster,
      hasNarration: p.narrationCount > 0,
      coveredByCluster: p.coveredByCluster,
    })}
        rowClassName={(p) => (isSelected(p.id) ? 'bg-muted/40' : undefined)}
        empty={<EmptyState icon={Search}>No POIs match these filters.</EmptyState>}
      />

      {sheetPoi && (
        <PoiDetailSheet
          poiId={sheetPoi.id}
          poiName={sheetPoi.name}
          canDelete={sheetPoi.canDelete}
          coveredByCluster={sheetPoi.coveredByCluster}
          hasNarration={sheetPoi.hasNarration}
          open={!!sheetPoi}
          onOpenChange={(o) => { if (!o) setSheetPoi(null) }}
        />
      )}

      <EnrichDialog
        open={enrichOpen}
        onOpenChange={setEnrichOpen}
        scope={scope}
        onSubmitted={() => { clearSel(); navigate({ to: '/jobs' }) }}
      />
      <NarrateDialog
        open={narrateOpen}
        onOpenChange={setNarrateOpen}
        scope={scope}
        onSubmitted={() => { clearSel(); navigate({ to: '/jobs' }) }}
      />
      <RescoreDialog
        open={rescoreOpen}
        onOpenChange={setRescoreOpen}
        scope={scope}
        onSubmitted={() => { clearSel(); navigate({ to: '/jobs' }) }}
      />
    </div>
  )
}
