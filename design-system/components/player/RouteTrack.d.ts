import type { CSSProperties } from 'react'

export interface RouteTrackProps {
  /** Position of the car token, 0..1. */
  progress?: number
  /** Track thickness in px. Default 6. */
  height?: number
  /** The token's amber halo. Default true; drop it while a NOW card is lit. */
  glow?: boolean
  style?: CSSProperties
}

/**
 * The signature motif — a dashed atlas trail with the skipper's car token gliding along
 * it. The one moving/glowing thing on a drive. Drive it with a 0..1 progress value.
 * @startingPoint section="Player" subtitle="The car-token-on-trail motif" viewport="360x40"
 */
export function RouteTrack(props: RouteTrackProps): JSX.Element
