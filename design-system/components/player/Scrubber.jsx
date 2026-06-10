// Scrubber — the in-clip POSITION BAR. A sunken atlas well (track bed), a pine "traveled"
// fill, an amber car-token thumb, and stamped mono time labels. Click/drag to seek.
import React from 'react'

const THUMB = 18
const TRACK_H = 6

function fmt(ms) {
  const t = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function Scrubber({ positionMs = 0, durationMs = 1, onSeek, disabled = false }) {
  const frac = durationMs > 0 ? Math.max(0, Math.min(1, positionMs / durationMs)) : 0
  const barRef = React.useRef(null)

  const seekFromEvent = (e) => {
    if (disabled || !onSeek || !barRef.current) return
    const rect = barRef.current.getBoundingClientRect()
    const f = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    onSeek(f * durationMs)
  }

  return (
    <div style={{ opacity: disabled ? 0.45 : 1 }}>
      <div
        ref={barRef}
        role="slider"
        aria-label="Playback position"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(positionMs / 1000)}
        onClick={seekFromEvent}
        style={{
          position: 'relative',
          height: 'var(--hit-min)',
          display: 'flex',
          alignItems: 'center',
          cursor: disabled ? 'default' : 'pointer',
        }}
      >
        {/* sunken bed */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: TRACK_H,
            borderRadius: TRACK_H / 2,
            background: 'var(--surface-sunken)',
          }}
        />
        {/* traveled fill */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            width: `${frac * 100}%`,
            height: TRACK_H,
            borderRadius: TRACK_H / 2,
            background: 'var(--track-active)',
          }}
        />
        {/* amber token thumb — left edge travels [0, 100%] inset by the thumb width */}
        <div
          style={{
            position: 'absolute',
            left: `calc(${frac} * (100% - ${THUMB}px))`,
            width: THUMB,
            height: THUMB,
            borderRadius: '50%',
            background: 'var(--amber-token)',
            border: 'var(--border-thin) solid var(--on-amber)',
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-xs)' }}>
        <span className="type-mono" style={{ color: 'var(--ink-dim)' }}>{fmt(positionMs)}</span>
        <span className="type-mono" style={{ color: 'var(--ink-dim)' }}>{fmt(durationMs)}</span>
      </div>
    </div>
  )
}
