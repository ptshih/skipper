export { Text, type TextProps } from './Text'
export { Glyph, type GlyphProps } from './Glyph'
export { Icon, type IconName, type IconProps } from './Icon'
export { HeaderIconButton, type HeaderIconButtonProps } from './HeaderIconButton'
export { Screen, type ScreenProps } from './Screen'
// The conversation's own shell. NOT a flag on Screen: it owns a pinned keyboard-aware footer and an
// auto-scroll state machine that the app's other twelve Screen call sites want nothing to do with.
export {
  ConversationScreen,
  type ConversationScreenProps,
  CONVERSATION_STICK_PX,
} from './ConversationScreen'
export { EdgeFade, type EdgeFadeProps } from './EdgeFade'
export { Button, type ButtonProps } from './Button'
export { Input } from './Input'
export { Card, type CardProps } from './Card'
export { Badge, type BadgeProps, type BadgeTone } from './Badge'
export { FilterChip, type FilterChipProps } from './FilterChip'
export { RegionChip, type RegionChipProps } from './RegionChip'
export { Ridgeline, type RidgelineProps } from './Ridgeline'
export { RegionPicker, type RegionPickerProps, type PickableRegion } from './RegionPicker'
export {
  SuggestionRow,
  ListenRow,
  type SuggestionRowProps,
  type ListenRowProps,
} from './SuggestionRow'
export { Segmented, type SegmentedProps, type SegmentedOption } from './Segmented'
export { Divider } from './Divider'
export { AttributionButton, type AttributionButtonProps } from './AttributionButton'
export { Sunburst, type SunburstProps } from './Sunburst'
export { RouteTrack } from './RouteTrack'
export { Scrubber, type ScrubberProps } from './Scrubber'
export { StopRow, STOP_ROW_HEIGHT, type StopState } from './StopRow'
export { StopList, type StopListItem, type StopListProps } from './StopList'
export { NowCard } from './NowCard'
export { TransportBar, type TransportBarProps } from './TransportBar'
export { StateView, type StateViewProps } from './StateView'
// The planner conversation (1.1 step 7). Presentation only — none of these fetches, spends, or holds
// the transcript; the screen does. See app/index.tsx.
export { TurnBubble, type TurnBubbleProps } from './TurnBubble'
export { TypingDots, type TypingDotsProps } from './TypingDots'
export { Composer, type ComposerProps } from './Composer'
export { ExampleAsks, type ExampleAsksProps } from './ExampleAsks'
export { PreviewCard, type PreviewCardProps, type PreviewCardState } from './PreviewCard'
export { PlannerUnavailableCard, type PlannerUnavailableCardProps } from './PlannerUnavailableCard'
// The pinned preview-clip transport (1.1 step 8). It rides the conversation's footer slot so a clip
// that scrolls away cannot strand the rider — roam already paid for that lesson.
export { ClipBar, type ClipBarProps } from './ClipBar'
export { Skeleton, SkeletonGroup, type SkeletonProps, type SkeletonGroupProps } from './Skeleton'
export { AccountGate } from './AccountGate'
export { LocationGate } from './LocationGate'
export { LocationPrime } from './LocationPrime'
export { VersionGate } from './VersionGate'
export { ThemeModePicker } from './ThemeModePicker'
export { SimModePicker, type SimModePickerProps } from './SimModePicker'
export { voice } from './voice'
export { stopIcon, stopTone } from './stops'
