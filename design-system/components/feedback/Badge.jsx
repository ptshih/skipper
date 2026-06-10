// Badge — the enamel travel pill for stop types, tour length, the joke meter. Outlined
// by default; `filled` for a solid enamel disc. `tone` maps to a contrast-safe color
// pairing (amber TEXT uses the burnt/lantern accent, never the bright fill amber).
import React from 'react'
import { Icon } from '../icons/Icon.jsx'

// fg = outlined text/border color; solid = filled background; onSolid = text on the fill.
const TONES = {
  pine: { fg: 'accent', solid: 'accent', onSolid: 'onPrimary' },
  amber: { fg: 'accentWarm', solid: 'amberToken', onSolid: 'onAmber' },
  teal: { fg: 'water', solid: 'water', onSolid: 'onPrimary' },
  rust: { fg: 'danger', solid: 'danger', onSolid: 'onDanger' },
  neutral: { fg: 'inkDim', solid: 'rule', onSolid: 'ink' },
}

function v(role) {
  if (role === 'inkFaint') return 'ink-faint-role'
  return role.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

export function Badge({ label, icon, tone = 'neutral', filled = false, style }) {
  const t = TONES[tone] || TONES.neutral
  const textColor = filled ? t.onSolid : t.fg
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-xs)',
        padding: '3px var(--space-sm)',
        borderRadius: 'var(--radius-pill)',
        background: filled ? `var(--${v(t.solid)})` : 'transparent',
        border: filled ? 'none' : `var(--border-thin) solid var(--${v(t.fg)})`,
        color: `var(--${v(textColor)})`,
        fontFamily: 'var(--font-body)',
        fontWeight: 600,
        fontSize: '12.5px',
        letterSpacing: '0.6px',
        lineHeight: '16px',
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={12} color={textColor} /> : null}
      {label}
    </span>
  )
}
