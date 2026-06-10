/* ---------------------------------------------------------------------------
   Skipper Design System - component bundle for the @dsCard specimen pages.
   AUTO-ASSEMBLED from the component source files (ES import/export stripped).
   Wrapped in an IIFE so it leaks ONLY window.Skipper - the specimen pages run in
   a shared babel scope, so leaking the bare component names would collide with
   their "const { Foo } = window.Skipper" destructuring. Loaded as text/babel.
   Edit the canonical .jsx sources, then regenerate this.
   --------------------------------------------------------------------------- */
(function () {
const { useState, useRef, useEffect, useCallback } = React;
let cssVarDefined = false;

// === icons/Icon.jsx ===
// Icon — the Trailhead 89 vector icon. The app uses Ionicons (@expo/vector-icons);
// this web recreation renders the same set via the Ionicons web component (<ion-icon>),
// so the glyphs are identical, not a substitution. Semantic names keep call sites
// intent-revealing; the Ionicons mapping lives here (one place to re-skin toward the
// future SVG enamel-badge set). Tint with a semantic color role.
//
// The consuming page must load the Ionicons web component once:
//   <script type="module" src="https://cdn.jsdelivr.net/npm/ionicons@7.4.0/dist/ionicons/ionicons.esm.js"></script>

const IONICON = {
  // stop types
  story: 'book-outline',
  scenic: 'telescope-outline',
  break: 'cafe-outline',
  // transport
  play: 'play',
  pause: 'pause',
  restart: 'reload',
  back: 'chevron-back',
  back15: 'play-back',
  forward15: 'play-forward',
  // row states
  passed: 'checkmark-circle',
  upcoming: 'caret-forward',
  // misc
  ticket: 'ticket-outline',
  car: 'car',
  day: 'sunny-outline',
  night: 'moon-outline',
  auto: 'contrast-outline',
  settings: 'settings-outline',
  expand: 'chevron-down',
  check: 'checkmark',
  region: 'location-outline',
  close: 'close',
  downloaded: 'cloud-done-outline',
  more: 'ellipsis-horizontal',
}

function Icon({ name, size = 18, color = 'ink', style }) {
  const ion = IONICON[name] || name
  return (
    <ion-icon
      name={ion}
      style={{
        fontSize: `${size}px`,
        color: `var(--${color === 'ink' ? 'ink' : cssVar(color)})`,
        display: 'inline-flex',
        verticalAlign: 'middle',
        ...style,
      }}
    />
  )
}

// Map a ThemeColors role key (camelCase) to its CSS custom-property name (kebab-case),
// with the couple of role aliases the token file uses.
function cssVar(role) {
  if (role === 'inkFaint') return 'ink-faint-role'
  return role.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

// === typography/Text.jsx ===
// Text — the one text primitive. `variant` picks a type-scale entry (rendered via the
// .type-* utility classes from tokens/typography.css); `color` is a SEMANTIC role only.
// Default body/ink. `as` lets a heading render as the right element while keeping the
// type scale (default <span>).


function Text({ variant = 'body', color = 'ink', align, as = 'span', children, style }) {
  const Tag = as
  return (
    <Tag
      className={`type-${variant}`}
      style={{
        color: `var(--${color === 'ink' ? 'ink' : cssVar(color)})`,
        textAlign: align,
        margin: 0,
        ...style,
      }}
    >
      {children}
    </Tag>
  )
}

// === surfaces/Card.jsx ===
// Card — the ranger placard. Plain by default (glanceable). `framed` adds the carved
// double-keyline + corner screw-dots — reserve that ornament for NON-driving surfaces.
// `active` swaps the hairline rule for a pine keyline (selected state).

function Card({ children, framed = false, active = false, onPress, style }) {
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

// === surfaces/Divider.jsx ===
// Divider — a rule. Hairline by default; `dashed` renders the atlas-trail dashed line
// used between sections and under the now-card hint.

function Divider({ dashed = false, style }) {
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

// === feedback/Badge.jsx ===
// Badge — the enamel travel pill for stop types, tour length, the joke meter. Outlined
// by default; `filled` for a solid enamel disc. `tone` maps to a contrast-safe color
// pairing (amber TEXT uses the burnt/lantern accent, never the bright fill amber).

// fg = outlined text/border color; solid = filled background; onSolid = text on the fill.
const TONES = {
  pine: { fg: 'accent', solid: 'accent', onSolid: 'onPrimary' },
  amber: { fg: 'accentWarm', solid: 'amberToken', onSolid: 'onAmber' },
  teal: { fg: 'water', solid: 'water', onSolid: 'onPrimary' },
  rust: { fg: 'danger', solid: 'danger', onSolid: 'onDanger' },
  neutral: { fg: 'inkDim', solid: 'rule', onSolid: 'ink' },
}

function v(role) {
  if (role === 'inkFaint') return 'ink-faint-role'
  return role.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())
}

function Badge({ label, icon, tone = 'neutral', filled = false, style }) {
  const t = TONES[tone] || TONES.neutral
  const textColor = filled ? t.onSolid : t.fg
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 'var(--space-xs)',
        padding: '3px var(--space-sm)',
        borderRadius: 'var(--radius-pill)',
        background: filled ? `var(--${v(t.solid)})` : 'transparent',
        border: filled ? 'none' : `var(--border-thin) solid var(--${v(t.fg)})`,
        color: `var(--${v(textColor)})`,
        fontFamily: 'var(--font-body)',
        fontWeight: 600,
        fontSize: '12.5px',
        letterSpacing: '0.6px',
        lineHeight: '16px',
        ...style,
      }}
    >
      {icon ? <Icon name={icon} size={12} color={textColor} /> : null}
      {label}
    </span>
  )
}

// === buttons/Button.jsx ===
// Button — the enamel CTA. `primary` is a ranger-green sign by day, a campfire-lit
// (amber, glowing) button at dusk; always ≥60pt tall for the car. `secondary` is an
// outlined placard action; `ghost` is a text link. `icon` is a leading vector glyph.

function Button({
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

// === buttons/FilterChip.jsx ===
// FilterChip — the "Where to?" region chip for THE DRIVES filter bar. Pine-OUTLINED
// when idle, pine-FILLED when a filter is active (the same contrast-safe pairing Badge's
// pine tone uses). Pine, never amber — the home's lone amber glow stays the parked rig.
// The trailing chevron reads "opens a picker".

function FilterChip({ label, active = false, onPress }) {
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

// === buttons/HeaderIconButton.jsx ===
// HeaderIconButton — our own themed circular nav-bar chip (a subtle ranger-placard disc),
// drawn ourselves so it reads the same in day and dusk with a crisp ink glyph. ~40pt.

function HeaderIconButton({ name, onPress, accessibilityLabel }) {
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

// === player/StopRow.jsx ===
// StopRow — a stop in the route list. Three glance-states:
//   upcoming — stop-type glyph + name (calm)
//   active   — a sunken "you-are-here" well + pine accent glyph + bold name (never amber)
//   passed   — dimmed + a quiet check

function StopRow({ name, sublabel, state = 'upcoming', icon, onPress }) {
  const active = state === 'active'
  const passed = state === 'passed'
  const interactive = !!onPress
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onPress}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-md)',
        minHeight: 56,
        padding: 'var(--space-sm) var(--space-md)',
        borderRadius: 'var(--radius-md)',
        background: active ? 'var(--surface-sunken)' : 'transparent',
        cursor: interactive ? 'pointer' : 'default',
      }}
    >
      {icon ? (
        <Icon name={icon} size={18} color={active ? 'accent' : passed ? 'inkFaint' : 'inkDim'} />
      ) : null}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <Text variant={active ? 'bodyStrong' : 'body'} color={passed ? 'inkDim' : 'ink'}>
          {name}
        </Text>
        {sublabel ? (
          <Text variant="dim" color="inkFaint">
            {sublabel}
          </Text>
        ) : null}
      </div>
      {passed ? <Icon name="passed" size={16} color="inkFaint" /> : null}
    </div>
  )
}

