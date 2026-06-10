export interface ScrubberProps {
  positionMs: number
  durationMs: number
  /** Seek target in ms — fired on click/drag. */
  onSeek?: (ms: number) => void
  disabled?: boolean
}

/**
 * The in-clip position bar — a sunken atlas well, a pine traveled fill, and the amber
 * car-token thumb, with stamped mono time labels. Click anywhere to seek.
 */
export function Scrubber(props: ScrubberProps): JSX.Element
