// ─────────────────────────────────────────────────────────────────────────
// Skipper UI kit — the Trailhead 89 primitives, as browser-global React
// components (no build step). Self-contained so the kit renders + verifies on
// its own. Mirrors src/ui/* and the authored design-system components 1:1.
// Styling routes through the CSS custom properties in ../../styles.css.
// ─────────────────────────────────────────────────────────────────────────

function cssVar(role) {
  if (role === "inkFaint") return "ink-faint-role";
  return role.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
}
const C = (role) => `var(--${role === "ink" ? "ink" : cssVar(role)})`;

const IONICON = {
  story: "book-outline", scenic: "telescope-outline", break: "cafe-outline",
  play: "play", pause: "pause", restart: "reload", back: "chevron-back",
  back15: "play-back", forward15: "play-forward", passed: "checkmark-circle",
  upcoming: "caret-forward", ticket: "ticket-outline", car: "car",
  day: "sunny-outline", night: "moon-outline", auto: "contrast-outline",
  settings: "settings-outline", expand: "chevron-down", check: "checkmark",
  region: "location-outline", close: "close", downloaded: "cloud-done-outline",
  more: "ellipsis-horizontal",
};

function Icon({ name, size = 18, color = "ink", style }) {
  return (
    <ion-icon
      name={IONICON[name] || name}
      style={{ fontSize: size + "px", color: C(color), display: "inline-flex", verticalAlign: "middle", ...style }}
    />
  );
}

function Text({ variant = "body", color = "ink", align, as = "span", children, style }) {
  const Tag = as;
  return (
    <Tag className={`type-${variant}`} style={{ color: C(color), textAlign: align, margin: 0, ...style }}>
      {children}
    </Tag>
  );
}

function Button({ title, onPress, variant = "primary", icon, disabled, loading, fullWidth = true, glow = true, style }) {
  const isPrimary = variant === "primary";
  const isGhost = variant === "ghost";
  const base = {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "var(--space-sm)",
    padding: "var(--space-md) var(--space-xl)", border: "none",
    cursor: disabled || loading ? "default" : "pointer", opacity: disabled || loading ? 0.45 : 1,
    fontFamily: "var(--font-body)", fontWeight: 700, fontSize: "17px", lineHeight: "22px",
    boxSizing: "border-box", width: fullWidth ? "100%" : "auto",
    transition: "opacity var(--duration-fast) var(--ease-standard)",
  };
  let vs, labelColor;
  if (isPrimary) {
    labelColor = "onPrimary";
    vs = { background: "var(--primary-fill)", color: C("onPrimary"), minHeight: "var(--hit-cta)",
      borderRadius: "var(--radius-lg)", boxShadow: glow ? "0 0 16px var(--glow)" : "0 3px 8px var(--shadow-cast)" };
  } else if (isGhost) {
    labelColor = "accent";
    vs = { background: "transparent", color: C("accent"), minHeight: "var(--hit-min)", borderRadius: "var(--radius-md)" };
  } else {
    labelColor = "accent";
    vs = { background: "var(--surface-raised)", color: C("accent"), minHeight: "var(--hit-cta)",
      borderRadius: "var(--radius-lg)", border: "var(--border-keyline) solid var(--accent)" };
  }
  return (
    <button type="button" onClick={disabled || loading ? undefined : onPress} disabled={disabled || loading} style={{ ...base, ...vs, ...style }}>
      {loading ? <Spinner size={16} color={labelColor} /> : icon ? <Icon name={icon} size={18} color={labelColor} /> : null}
      {title}
    </button>
  );
}

// A small spinning ring — the browser stand-in for RN's ActivityIndicator.
function Spinner({ size = 22, color = "accent" }) {
  return (
    <span aria-hidden="true" style={{
      display: "inline-block", width: size, height: size, borderRadius: "50%",
      border: `${Math.max(2, Math.round(size / 9))}px solid ${C(color)}`,
      borderTopColor: "transparent", animation: "skipper-spin 0.7s linear infinite",
    }} />
  );
}

// Themed text field — ≥48pt, pine focus ring. Mirrors src/ui/Input.tsx.
function Input({ value, onChange, placeholder, type = "text", autoComplete, onSubmit, inputRef, style }) {
  const [focused, setFocused] = React.useState(false);
  return (
    <input
      ref={inputRef}
      type={type}
      value={value}
      placeholder={placeholder}
      autoComplete={autoComplete}
      onChange={(e) => onChange && onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => { if (e.key === "Enter" && onSubmit) onSubmit(); }}
      className="type-body"
      style={{
        width: "100%", boxSizing: "border-box", minHeight: "var(--hit-min)",
        padding: "var(--space-md) var(--space-lg)", borderRadius: "var(--radius-md)",
        border: `var(--border-keyline) solid ${focused ? "var(--accent)" : "var(--rule)"}`,
        background: "var(--surface-raised)", color: "var(--ink)", outline: "none",
        // override the .type-body 23px line-height — a single-line field clips descenders; let it center naturally
        lineHeight: "normal",
        transition: "border-color var(--duration-fast) var(--ease-standard)", ...style,
      }}
    />
  );
}

