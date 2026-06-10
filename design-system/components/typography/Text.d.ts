import type { CSSProperties, ReactNode } from 'react'
import type { ColorRole } from '../icons/Icon'

export type TypeVariant =
  | 'wordmark'
  | 'display'
  | 'placardTitle'
  | 'titleXL'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'dim'
  | 'mono'
  | 'monoStrong'

export interface TextProps {
  /** Type-scale entry. Default `body`. */
  variant?: TypeVariant
  /** Semantic color role. Default `ink`. (Never a raw hex.) */
  color?: ColorRole
  align?: CSSProperties['textAlign']
  /** Element to render. Default `span`. */
  as?: keyof JSX.IntrinsicElements
  children?: ReactNode
  style?: CSSProperties
}

/**
 * The one text primitive. Pick a `variant` from the type scale and a semantic `color`
 * role — the system blocks raw hexes. Heavy display variants are large-only.
 */
export function Text(props: TextProps): JSX.Element
