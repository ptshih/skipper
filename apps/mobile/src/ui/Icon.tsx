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
  | 'update'
  | 'more'
  | 'roam'
  | 'music'
  | 'patter'
  | 'map'
  | 'list'
  | 'locate'
  | 'chevronUp'

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
  // jog by 15s — the no-bar double-triangle (scan), distinct from the bar'd skip-stop
  back15: 'play-back',
  forward15: 'play-forward',
  // row states
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
  downloaded: 'cloud-done-outline', // a tour that's saved to disk + plays with no signal
  update: 'cloud-download-outline', // a saved tour whose clips were re-cut server-side — pull again
  more: 'ellipsis-horizontal', // header overflow menu (secondary/utility actions)
  roam: 'compass-outline', // free-roam mode — no route, the skipper rides shotgun
  music: 'musical-notes-outline', // the rider's own audio (roam ducks it, never stops it)
  patter: 'chatbubble-ellipses-outline', // the skipper talking (roam contract chip)
  map: 'map-outline', // the live-drive Map view (vs the itinerary List)
  list: 'list-outline', // the itinerary List view
  locate: 'locate-outline', // recenter-on-me chip when the rider pans the map away
  chevronUp: 'chevron-up', // the map peek-bar's "drag/tap up to expand the player" affordance
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