// Auto / Day / Dusk segmented control. Mirrors src/ui/ThemeModePicker.tsx.
const THEME_MODES = [
  { mode: "system", label: "Auto", icon: "auto" },
  { mode: "light", label: "Day", icon: "day" },
  { mode: "dark", label: "Dusk", icon: "night" },
];
function ThemeModePicker({ mode, onChange }) {
  return (
    <div role="radiogroup" style={{
      display: "flex", gap: "var(--space-xs)", padding: "var(--space-xs)",
      borderRadius: "var(--radius-md)", background: "var(--surface-sunken)",
      border: "var(--border-hair) solid var(--rule)",
    }}>
      {THEME_MODES.map((opt) => {
        const selected = mode === opt.mode;
        return (
          <button key={opt.mode} type="button" role="radio" aria-checked={selected}
            aria-label={`${opt.label} appearance`} onClick={() => onChange(opt.mode)}
            style={{
              flex: 1, minHeight: "var(--hit-min)", display: "inline-flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: "var(--space-xs)",
              padding: "var(--space-sm) 0", borderRadius: "var(--radius-sm)", border: "none",
              background: selected ? "var(--surface-raised)" : "transparent",
              boxShadow: selected ? "0 1px 3px var(--shadow-cast)" : "none", cursor: "pointer",
            }}>
            <Icon name={opt.icon} size={18} color={selected ? "accent" : "inkDim"} />
            <Text variant="label" color={selected ? "ink" : "inkDim"}>{opt.label}</Text>
          </button>
        );
      })}
    </div>
  );
}

// The shared centered loading / error / empty state. Mirrors src/ui/StateView.tsx.
function StateView({ message, loading, tone = "dim", action, style }) {
  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: "var(--space-xl)", padding: "var(--space-huge) var(--gutter)", textAlign: "center", ...style,
    }}>
      {loading ? <Spinner size={28} color="accent" /> : null}
      <Text variant={loading ? "dim" : "body"} color={tone === "danger" ? "danger" : loading ? "inkFaint" : "inkDim"}
        align="center" style={{ maxWidth: "34ch", textWrap: "pretty" }}>
        {message}
      </Text>
      {action ? <Button variant="secondary" title={action.label} fullWidth={false} onPress={action.onPress} /> : null}
    </div>
  );
}

const TONES = {
  pine: { fg: "accent", solid: "accent", onSolid: "onPrimary" },
  amber: { fg: "accentWarm", solid: "amberToken", onSolid: "onAmber" },
  teal: { fg: "water", solid: "water", onSolid: "onPrimary" },
  rust: { fg: "danger", solid: "danger", onSolid: "onDanger" },
  neutral: { fg: "inkDim", solid: "rule", onSolid: "ink" },
};
function Badge({ label, icon, tone = "neutral", filled, style }) {
  const t = TONES[tone] || TONES.neutral;
  const textColor = filled ? t.onSolid : t.fg;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", padding: "3px var(--space-sm)",
      borderRadius: "var(--radius-pill)", background: filled ? C(t.solid) : "transparent",
      border: filled ? "none" : `var(--border-thin) solid ${C(t.fg)}`, color: C(textColor),
      fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", letterSpacing: "0.6px", lineHeight: "16px", ...style,
    }}>
      {icon ? <Icon name={icon} size={12} color={textColor} /> : null}
      {label}
    </span>
  );
}

function Card({ children, framed, active, onPress, style }) {
  const interactive = !!onPress;
  return (
    <div role={interactive ? "button" : undefined} onClick={onPress}
      style={{
        position: "relative", background: "var(--surface-raised)", borderRadius: "var(--radius-lg)",
        border: active ? "var(--border-keyline) solid var(--accent)" : "var(--border-hair) solid var(--rule)",
        padding: "var(--space-lg)", cursor: interactive ? "pointer" : "default", ...style,
      }}>
      {framed ? (
        <>
          <div aria-hidden="true" style={{ position: "absolute", inset: 5, border: "var(--border-hair) solid var(--keyline)", borderRadius: "calc(var(--radius-lg) - 4px)", pointerEvents: "none" }} />
          <span aria-hidden="true" style={{ position: "absolute", top: 9, left: 9, width: 4, height: 4, borderRadius: 2, background: "var(--rule)", opacity: 0.7 }} />
          <span aria-hidden="true" style={{ position: "absolute", bottom: 9, right: 9, width: 4, height: 4, borderRadius: 2, background: "var(--rule)", opacity: 0.7 }} />
        </>
      ) : null}
      {children}
    </div>
  );
}

