import type { CSSProperties } from 'react'
import type { IconName } from '../icons/Icon'
import type { StopState } from './StopRow'

export interface StopListItem {
  seq: number
  name: string
  sublabel?: string
  icon?: IconName
  state?: StopState
}

export interface StopListProps {
  items: StopListItem[]
  /** Section label inside the card, e.g. "THE ROUTE · 10 STOPS". */
  title?: string
  /** Tap a row to jump there (preview only). Omit for a read-only itinerary. */
  onPressItem?: (seq: number) => void
  /** Fixed-shell mode: the card stays put and only rows scroll inside it (the player). */
  scroll?: boolean
  style?: CSSProperties
}

/**
 * The route itinerary — one raised card of hairline-ruled StopRows. Shared by the tour
 * detail (all upcoming) and the in-drive player (per-stop active/passed state).
 * @startingPoint section="Player" subtitle="The route itinerary card" viewport="360x320"
 */
export function StopList(props: StopListProps): JSX.Element
