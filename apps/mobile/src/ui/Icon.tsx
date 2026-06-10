// Vector icons (Ionicons via @expo/vector-icons). Replaces emoji glyphs, which
// don't render in this build — the system font has no color-emoji fallback, so
// 📖/☕ came out as tofu. Font-based icons render reliably and can be tinted with
// theme colors. Semantic names keep call sites intent-revealing; the Ionicons
// mapping lives here so it's the one place to re-skin (toward the SVG enamel
// badges of DESIGN §9). Decorative by default — parents carry the a11y label.
import type { ComponentProps } from 'react'
import type { StyleProp, TextStyle } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useTheme } from '../theme/ThemeProvider'
import type { ThemeColors } from '../theme/theme'

export type IconName =
  | 'story'
  | 'scenic'
  | 'break'
  | 'play'
  | 'pause'
  | 'restart'
  | 'back'
  | 'prev'
  | 'next'
  | 'back15'
  | 'forward15'
  | 'nowPlaying'
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
  | 'nearMe'
  | 'download'
  | 'downloaded'
  | 'more'

const IONICON: Record<IconName, ComponentProps<typeof Ionicons>['name']> = {
  // stop types
  story: 'book-outline',
  scenic: 'telescope-outline',
  break: 'cafe-outline',
  // transport
  play: 'play',
  pause: 'pause',
  restart: 'reload',
  back: 'chevron-back', // the global header back affordance (chevron-in-a-circle)
  prev: 'play-skip-back',
  next: 'play-skip-forward',
  // jog by 15s — the no-bar double-triangle (scan), distinct from the bar'd skip-stop
  back15: 'play-back',
  forward15: 'play-forward',
  // row states
  nowPlaying: 'musical-note',
  passed: 'checkmark-circle',
  upcoming: 'caret-forward',
  // misc
  ticket: 'ticket-outline',
  car: 'car',
  day: 'sunny-outline',
  night: 'moon-outline',
  auto: 'contrast-outline', // half-lit disc = "follow the phone" (system appearance)
  settings: 'settings-outline',
  // filters / location picker (THE DRIVES "Where to?")
  expand: 'chevron-down', // a filter chip that opens a picker
  check: 'checkmark', // the selected row in the picker
  region: 'location-outline', // a region/destination row + the location chip glyph
  close: 'close', // dismiss a modal sheet
  nearMe: 'navigate', // reserved: the deferred "Drives near you" GPS shortcut (v2)
  download: 'download-outline', // grab a tour for offline play (Tahoe dead zones)
  downloaded: 'cloud-done-outline', // a tour that's saved to disk + plays with no signal
  more: 'ellipsis-horizontal', // header overflow menu (secondary/utility actions)
}

export interface IconProps {
  name: IconName
  size?: number
  color?: keyof ThemeColors
  style?: StyleProp<TextStyle>
}

export function Icon({ name, size = 18, color = 'ink', style }: IconProps) {
  const { colors } = useTheme()
  return (
    <Ionicons
      name={IONICON[name]}
      size={size}
      color={colors[color]}
      style={style}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  )
}
