import type { CSSProperties, ReactNode } from 'react'

export interface NowCardProps {
  /** Warm uppercase kicker, e.g. "NOW PLAYING · STORY". */
  kicker: string
  /** The stop name / frame title (big placard). */
  title: string
  /** Optional mono value beside the title (e.g. "~2.3 mi"). */
  timer?: string
  /** The amber halo — on only while a clip is actively playing. Default true. */
  glow?: boolean
  /** A badge in the header row. */
  right?: ReactNode
  /** State-dependent middle: a body line (ready/done) or the Scrubber (driving). */
  children?: ReactNode
  /** The transport row, rendered at the bottom of the card. */
  transport?: ReactNode
  style?: CSSProperties
}

/**
 * The player card — the one elevated surface that holds the now-playing content, an
 * optional scrubber, and the transport as a single grounded unit. The only surface that
 * earns the campfire-amber glow, and only while a clip actively plays.
 * @startingPoint section="Player" subtitle="The now-playing card" viewport="360x300"
 */
export function NowCard(props: NowCardProps): JSX.Element