function Divider({ dashed, style }) {
  return <div role="separator" style={dashed
    ? { borderTop: "var(--border-keyline) dashed var(--rule)", height: 0, ...style }
    : { height: "var(--border-hair)", background: "var(--rule)", ...style }} />;
}

function FilterChip({ label, active, onPress }) {
  const content = active ? "onPrimary" : "accent";
  return (
    <button type="button" onClick={onPress} aria-pressed={active}
      style={{
        display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", padding: "var(--space-sm) var(--space-md)",
        borderRadius: "var(--radius-pill)", border: "var(--border-keyline) solid var(--accent)",
        background: active ? "var(--accent)" : "transparent", color: C(content),
        fontFamily: "var(--font-body)", fontWeight: 600, fontSize: "12.5px", letterSpacing: "0.6px", textTransform: "uppercase", cursor: "pointer",
      }}>
      {label}
      <Icon name="expand" size={14} color={content} />
    </button>
  );
}

function HeaderIconButton({ name, onPress, accessibilityLabel }) {
  return (
    <button type="button" onClick={onPress} aria-label={accessibilityLabel}
      style={{ width: 40, height: 40, borderRadius: "var(--radius-pill)", border: "var(--border-hair) solid var(--rule)",
        background: "var(--surface-raised)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
      <Icon name={name} size={20} color="ink" />
    </button>
  );
}

const TOKEN = 24;
function RouteTrack({ progress = 0, height = 6, glow = true, style }) {
  const pct = `${Math.max(0, Math.min(1, progress)) * 100}%`;
  return (
    <div aria-hidden="true" style={{ position: "relative", height: TOKEN, display: "flex", alignItems: "center", ...style }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: (TOKEN - height) / 2, height, borderTop: "var(--border-keyline) dashed var(--track-inactive)" }} />
      <div style={{ position: "absolute", left: 0, top: (TOKEN - height) / 2, height, width: pct, borderRadius: height / 2, background: "var(--track-active)" }} />
      <div style={{ position: "absolute", left: TOKEN / 2, right: TOKEN / 2, top: 0, bottom: 0 }}>
        <div style={{ position: "absolute", left: pct, top: "50%", width: TOKEN, height: TOKEN, marginLeft: -TOKEN / 2, marginTop: -TOKEN / 2,
          borderRadius: "50%", background: "var(--amber-token)", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: glow ? "0 0 6px var(--glow)" : undefined }}>
          <Icon name="car" size={14} color="onAmber" />
        </div>
      </div>
    </div>
  );
}

function StopRow({ name, sublabel, state = "upcoming", icon, onPress }) {
  const active = state === "active", passed = state === "passed", interactive = !!onPress;
  return (
    <div role={interactive ? "button" : undefined} onClick={onPress}
      style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", minHeight: 56,
        padding: "var(--space-sm) var(--space-md)", borderRadius: "var(--radius-md)",
        background: active ? "var(--surface-sunken)" : "transparent", cursor: interactive ? "pointer" : "default" }}>
      {icon ? <Icon name={icon} size={18} color={active ? "accent" : passed ? "inkFaint" : "inkDim"} /> : null}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <Text variant={active ? "bodyStrong" : "body"} color={passed ? "inkDim" : "ink"}>{name}</Text>
        {sublabel ? <Text variant="dim" color="inkFaint">{sublabel}</Text> : null}
      </div>
      {passed ? <Icon name="passed" size={16} color="inkFaint" /> : null}
    </div>
  );
}

function StopList({ items = [], title, onPressItem, scroll, style }) {
  return (
    <Card style={{ paddingLeft: 0, paddingRight: 0, paddingTop: "var(--space-sm)", paddingBottom: "var(--space-sm)",
      ...(scroll ? { overflow: "hidden", display: "flex", flexDirection: "column" } : {}), ...style }}>
      {title ? <div style={{ padding: "0 var(--space-md)", marginBottom: "var(--space-xs)" }}><Text variant="label" color="inkFaint">{title}</Text></div> : null}
      <div style={scroll ? { flex: 1, overflowY: "auto" } : undefined}>
        {items.map((it, i) => (
          <React.Fragment key={it.seq ?? i}>
            {i > 0 ? <Divider style={{ margin: "0 var(--space-md)" }} /> : null}
            <StopRow name={it.name} sublabel={it.sublabel} icon={it.icon} state={it.state} onPress={onPressItem ? () => onPressItem(it.seq) : undefined} />
          </React.Fragment>
        ))}
      </div>
    </Card>
  );
}

