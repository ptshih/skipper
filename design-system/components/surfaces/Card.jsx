// Card — the ranger placard. Plain by default (glanceable). `framed` adds the carved
// double-keyline + corner screw-dots — reserve that ornament for NON-driving surfaces.
// `active` swaps the hairline rule for a pine keyline (selected state).
import React from 'react'

export function Card({ children, framed = false, active = false, onPress, style }) {
  const interactive = !!onPress
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onPress}
      style={{
        position: 'relative',
        background: 'var(--surface-raised)',
        borderRadius: 'var(--radius-lg)',
        border: active
          ? 'var(--border-keyline) solid var(--accent)'
          : 'var(--border-hair) solid var(--rule)',
        padding: 'var(--space-lg)',
        cursor: interactive ? 'pointer' : 'default',
        ...style,
      }}
    >
      {framed ? (
        <>
          {/* carved inner keyline */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 5,
              border: 'var(--border-hair) solid var(--keyline)',
              borderRadius: 'calc(var(--radius-lg) - 4px)',
              pointerEvents: 'none',
            }}
          />
          {/* corner screw-dots */}
          <span aria-hidden="true" style={screw('9px', '9px', null, null)} />
          <span aria-hidden="true" style={screw(null, null, '9px', '9px')} />
        </>
      ) : null}
      {children}
    </div>
  )
}

function screw(top, left, bottom, right) {
  return {
    position: 'absolute',
    width: 4,
    height: 4,
    borderRadius: 2,
    background: 'var(--rule)',
    opacity: 0.7,
    top: top ?? undefined,
    left: left ?? undefined,
    bottom: bottom ?? undefined,
    right: right ?? undefined,
    pointerEvents: 'none',
  }
}
