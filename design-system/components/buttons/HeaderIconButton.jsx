// HeaderIconButton — our own themed circular nav-bar chip (a subtle ranger-placard disc),
// drawn ourselves so it reads the same in day and dusk with a crisp ink glyph. ~40pt.
import React from 'react'
import { Icon } from '../icons/Icon.jsx'

export function HeaderIconButton({ name, onPress, accessibilityLabel }) {
  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={accessibilityLabel}
      style={{
        width: 40,
        height: 40,
        borderRadius: 'var(--radius-pill)',
        border: 'var(--border-hair) solid var(--rule)',
        background: 'var(--surface-raised)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      <Icon name={name} size={20} color="ink" />
    </button>
  )
}
