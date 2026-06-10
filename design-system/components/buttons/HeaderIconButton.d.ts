import type { IconName } from '../icons/Icon'

export interface HeaderIconButtonProps {
  /** Semantic icon name. */
  name: IconName
  onPress?: () => void
  /** Required — the chip is icon-only. */
  accessibilityLabel: string
}

/**
 * A circular header nav chip — our own themed ranger-placard disc (we draw it so it
 * reads identically in day and dusk, instead of iOS's bright Liquid Glass capsule).
 */
export function HeaderIconButton(props: HeaderIconButtonProps): JSX.Element
