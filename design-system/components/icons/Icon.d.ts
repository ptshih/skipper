import type { CSSProperties } from 'react'

/** Semantic color role — the only colors a component may reference. */
export type ColorRole =
  | 'surface'
  | 'surfaceRaised'
  | 'surfaceSunken'
  | 'keyline'
  | 'ink'
  | 'inkDim'
  | 'inkFaint'
  | 'accent'
  | 'accentWarm'
  | 'amberToken'
  | 'onAmber'
  | 'water'
  | 'primaryFill'
  | 'onPrimary'
  | 'trackActive'
  | 'trackInactive'
  | 'rule'
  | 'danger'
  | 'onDanger'

/** Semantic icon names, mapped to Ionicons under the hood. */
export type IconName =
  | 'story'
  | 'scenic'
  | 'break'
  | 'play'
  | 'pause'
  | 'restart'
  | 'back'
  | 'back15'
  | 'forward15'
  | 'passed'
  | 'upcoming'
  | 'ticket'
  | 'car'
  | 'day'
  | 'night'
  | 'auto'
  | 'settings'
  | 'expand'
  | 'check'
  | 'region'
  | 'close'
  | 'downloaded'
  | 'more'

export interface IconProps {
  /** Semantic icon name (mapped to an Ionicon). */
  name: IconName
  /** Pixel size. Default 18. */
  size?: number
  /** Semantic color role to tint the glyph. Default `ink`. */
  color?: ColorRole
  style?: CSSProperties
}

/**
 * The Trailhead 89 vector icon — the same Ionicons set the app ships, rendered via
 * the Ionicons web component. Use these, never emoji (the brand faces carry no emoji
 * glyphs). The host page must load the ionicons CDN module once.
 */
export function Icon(props: IconProps): JSX.Element
