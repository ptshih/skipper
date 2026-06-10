// StopList — the route itinerary: ONE raised card of StopRows separated by hairline rules.
// Shared by tour detail (all upcoming) and the in-drive player (per-stop state). `scroll`
// makes it a fixed shell whose rows scroll inside (the player); default sizes to content.
import React from 'react'
import { Card } from '../surfaces/Card.jsx'
import { Divider } from '../surfaces/Divider.jsx'
import { Text } from '../typography/Text.jsx'
import { StopRow } from './StopRow.jsx'

export function StopList({ items = [], title, onPressItem, scroll = false, style }) {
  return (
    <Card
      style={{
        paddingLeft: 0,
        paddingRight: 0,
        paddingTop: 'var(--space-sm)',
        paddingBottom: 'var(--space-sm)',
        ...(scroll ? { overflow: 'hidden', display: 'flex', flexDirection: 'column' } : {}),
        ...style,
      }}
    >
      {title ? (
        <div style={{ padding: '0 var(--space-md)', marginBottom: 'var(--space-xs)' }}>
          <Text variant="label" color="inkFaint">
            {title}
          </Text>
        </div>
      ) : null}
      <div style={scroll ? { flex: 1, overflowY: 'auto' } : undefined}>
        {items.map((it, i) => (
          <React.Fragment key={it.seq ?? i}>
            {i > 0 ? <Divider style={{ margin: '0 var(--space-md)' }} /> : null}
            <StopRow
              name={it.name}
              sublabel={it.sublabel}
              icon={it.icon}
              state={it.state}
              onPress={onPressItem ? () => onPressItem(it.seq) : undefined}
            />
          </React.Fragment>
        ))}
      </div>
    </Card>
  )
}
