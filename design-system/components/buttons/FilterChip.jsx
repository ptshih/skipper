// FilterChip — the "Where to?" region chip for THE DRIVES filter bar. Pine-OUTLINED
// when idle, pine-FILLED when a filter is active (the same contrast-safe pairing Badge's
// pine tone uses). Pine, never amber — the home's lone amber glow stays the parked rig.
// The trailing chevron reads "opens a picker".
import React from 'react'
import { Icon } from '../icons/Icon.jsx'

export function FilterChip({ label, active = false, onPress }) {
  const content = active ? 'onPrimary' : 'accent'
  return (
    <button
      type="button"
      onClick={onPress}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-xs)',
        padding: 'var(--space-sm) var(--space-md)',
        borderRadius: 'var(--radius-pill)',
        border: 'var(--border-keyline) solid var(--accent)',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? 'var(--on-primary)' : 'var(--accent)',
        fontFamily: 'var(--font-body)',
        fontWeight: 600,
        fontSize: '12.5px',
        letterSpacing: '0.6px',
        textTransform: 'uppercase',
        cursor: 'pointer',
      }}
    >
      {label}
      <Icon name="expand" size={14} color={content} />
    </button>
  )
}
