import type { CSSProperties, ReactNode } from 'react'

export interface CardProps {
  children: ReactNode
  /** Adds the carved double-keyline + corner screw-dots. NON-driving surfaces only. */
  framed?: boolean
  /** Selected state — swaps the hairline rule for a pine keyline. */
  active?: boolean
  onPress?: () => void
  style?: CSSProperties
}

/**
 * The ranger placard. Plain by default (glanceable for the car); `framed` adds the
 * carved ornament for non-driving surfaces like detail headers and the home hero.
 * @startingPoint section="Surfaces" subtitle="Placard card, plain or framed" viewport="360x160"
 */
export function Card(props: CardProps): JSX.Element
