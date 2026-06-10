// RouteTrack — the route as a dashed ATLAS TRAIL with the car token gliding along it,
// the signature motif. `progress` is 0..1. The token wears an amber halo by default
// (its motion cue); pass glow={false} while a NOW card is lit (one amber glow per screen).
import React from 'react'
import { Icon } from '../icons/Icon.jsx'

const TOKEN = 24

export function RouteTrack({ progress = 0, height = 6, glow = true, style }) {
  const pct = `${Math.max(0, Math.min(1, progress)) * 100}%`
  return (
    <div
      aria-hidden="true"
      style={{ position: 'relative', height: TOKEN, display: 'flex', alignItems: 'center', ...style }}
    >
      {/* dashed inactive trail bed */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: (TOKEN - height) / 2,
          height,
          borderTop: 'var(--border-keyline) dashed var(--track-inactive)',
        }}
      />
      {/* traveled portion */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: (TOKEN - height) / 2,
          height,
          width: pct,
          borderRadius: height / 2,
          background: 'var(--track-active)',
        }}
      />
      {/* the car token — rides a rail inset by half its width so its EDGES stay flush */}
      <div style={{ position: 'absolute', left: TOKEN / 2, right: TOKEN / 2, top: 0, bottom: 0 }}>
        <div
          style={{
            position: 'absolute',
            left: pct,
            top: '50%',
            width: TOKEN,
            height: TOKEN,
            marginLeft: -TOKEN / 2,
            marginTop: -TOKEN / 2,
            borderRadius: '50%',
            background: 'var(--amber-token)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: glow ? '0 0 6px var(--glow)' : undefined,
          }}
        >
          <Icon name="car" size={14} color="onAmber" />
        </div>
      </div>
    </div>
  )
}
