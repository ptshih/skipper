export interface FilterChipProps {
  /** Chip label (e.g. the selected region, or "All regions"). */
  label: string
  /** Filled pine when a filter is applied; outlined when idle. */
  active?: boolean
  onPress?: () => void
}

/**
 * The "Where to?" region filter chip. Pine-outlined idle, pine-filled active, with a
 * trailing chevron that signals it opens a picker. The extension point for future
 * filters (duration, interests) — just more chips in the same bar.
 */
export function FilterChip(props: FilterChipProps): JSX.Element
