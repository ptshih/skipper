// Shared types for the POIs feature: the corpus-action SELECTION + the resolved SCOPE the action
// dialogs render and submit. `ScopeDescriptor` wraps the selection with the human-readable readout the
// confirm dialogs show, so a spend can never run on a scope the operator can't see.

/** What a corpus action will act on: the resolved POI ids, frozen at the moment the dialog reads them.
 *
 *  ⚠ THIS USED TO BE A UNION — explicit ids OR a server-resolvable FILTER (region/source/query) plus
 *  the rows deselected after "select all matching". That Gmail model was justified as
 *  "pagination-proof", but there is no pagination to be proof of: GET /admin/pois returns the whole
 *  corpus unbounded, and DataTable's pageSize is CLIENT-side over rows the caller already holds. What
 *  it cost instead was three ways for the confirm dialog to authorise one scope and dispatch another:
 *
 *    • hand-picked ids survived filter changes while every count reduced over the VISIBLE rows, so
 *      "Enrich 1" could post 40 ids across regions the chip said were filtered out;
 *    • `region: 'all'` was encoded as "omit the region", but omitting it does not mean every region —
 *      every studio CLI falls back to DEFAULT_REGION_SLUG, so a readout of "all 900 POIs" ran Tahoe;
 *    • the filter's `source` axis was dropped for generate_narrations / offline_audit (neither kind
 *      has a --source flag) while the dialog still rendered a "Source:" chip claiming it applied.
 *
 *  Sending ids makes the authorised scope and the dispatched scope the same object by construction,
 *  and freezes it at click time rather than re-resolving a filter when the container starts. If the
 *  corpus ever grows enough that the request body matters, add real server-side pagination first —
 *  the id list is the honest thing, not the optimisation. (founder call 2026-08-02) */
export interface EnrichSelection {
  ids: string[]
}

/** The resolved selection + the active filters, for the confirm dialog's "exactly what will run"
 *  readout and the createJob body. */
export interface ScopeDescriptor {
  selection: EnrichSelection
  summary: string
  chips: { label: string; value: string }[]
}
