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
  | 'downloaded'
  | 'notDownloaded'
  | 'update'
  | 'more'
  | 'music'
  | 'patter'
  | 'map'
  | 'list'
  | 'locate'
  | 'fit'
  | 'chevronUp'
  | 'eye'
  | 'eyeOff'
  | 'info'
  | 'send'
  | 'close'

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
  expand: 'chevron-down', // a filter chip that opens a picker
  downloaded: 'cloud-done-outline', // a drive that's saved to disk + plays with no signal
  // Still in the cloud = will STREAM. The counterpart to `downloaded`, and deliberately a plain cloud
  // (not `cloud-offline`, which reads as "you are offline" rather than "this isn't on your phone").
  notDownloaded: 'cloud-outline',
  update: 'cloud-download-outline', // a saved drive whose clips were re-cut server-side — pull again
  more: 'ellipsis-horizontal', // header overflow menu (secondary/utility actions)
  music: 'musical-notes-outline', // the rider's own audio (PAUSED while the skipper talks, then handed back — not ducking)
  patter: 'chatbubble-ellipses-outline', // the skipper talking
  map: 'map-outline', // the live-drive Map view (vs the itinerary List)
  list: 'list-outline', // the itinerary List view
  locate: 'locate-outline', // recenter-on-me chip when the rider pans the map away
  fit: 'scan-outline', // "fit route" chip — frame the whole drive (all POIs) on the detail map
  chevronUp: 'chevron-up', // the map peek-bar's "drag/tap up to expand the player" affordance
  eye: 'eye-outline', // show diagnostics overlay
  eyeOff: 'eye-off-outline', // hide diagnostics overlay
  info: 'information-circle-outline', // the ⓘ that reveals a clip's source credit (AttributionButton)
  // Send the rider's line to the skipper (the planner composer). An ARROW, not a paper plane: the
  // plane is a mail idiom, and this is talking, not posting.
  send: 'arrow-up',
  // Dismiss a transient surface (the pinned preview-clip bar). Distinct from `back`, which NAVIGATES.
  close: 'close',
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
