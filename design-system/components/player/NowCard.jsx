// NowCard — the PLAYER CARD. The one elevated surface holding now-playing content +
// (optionally) the scrubber + the transport as a single grounded unit. The one surface
// that earns the campfire-amber glow (`glow`), and only while a clip is actively playing.
// Layout: header (warm kicker + optional badge) → placard title (+ optional mono timer) →
// a state-dependent middle (children) → the transport row.
import React from 'react'
import { Text } from '../typography/Text.jsx'

export function NowCard({ kicker, title, timer, glow = true, right, children, transport, style }) {
  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        borderRadius: 'var(--radius-lg)',
        border: `var(--border-keyline) solid ${glow ? 'var(--amber-token)' : 'var(--rule)'}`,
        padding: 'var(--space-lg)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-md)',
        boxShadow: glow ? '0 0 16px var(--glow)' : undefined,
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
        <Text variant="label" color="accentWarm" style={{ flex: 1 }}>
          {kicker}
        </Text>
        {right}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-sm)' }}>
        <Text variant="placardTitle" color="ink" style={{ flex: 1 }}>
          {title}
        </Text>
        {timer ? (
          <Text variant="mono" color="inkDim">
            {timer}
          </Text>
        ) : null}
      </div>
      {children}
      {transport ? <div style={{ marginTop: 'var(--space-xs)' }}>{transport}</div> : null}
    </div>
  )
}
