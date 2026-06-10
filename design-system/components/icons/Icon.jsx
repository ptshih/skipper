// Icon — the Trailhead 89 vector icon. The app uses Ionicons (@expo/vector-icons);
// this web recreation renders the same set via the Ionicons web component (<ion-icon>),
// so the glyphs are identical, not a substitution. Semantic names keep call sites
// intent-revealing; the Ionicons mapping lives here (one place to re-skin toward the
// future SVG enamel-badge set). Tint with a semantic color role.
//
// The consuming page must load the Ionicons web component once:
//   <script type="module" src="https://cdn.jsdelivr.net/npm/ionicons@7.4.0/dist/ionicons/ionicons.esm.js"></script>
import React from 'react'

const IONICON = {
  // stop types
  story: 'book-outline',
  scenic: 'telescope-outline',
  break: 'cafe-outline',
  // transport
  play: 'play',
  pause: 'pause',
  restart: 'reload',
  back: 'chevron-back',
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
  auto: 'contrast-outline',
  settings: 'settings-outline',
  expand: 'chevron-down',
  check: 'checkmark',
  region: 'location-outline',
  close: 'close',
  downloaded: 'cloud-done-outline',
  more: 'ellipsis-horizontal',
}

export function Icon({ name, size = 18, color = 'ink', style }) {
  const ion = IONICON[name] || name
  return (
    <ion-icon
      name={ion}
      style={{
        fontSize: `${size}px`,
        color: `var(--${color === 'ink' ? 'ink' : cssVar(color)})`,
        display: 'inline-flex',
        verticalAlign: 'middle',
        ...style,
      }}
    />
  )
}

// Map a ThemeColors role key (camelCase) to its CSS custom-property name (kebab-case),
// with the couple of role aliases the token file uses.
function cssVar(role) {
  if (role === 'inkFaint') return 'ink-faint-role'
  return role.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}
