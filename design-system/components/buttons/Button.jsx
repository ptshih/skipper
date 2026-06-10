// Button — the enamel CTA. `primary` is a ranger-green sign by day, a campfire-lit
// (amber, glowing) button at dusk; always ≥60pt tall for the car. `secondary` is an
// outlined placard action; `ghost` is a text link. `icon` is a leading vector glyph.
import React from 'react'
import { Icon } from '../icons/Icon.jsx'

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled = false,
  loading = false,
  fullWidth = true,
  glow = true,
  style,
}) {
  const isPrimary = variant === 'primary'
  const isGhost = variant === 'ghost'

  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-sm)',
    padding: 'var(--space-md) var(--space-xl)',
    border: 'none',
    cursor: disabled || loading ? 'default' : 'pointer',
    opacity: disabled || loading ? 0.45 : 1,
    fontFamily: 'var(--font-body)',
    fontWeight: 700,
    fontSize: '17px',
    lineHeight: '22px',
    boxSizing: 'border-box',
    width: fullWidth ? '100%' : 'auto',
    transition: 'opacity var(--duration-fast) var(--ease-standard)',
  }

  let variantStyle
  let labelColor
  if (isPrimary) {
    labelColor = 'var(--on-primary)'
    variantStyle = {
      background: 'var(--primary-fill)',
      color: labelColor,
      minHeight: 'var(--hit-cta)',
      borderRadius: 'var(--radius-lg)',
      // campfire glow at dusk; soft neutral cast in daylight (boxShadow renders the
      // colored glow on every platform). glow=false drops the amber halo.
      boxShadow: glow
        ? '0 0 16px var(--glow)'
        : '0 3px 8px var(--shadow-cast)',
    }
  } else if (isGhost) {
    labelColor = 'var(--accent)'
    variantStyle = {
      background: 'transparent',
      color: labelColor,
      minHeight: 'var(--hit-min)',
      borderRadius: 'var(--radius-md)',
    }
  } else {
    labelColor = 'var(--accent)'
    variantStyle = {
      background: 'var(--surface-raised)',
      color: labelColor,
      minHeight: 'var(--hit-cta)',
      borderRadius: 'var(--radius-lg)',
      border: 'var(--border-keyline) solid var(--accent)',
    }
  }

  return (
    <button
      type="button"
      onClick={disabled || loading ? undefined : onPress}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      style={{ ...base, ...variantStyle, ...style }}
    >
      {loading ? (
        '…'
      ) : (
        <>
          {icon ? <Icon name={icon} size={18} color={isPrimary ? 'onPrimary' : 'accent'} /> : null}
          {title}
        </>
      )}
    </button>
  )
}