// === player/StopList.jsx ===
// StopList — the route itinerary: ONE raised card of StopRows separated by hairline rules.
// Shared by tour detail (all upcoming) and the in-drive player (per-stop state). `scroll`
// makes it a fixed shell whose rows scroll inside (the player); default sizes to content.

function StopList({ items = [], title, onPressItem, scroll = false, style }) {
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

// === player/RouteTrack.jsx ===
// RouteTrack — the route as a dashed ATLAS TRAIL with the car token gliding along it,
// the signature motif. `progress` is 0..1. The token wears an amber halo by default
// (its motion cue); pass glow={false} while a NOW card is lit (one amber glow per screen).

const TOKEN = 24

function RouteTrack({ progress = 0, height = 6, glow = true, style }) {
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

// === player/Scrubber.jsx ===
// Scrubber — the in-clip POSITION BAR. A sunken atlas well (track bed), a pine "traveled"
// fill, an amber car-token thumb, and stamped mono time labels. Click/drag to seek.

const THUMB = 18
const TRACK_H = 6

function fmt(ms) {
  const t = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function Scrubber({ positionMs = 0, durationMs = 1, onSeek, disabled = false }) {
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

// === player/TransportBar.jsx ===
// TransportBar — the player transport. Either a `single` full-width CTA (the "ready"
// Play / "done" Restart states), or the icon-forward row: ⟲15 · [big play/pause] · 15⟳.
// The center play/pause is a GLOW-LESS enamel disc — the lit card or token owns the one
// amber glow. An optional low-emphasis ghost (End drive) sits beneath.

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

function TransportBar({
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

// === player/NowCard.jsx ===
// NowCard — the PLAYER CARD. The one elevated surface holding now-playing content +
// (optionally) the scrubber + the transport as a single grounded unit. The one surface
// that earns the campfire-amber glow (`glow`), and only while a clip is actively playing.
// Layout: header (warm kicker + optional badge) → placard title (+ optional mono timer) →
// a state-dependent middle (children) → the transport row.

function NowCard({ kicker, title, timer, glow = true, right, children, transport, style }) {
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

window.Skipper = { Icon, Text, Card, Divider, Badge, Button, FilterChip, HeaderIconButton, StopRow, StopList, RouteTrack, Scrubber, TransportBar, NowCard };
})();
