import type { CSSProperties } from 'react'
import type { IconName } from '../icons/Icon'

interface SingleCTA {
  icon?: IconName
  title: string
  onPress: () => void
  glow?: boolean
  secondary?: { title: string; onPress: () => void }
}

export interface TransportBarProps {
  /** One full-width CTA instead of the transport row (the ready/done states). */
  single?: SingleCTA
  /** Transport-row state. */
  playing?: boolean
  onPlayPause?: () => void
  onSeekBack?: () => void
  onSeekForward?: () => void
  canSeek?: boolean
  /** Low-emphasis ghost action beneath the row (e.g. End drive). */
  secondary?: { title: string; onPress: () => void }
  style?: CSSProperties
}

/**
 * The player transport — either a single CTA (ready/done) or the icon-forward row
 * ⟲15 · [play/pause] · 15⟳. The center disc is glow-less; the lit card/token owns the
 * one amber glow.
 */
export function TransportBar(props: TransportBarProps): JSX.Element
