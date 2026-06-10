// Text — the one text primitive. `variant` picks a type-scale entry (rendered via the
// .type-* utility classes from tokens/typography.css); `color` is a SEMANTIC role only.
// Default body/ink. `as` lets a heading render as the right element while keeping the
// type scale (default <span>).
import React from 'react'

// Map a ThemeColors role key (camelCase) to its CSS custom-property name.
function cssVar(role) {
  if (role === 'inkFaint') return 'ink-faint-role'
  return role.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

export function Text({ variant = 'body', color = 'ink', align, as = 'span', children, style }) {
  const Tag = as
  return (
    <Tag
      className={`type-${variant}`}
      style={{
        color: `var(--${color === 'ink' ? 'ink' : cssVar(color)})`,
        textAlign: align,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </Tag>
  )
}
