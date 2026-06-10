// StopRow — a stop in the route list. Three glance-states:
//   upcoming — stop-type glyph + name (calm)
//   active   — a sunken "you-are-here" well + pine accent glyph + bold name (never amber)
//   passed   — dimmed + a quiet check
import React from 'react'
import { Icon } from '../icons/Icon.jsx'
import { Text } from '../typography/Text.jsx'

export function StopRow({ name, sublabel, state = 'upcoming', icon, onPress }) {
  const active = state === 'active'
  const passed = state === 'passed'
  const interactive = !!onPress
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onPress}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-md)',
        minHeight: 56,
        padding: 'var(--space-sm) var(--space-md)',
        borderRadius: 'var(--radius-md)',
        background: active ? 'var(--surface-sunken)' : 'transparent',
        cursor: interactive ? 'pointer' : 'default',
      }}
    >
      {icon ? (
        <Icon name={icon} size={18} color={active ? 'accent' : passed ? 'inkFaint' : 'inkDim'} />
      ) : null}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <Text variant={active ? 'bodyStrong' : 'body'} color={passed ? 'inkDim' : 'ink'}>
          {name}
        </Text>
        {sublabel ? (
          <Text variant="dim" color="inkFaint">
            {sublabel}
          </Text>
        ) : null}
      </div>
      {passed ? <Icon name="passed" size={16} color="inkFaint" /> : null}
    </div>
  )
}
