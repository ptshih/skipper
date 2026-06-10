// TransportBar — the player transport. Either a `single` full-width CTA (the "ready"
// Play / "done" Restart states), or the icon-forward row: ⟲15 · [big play/pause] · 15⟳.
// The center play/pause is a GLOW-LESS enamel disc — the lit card or token owns the one
// amber glow. An optional low-emphasis ghost (End drive) sits beneath.
import React from 'react'
import { Icon } from '../icons/Icon.jsx'
import { Button } from '../buttons/Button.jsx'

const CENTER = 72
const JOG = 56

function Jog({ icon, label, onPress, disabled }) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onPress}
      aria-label={label}
      disabled={disabled}
      style={{
        width: JOG,
        height: JOG,
        borderRadius: 'var(--radius-pill)',
        border: 'var(--border-keyline) solid var(--accent)',
        background: 'var(--surface-raised)',
        color: 'var(--accent)',
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Icon name={icon} size={20} color="accent" />
      <span className="type-mono" style={{ color: 'var(--accent)', fontSize: 11, lineHeight: '12px' }}>15</span>
    </button>
  )
}

export function TransportBar({
  single,
  playing = false,
  onPlayPause,
  onSeekBack,
  onSeekForward,
  canSeek = false,
  secondary,
  style,
}) {
  if (single) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', ...style }}>
        <Button icon={single.icon} title={single.title} onPress={single.onPress} glow={single.glow} />
        {single.secondary ? (
          <Button variant="ghost" title={single.secondary.title} onPress={single.secondary.onPress} />
        ) : null}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-xl)' }}>
        <Jog icon="back15" label="Rewind 15 seconds" onPress={onSeekBack} disabled={!canSeek} />
        <button
          type="button"
          onClick={onPlayPause}
          aria-label={playing ? 'Pause' : 'Play'}
          style={{
            width: CENTER,
            height: CENTER,
            borderRadius: 'var(--radius-pill)',
            border: 'none',
            background: 'var(--primary-fill)',
            color: 'var(--on-primary)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 2px 8px var(--shadow-cast)',
            cursor: 'pointer',
          }}
        >
          <Icon name={playing ? 'pause' : 'play'} size={34} color="onPrimary" />
        </button>
        <Jog icon="forward15" label="Forward 15 seconds" onPress={onSeekForward} disabled={!canSeek} />
      </div>
      {secondary ? (
        <Button variant="ghost" title={secondary.title} onPress={secondary.onPress} />
      ) : null}
    </div>
  )
}
