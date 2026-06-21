import { useMemo, useState } from 'react'
import type { PoiRow } from '@/lib/api'

// The Gmail-style bulk-select engine for the corpus table. In 'explicit' mode `selIds` are the CHOSEN
// rows; in 'all' mode every filtered row is chosen EXCEPT `selIds` (the deselected). That lets "select
// all matching" send a server-side FILTER (pagination-proof) rather than enumerating every id, while
// still supporting hand-picks + unchecking. Counts are derived over the currently-`filtered` rows, with
// the per-action variants the action buttons need (eligible / narratable / has-narration).
export function useCorpusSelection(filtered: PoiRow[]) {
  const [selMode, setSelMode] = useState<'explicit' | 'all'>('explicit')
  const [selIds, setSelIds] = useState<Set<string>>(new Set())

  const isSelected = (id: string) => (selMode === 'all' ? !selIds.has(id) : selIds.has(id))

  const numSelected = useMemo(
    () => filtered.reduce((n, p) => n + (isSelected(p.id) ? 1 : 0), 0),
    [filtered, selMode, selIds],
  )
  // The ENRICH-relevant count: the server only enriches (+bills for) story-eligible rows, so the headline
  // number must reflect that, not the raw selection (which can include scenic/wikidata pins the gate drops).
  const numEligibleSelected = useMemo(
    () => filtered.reduce((n, p) => n + (isSelected(p.id) && p.storyEligibility === 'eligible' ? 1 : 0), 0),
    [filtered, selMode, selIds],
  )
  // Narrate bills for enriched story POIs (un-enriched → scenic, skipped); Re-score acts on places that
  // already HAVE a narration. Per-action counts so each button's number reflects what it will touch.
  const numNarratableSelected = useMemo(
    () => filtered.reduce((n, p) => n + (isSelected(p.id) && p.storyEligibility === 'eligible' && p.enriched ? 1 : 0), 0),
    [filtered, selMode, selIds],
  )
  const numWithNarrationSelected = useMemo(
    () => filtered.reduce((n, p) => n + (isSelected(p.id) && p.narrationCount > 0 ? 1 : 0), 0),
    [filtered, selMode, selIds],
  )
  const headerChecked = filtered.length > 0 && numSelected === filtered.length
  const headerIndeterminate = numSelected > 0 && numSelected < filtered.length

  function toggleRow(id: string) {
    setSelIds((prev) => {
      const next = new Set(prev) // membership = the EXCEPTION to the mode (chosen in explicit, deselected in all)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleAll() {
    // Any selection → clear; nothing selected → "select all matching".
    setSelMode(numSelected > 0 ? 'explicit' : 'all')
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
