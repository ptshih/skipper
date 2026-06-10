import type { CSSProperties } from 'react'
import type { IconName } from '../icons/Icon'

export interface ButtonProps {
  /** Button label. */
  title: string
  onPress?: () => void
  /** `primary` enamel CTA (≥60pt), `secondary` outlined placard, `ghost` text link. */
  variant?: 'primary' | 'secondary' | 'ghost'
  /** Leading vector icon. */
  icon?: IconName
  disabled?: boolean
  loading?: boolean
  /** Stretch to fill the container. Default true. */
  fullWidth?: boolean
  /** Dusk primary buttons wear a campfire-amber glow by default; pass false to drop it
   *  where the screen's one-amber-glow budget is already spent (e.g. an in-player play
   *  button beside a lit NOW card). */
  glow?: boolean
  style?: CSSProperties
}

/**
 * The enamel CTA. Primary is a ranger-green sign in daylight, a campfire-lit amber
 * button at dusk; secondary is an outlined placard; ghost is a text link.
 * @startingPoint section="Buttons" subtitle="Primary / secondary / ghost CTA" viewport="360x80"
 */
export function Button(props: ButtonProps): JSX.Element
