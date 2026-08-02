import { useMemo, useState } from 'react'
import type { PoiRow } from '@/lib/api'

// The Gmail-style bulk-select engine for the corpus table. In 'explicit' mode `selIds` are the CHOSEN
// rows; in 'all' mode every filtered row is chosen EXCEPT `selIds` (the deselected).
//
// ⚠ EVERY COUNT HERE IS DERIVED FROM `selectedRows`, THE EXACT SET THAT GETS DISPATCHED. That is the
// whole point of this hook's shape. Counts used to reduce over `filtered` — the VISIBLE rows — while a
// hand-picked run posted `selIds`, which survive filter changes. So an operator could tick 40 POIs,
// switch the flag filter to sanity-check, see "Enrich 1", and authorise a 40-POI paid run spanning
// regions the dialog's own chip said were filtered out. A number on a spend button has to be computed
// from the same array the request body is built from; anything else is a coincidence waiting to break.
//
// `all` is the FULL corpus (unfiltered), needed because an explicit pick is deliberately independent of
// the filter — the rows a hand-pick refers to may not be on screen any more.
export function useCorpusSelection(filtered: PoiRow[], all: PoiRow[]) {
  const [selMode, setSelMode] = useState<'explicit' | 'all'>('explicit')
  const [selIds, setSelIds] = useState<Set<string>>(new Set())

  const isSelected = (id: string) => (selMode === 'all' ? !selIds.has(id) : selIds.has(id))

  // THE dispatched set. 'all' = every VISIBLE row minus the deselected; 'explicit' = exactly what was
  // ticked, resolved against the whole corpus so a pick made under a different filter still counts.
  const selectedRows = useMemo(
    () => (selMode === 'all' ? filtered.filter((p) => !selIds.has(p.id)) : all.filter((p) => selIds.has(p.id))),
    [selMode, selIds, filtered, all],
  )
  const selectedIds = useMemo(() => selectedRows.map((p) => p.id), [selectedRows])

  const numSelected = selectedRows.length
  // The ENRICH-relevant count: the server only enriches (+bills for) story-eligible rows, so the headline
  // number must reflect that, not the raw selection (which can include scenic/wikidata pins the gate drops).
  const numEligibleSelected = useMemo(
    () => selectedRows.filter((p) => p.storyEligibility === 'eligible').length,
    [selectedRows],
  )
  // Narrate bills for enriched story POIs (un-enriched → scenic, skipped); Re-score acts on places that
  // already HAVE a narration. Per-action counts so each button's number reflects what it will touch.
  const numNarratableSelected = useMemo(
    () => selectedRows.filter((p) => p.storyEligibility === 'eligible' && p.enriched).length,
    [selectedRows],
  )
  const numWithNarrationSelected = useMemo(
    () => selectedRows.filter((p) => p.narrationCount > 0).length,
    [selectedRows],
  )
  // ⚠ The header checkbox is about the TABLE, so it stays relative to the visible rows — unlike every
  // count above, which is about the RUN. Conflating the two is what produced the bug.
  const numVisibleSelected = useMemo(
    () => filtered.reduce((n, p) => n + (isSelected(p.id) ? 1 : 0), 0),
    [filtered, selMode, selIds],
  )
  const headerChecked = filtered.length > 0 && numVisibleSelected === filtered.length
  const headerIndeterminate = numVisibleSelected > 0 && numVisibleSelected < filtered.length

  function toggleRow(id: string) {
    setSelIds((prev) => {
      const next = new Set(prev) // membership = the EXCEPTION to the mode (chosen in explicit, deselected in all)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    // Any selection → clear; nothing selected → "select all matching". Keyed on the VISIBLE count, so
    // the header checkbox stays a control over the table it sits in.
    setSelMode(numVisibleSelected > 0 ? 'explicit' : 'all')
    setSelIds(new Set())
  }
  function clearSel() {
    setSelMode('explicit')
    setSelIds(new Set())
  }

  return {
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
  }
}
