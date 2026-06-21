// Shared types for the POIs feature: the corpus-action SELECTION + the resolved SCOPE the action
// dialogs render and submit. `EnrichSelection` is the Gmail-style selection model (explicit ids OR a
// server-resolvable filter minus deselected ids); `ScopeDescriptor` wraps it with the human-readable
// readout the confirm dialogs show so a spend can never run on a scope the operator can't see.

/** What to enrich, resolved server-side. Either a hand-picked id list, OR a FILTER (the table's
 *  server-resolvable axes) plus the rows DESELECTED after a "select all matching" — the Gmail model,
 *  so server-side pagination never has to enumerate every id client-side. */
export type EnrichSelection =
  | { kind: 'explicit'; ids: string[] }
  | { kind: 'all'; filter: { region?: string; source?: string; query?: string }; excludeIds: string[] }

/** The resolved selection + the active filters, for the confirm dialog's "exactly what will run" readout
 *  and the createJob body. `selection` is the EnrichSelection union. */
export interface ScopeDescriptor {
  selection: EnrichSelection
  summary: string
  chips: { label: string; value: string }[]
}
