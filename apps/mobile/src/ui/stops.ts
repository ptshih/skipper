// Stop-type vocabulary shared by the drive-detail and player screens, so a stop
// always reads with the same icon + tone. Icons are vector (Ionicons via Icon);
// the SVG enamel-badge set (DESIGN §9) can re-skin them later.
import type { BadgeTone } from './Badge'
import type { IconName } from './Icon'

const ICON: Record<string, IconName> = {
  story: 'story',
  scenic: 'scenic',
  break: 'break',
}

const TONE: Record<string, BadgeTone> = {
  story: 'pine',
  scenic: 'teal',
  break: 'amber',
}

export const stopIcon = (type?: string): IconName => (type ? (ICON[type] ?? 'scenic') : 'scenic')
export const stopTone = (type?: string): BadgeTone => (type ? (TONE[type] ?? 'neutral') : 'neutral')
