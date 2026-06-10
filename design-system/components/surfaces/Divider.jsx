// Divider — a rule. Hairline by default; `dashed` renders the atlas-trail dashed line
// used between sections and under the now-card hint.
import React from 'react'

export function Divider({ dashed = false, style }) {
  return (
    <div
      role="separator"
      style={
        dashed
          ? {
              borderTop: 'var(--border-keyline) dashed var(--rule)',
              height: 0,
              ...style,
            }
          : {
              height: 'var(--border-hair)',
              background: 'var(--rule)',
              ...style,
            }
      }
    />
  )
}
