import type { CSSProperties } from 'react'
import type { IconName } from '../icons/Icon'

export type BadgeTone = 'pine' | 'amber' | 'teal' | 'rust' | 'neutral'

export interface BadgeProps {
  /** Pill text. Casing is caller-controlled (UPPER for status, Title for phrases). */
  label?: string
  /** Optional leading glyph. */
  icon?: IconName
  /** Maps to a contrast-safe color pairing. Default `neutral`. */
  tone?: BadgeTone
  /** Solid enamel disc instead of an outline. */
  filled?: boolean
  style?: CSSProperties
}

/**
 * The enamel travel pill — stop types, tour length, status. Tone picks a contrast-safe
 * color pairing; amber text always uses the burnt/lantern accent, never the fill amber.
 */
export function Badge(props: BadgeProps): JSX.Element
