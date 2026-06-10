import type { CSSProperties } from 'react'

export interface DividerProps {
  /** The atlas-trail dashed rule (section seams, under the now-card hint). */
  dashed?: boolean
  style?: CSSProperties
}

/** A rule. Hairline by default; `dashed` is the atlas-trail dashed line. */
export function Divider(props: DividerProps): JSX.Element
