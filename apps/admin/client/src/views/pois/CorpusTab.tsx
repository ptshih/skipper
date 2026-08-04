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
import { FilterSelect } from '@/components/ui/filter-toolbar'
import { DataTable, type Column } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { SelectionBar } from '@/components/ui/selection-bar'
import type { EnrichSelection, ScopeDescriptor } from './types'
import { EnrichDialog, NarrateDialog, RescoreDialog } from './dialogs'
import { PoiDetailSheet } from './PoiDetailSheet'
import { useCorpusSelection } from './useCorpusSelection'

// The two STATIC filter option lists (the region list is built from data). Module-level so they aren't
// re-allocated per render, and so the `flags` values sit in one block: each must have a matching
// `flags === '…'` guard in the `filtered` predicate below, and a value with no guard silently filters
// nothing rather than failing.
const SOURCE_OPTIONS = [
  { value: 'wikipedia', label: 'Wikipedia' },
  { value: 'wikidata', label: 'Wikidata' },
]

// The flag vocabulary, ONE list. Each entry carries the DROPDOWN label and the shorter SCOPE-CHIP label:
// deliberately different wording for two surfaces (a chip sits inline in a sentence, an option doesn't),
// but ONE key set — these were two hand-kept tables, free to gain a flag in the dropdown that the chip
// then rendered as its raw slug. Every `value` must also have a matching `flags === '…'` guard in the
// `filtered` predicate below; a value with no guard silently filters nothing rather than failing.
const FLAG_FILTERS = [
  { value: 'flagged', label: 'Needs attention (any flag)', chip: 'Needs attention' },
  { value: 'story-eligible', label: 'Story: eligible', chip: 'Story: eligible' },
  { value: 'story-filtered', label: 'Story: filtered out', chip: 'Story: filtered out' },
  { value: 'enriched', label: 'Enriched', chip: 'Enriched' },
  { value: 'needs-enrich', label: 'Eligible · un-enriched', chip: 'Eligible · un-enriched' },
  { value: 'narrated', label: 'Narration: any', chip: 'Has narration' },
  { value: 'excluded', label: 'Excluded', chip: 'Excluded' },
  { value: 'hide-excluded', label: 'Hide excluded', chip: 'Excluded hidden' },
  { value: 'narration-stale', label: 'Narration: stale', chip: 'Narration: stale' },
  { value: 'staged', label: 'Narration: staged (unreleased)', chip: 'Narration: staged' },
  { value: 'sheet-drift', label: 'Story: sheet drifted', chip: 'Story: sheet drifted' },
  { value: 'speakable-drift', label: 'Speakable: drifted', chip: 'Speakable: drifted' },
  { value: 'off-road', label: 'Off-road: no road anchor', chip: 'Off-road (no road anchor)' },
  { value: 'defect', label: 'Narration defects', chip: 'Narration defects' },
  { value: 'stale', label: 'Stale facts', chip: 'Stale facts' },
  { value: 'unattrib', label: 'Unattributed', chip: 'Unattributed' },
]

const FLAG_OPTIONS = FLAG_FILTERS.map(({ value, label }) => ({ value, label }))
const FLAG_LABELS: Record<string, string> = Object.fromEntries(FLAG_FILTERS.map((f) => [f.value, f.chip]))

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
    // ⚠ Exclusion is enforced by the DRIVE build path (apps/api drives.ts `isNull(excludedReason)`) but
    // NOT by the paid CLIs, so an excluded place still costs money to enrich/narrate and will never be
    // served. "Hide excluded" is the axis that lets an operator keep it out of a run.
    if (flags === 'excluded' && !p.excludedReason) return false
    if (flags === 'hide-excluded' && p.excludedReason) return false
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
    numExcludedSelected,
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
    ` — ${numEligibleSelected} story-eligible` +
    (numExcludedSelected > 0
      ? `, ${numExcludedSelected} EXCLUDED (still billed — hidden from new drives, so nobody hears them)`
      : '')

  // The active filters, surfaced in every action's confirm dialog so a spend can't run on an unseen scope.
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

  // ⚠ CORPUS-WIDE on purpose — none of these reads the search box or the filter axes (that is why
  // `applyQuickFilter` resets the others), so they change only when the corpus does. Memoized on `pois`
  // and accumulated in ONE pass: as seven bare `.filter()` calls in the render body they re-scanned the
  // whole corpus seven times per keystroke, which grows with every region added.
  const totals = useMemo(() => {
    const t = { withClips: 0, eligible: 0, enriched: 0, unattrib: 0, defects: 0, flagged: 0, offRoad: 0 }
    for (const p of pois) {
      // Attribution applies to STORY narrations (CC BY-SA): an unattributed narration is one that exists.
      const unattributed = !p.attributed && p.narrationCount > 0
      if (p.narrationCount > 0) t.withClips += 1
      if (p.storyEligibility === 'eligible') t.eligible += 1
      if (p.enriched) t.enriched += 1
      if (unattributed) t.unattrib += 1
      if (p.suspiciousDuration) t.defects += 1
      // The combined remediation queue (the folded-in "Retire" tab) — anything needing attention.
      if (p.staleFacts || p.suspiciousDuration || unattributed || p.speakableDrift) t.flagged += 1
      // Off-road = no road anchor in a snapped region (won't trigger). Its OWN stat, NOT in `flagged`:
      // backcountry isn't a fixable defect, it's a "know these won't fire" awareness count.
      if (p.offRoad) t.offRoad += 1
    }
    return t
  }, [pois])

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
            {/* ⚠ First, because it overrides everything to its right: an excluded place is hidden from
                NEW drives whatever its story grade. It is still billable — the paid CLIs don't skip
                it — which is why this belongs on the row an operator selects from, not only in the
                detail sheet where it already had a banner. */}
            {p.excludedReason && (
              <Badge variant="destructive" title={`Excluded — hidden from new drives. ${p.excludedReason}`}>
                excluded
              </Badge>
            )}
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
        <FilterSelect
          value={region}
          onChange={setRegion}
          allLabel="All regions"
          options={regions.map((r) => ({ value: r.slug, label: r.name }))}
        />
        <FilterSelect value={source} onChange={setSource} allLabel="All sources" options={SOURCE_OPTIONS} />
        <FilterSelect value={flags} onChange={setFlags} allLabel="All flags" options={FLAG_OPTIONS} />
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