const THUMB = 18, TRACK_H = 6;
function fmtTime(ms) { const t = Math.max(0, Math.round(ms / 1000)); const m = Math.floor(t / 60); const s = t % 60; return `${m}:${String(s).padStart(2, "0")}`; }
function Scrubber({ positionMs = 0, durationMs = 1, onSeek, disabled }) {
  const frac = durationMs > 0 ? Math.max(0, Math.min(1, positionMs / durationMs)) : 0;
  const ref = React.useRef(null);
  const seek = (ev) => { if (disabled || !onSeek || !ref.current) return; const r = ref.current.getBoundingClientRect(); onSeek(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * durationMs); };
  return (
    <div style={{ opacity: disabled ? 0.45 : 1 }}>
      <div ref={ref} role="slider" onClick={seek}
        style={{ position: "relative", height: "var(--hit-min)", display: "flex", alignItems: "center", cursor: disabled ? "default" : "pointer" }}>
        <div style={{ position: "absolute", left: 0, right: 0, height: TRACK_H, borderRadius: TRACK_H / 2, background: "var(--surface-sunken)" }} />
        <div style={{ position: "absolute", left: 0, width: `${frac * 100}%`, height: TRACK_H, borderRadius: TRACK_H / 2, background: "var(--track-active)" }} />
        <div style={{ position: "absolute", left: `calc(${frac} * (100% - ${THUMB}px))`, width: THUMB, height: THUMB, borderRadius: "50%", background: "var(--amber-token)", border: "var(--border-thin) solid var(--on-amber)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "var(--space-xs)" }}>
        <span className="type-mono" style={{ color: "var(--ink-dim)" }}>{fmtTime(positionMs)}</span>
        <span className="type-mono" style={{ color: "var(--ink-dim)" }}>{fmtTime(durationMs)}</span>
      </div>
    </div>
  );
}

const CENTER = 72, JOG = 56;
function Jog({ icon, label, onPress, disabled }) {
  return (
    <button type="button" onClick={disabled ? undefined : onPress} aria-label={label} disabled={disabled}
      style={{ width: JOG, height: JOG, borderRadius: "var(--radius-pill)", border: "var(--border-keyline) solid var(--accent)",
        background: "var(--surface-raised)", color: "var(--accent)", display: "inline-flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1 }}>
      <Icon name={icon} size={20} color="accent" />
      <span className="type-mono" style={{ color: "var(--accent)", fontSize: 11, lineHeight: "12px" }}>15</span>
    </button>
  );
}
function TransportBar({ single, playing, onPlayPause, onSeekBack, onSeekForward, canSeek, secondary, style }) {
  if (single) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", ...style }}>
        <Button icon={single.icon} title={single.title} onPress={single.onPress} glow={single.glow} />
        {single.secondary ? <Button variant="ghost" title={single.secondary.title} onPress={single.secondary.onPress} /> : null}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-xl)" }}>
        <Jog icon="back15" label="Rewind 15 seconds" onPress={onSeekBack} disabled={!canSeek} />
        <button type="button" onClick={onPlayPause} aria-label={playing ? "Pause" : "Play"}
          style={{ width: CENTER, height: CENTER, borderRadius: "var(--radius-pill)", border: "none", background: "var(--primary-fill)",
            color: "var(--on-primary)", display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px var(--shadow-cast)", cursor: "pointer" }}>
          <Icon name={playing ? "pause" : "play"} size={34} color="onPrimary" />
        </button>
        <Jog icon="forward15" label="Forward 15 seconds" onPress={onSeekForward} disabled={!canSeek} />
      </div>
      {secondary ? <Button variant="ghost" title={secondary.title} onPress={secondary.onPress} /> : null}
    </div>
  );
}

function NowCard({ kicker, title, timer, glow = true, right, children, transport, style }) {
  return (
    <div style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-lg)",
      border: `var(--border-keyline) solid ${glow ? "var(--amber-token)" : "var(--rule)"}`,
      padding: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-md)",
      boxShadow: glow ? "0 0 16px var(--glow)" : undefined, ...style }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
        <Text variant="label" color="accentWarm" style={{ flex: 1 }}>{kicker}</Text>
        {right}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: "var(--space-sm)" }}>
        <Text variant="placardTitle" color="ink" style={{ flex: 1 }}>{title}</Text>
        {timer ? <Text variant="mono" color="inkDim">{timer}</Text> : null}
      </div>
      {children}
      {transport ? <div style={{ marginTop: "var(--space-xs)" }}>{transport}</div> : null}
    </div>
  );
}

Object.assign(window, {
  Icon, Text, Button, Spinner, Badge, Card, Divider, FilterChip, HeaderIconButton,
  RouteTrack, StopRow, StopList, Scrubber, TransportBar, NowCard,
  Input, ThemeModePicker, StateView,
});
