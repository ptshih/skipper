import type { IconName } from '../icons/Icon'

export type StopState = 'upcoming' | 'active' | 'passed'

export interface StopRowProps {
  name: string
  sublabel?: string
  /** Glance-state. Default `upcoming`. */
  state?: StopState
  /** Stop-type icon (story / scenic / break). */
  icon?: IconName
  /** Tappable (preview only — jump to this stop). Omit for a read-only itinerary. */
  onPress?: () => void
}

/**
 * A stop in the route list. Three glance-states: upcoming (calm), active (a sunken
 * you-are-here well + pine accent, never amber), passed (dimmed + a quiet check).
 * Usually composed by StopList rather than used directly.
 */
export function StopRow(props: StopRowProps): JSX.Element
