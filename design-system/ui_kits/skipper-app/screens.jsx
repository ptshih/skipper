// ─────────────────────────────────────────────────────────────────────────
// Skipper UI kit — screens. A clickable flow: THE DRIVES (home) → tour detail →
// the live player. Composes the primitives from components.jsx. Sample data is
// the West Shore of Lake Tahoe (CA-89), consistent with the app's domain.
// ─────────────────────────────────────────────────────────────────────────

const TOURS = [
  {
    id: "west-shore",
    region: "Lake Tahoe",
    headline: "The West Shore Run",
    start: "Tahoe City",
    end: "Emerald Bay",
    minutes: 42,
    teaser: "Tahoe City & Emerald Bay",
    summary:
      "Hug the quiet west shore from the Truckee River outlet down to the most photographed cove in the Sierra — granite, old-growth pine, and a lake that won't quit.",
    stops: [
      { seq: 1, name: "Tahoe City Trailhead", type: "story" },
      { seq: 2, name: "Sunnyside Overlook", type: "scenic" },
      { seq: 3, name: "Blackwood Canyon", type: "scenic" },
      { seq: 4, name: "Homewood", type: "break" },
      { seq: 5, name: "Meeks Bay", type: "scenic" },
      { seq: 6, name: "Rubicon Point", type: "story" },
      { seq: 7, name: "Eagle Falls", type: "scenic" },
      { seq: 8, name: "Emerald Bay Overlook", type: "story" },
    ],
  },
  {
    id: "donner",
    region: "Donner Summit",
    headline: "Donner Summit & the Old Highway",
    start: "Truckee",
    end: "Soda Springs",
    minutes: 35,
    teaser: "Truckee & Soda Springs",
    summary: "",
    stops: [
      { seq: 1, name: "Truckee Depot", type: "story" },
      { seq: 2, name: "Donner Memorial", type: "story" },
      { seq: 3, name: "Rainbow Bridge", type: "scenic" },
      { seq: 4, name: "Summit Diner", type: "break" },
      { seq: 5, name: "Old US-40 Overlook", type: "scenic" },
    ],
  },
  {
    id: "east-shore",
    region: "Lake Tahoe",
    headline: "The East Shore Cruise",
    start: "Incline Village",
    end: "Spooner",
    minutes: 28,
    teaser: "Incline Village & Spooner Lake",
    summary: "",
    stops: [
      { seq: 1, name: "Incline Village", type: "story" },
      { seq: 2, name: "Sand Harbor", type: "scenic" },
      { seq: 3, name: "Chimney Beach", type: "scenic" },
      { seq: 4, name: "Spooner Lake", type: "break" },
    ],
  },
];

const STOP_TONE = { story: "pine", scenic: "teal", break: "amber" };
const STOP_ICON = { story: "story", scenic: "scenic", break: "break" };
const STOP_LABEL = { story: "Story", scenic: "Scenic", break: "Pit stop" };

// Regions, derived from the catalog (mirrors useDrivesFilter's published set).
const REGIONS = (() => {
  const m = new Map();
  TOURS.forEach((t) => m.set(t.region, (m.get(t.region) || 0) + 1));
  return [...m.entries()].map(([name, count]) => ({ slug: name, name, count }));
})();

// The skipper's voice, the strings these screens need. Mirrors src/ui/voice.ts.
const VOICE = {
  greeting: "Hop in. I'll do the talking.",
  tagline: "Narrated road-trip audio tours — one corny guide, all the good stops.",
  home: { kicker: "NOW DEPARTING", section: "THE DRIVES", where: { all: "All regions", title: "Where are we headed?" } },
  guest: "Riding as a guest",
  auth: { signInHeader: "Welcome back, folks", signUpHeader: "Come along for the ride", subhead: "Mind the potholes." },
  settings: {
    account: "ACCOUNT", appearance: "APPEARANCE", credits: "CREDITS", creditsAction: "Sources & licenses",
    appearanceHint: "Auto rides with your phone — dusk-dark when the sun clocks out, bright by day. Pin Day or Dusk to hold one mood.",
  },
  gate: {
    title: "Grab your ticket", action: "Get my free ticket", secondary: "Just take the sample ride",
    driveNote: "This is the live, on-the-road drive.",
    body: "The full-length tour needs a (free) ticket — ten seconds, and the skipper never stops talking.",
  },
  loading: { drives: "Charting the good roads…" },
  empty: { drives: "No drives charted here yet. We're still out mapping the good roads — check back soon." },
  error: { generic: "Well, that's a kink in the hose. Give her another pull?", retry: "Give her another pull" },
  legal: {
    title: "Sources & Licenses",
    intro: "The skipper does his homework. Every tale, every rock, every pit stop on a drive is built from the sources below — and we keep the credit where it's due.",
    footer: "Tap a license or a source name to read it in full.",
  },
};

// ── Phone chrome ───────────────────────────────────────────────────────────
function StatusBar() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px var(--space-xl) 4px", color: "var(--ink)" }}>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700 }}>9:41</span>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <Icon name="car" size={13} color="ink" />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>5G</span>
        <div style={{ width: 22, height: 11, borderRadius: 3, border: "1px solid var(--ink)", position: "relative", opacity: 0.8 }}>
          <div style={{ position: "absolute", inset: 1.5, width: "70%", background: "var(--ink)", borderRadius: 1 }} />
        </div>
      </div>
    </div>
  );
}

function NavHeader({ title, wordmark, onBack, onClose, left, right }) {
  // Home (wordmark): a balanced 3-slot bar — equal-flex sides so the wordmark sits
  // DEAD-CENTER no matter how wide the left/right affordances are (Sign in vs. gear).
  if (wordmark) {
    return (
      <div style={{ display: "flex", alignItems: "center", padding: "var(--space-sm) var(--gutter)", minHeight: 44 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start" }}>{left}</div>
        <Text variant="wordmark" color="ink">SKIPPER</Text>
        <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-end" }}>{right}</div>
      </div>
    );
  }
  // Back/close screens: title rides left of the chevron-free flex column (unchanged).
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "var(--space-sm) var(--gutter)", minHeight: 44 }}>
      {onBack ? (
        <button type="button" onClick={onBack} aria-label="Back"
          style={{ width: 40, height: 40, marginLeft: -8, borderRadius: "var(--radius-pill)", border: "none", background: "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <Icon name="back" size={24} color="accent" />
        </button>
      ) : null}
      {onClose ? <HeaderIconButton name="close" accessibilityLabel="Close" onPress={onClose} /> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text variant="title" color="ink" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</Text>
      </div>
      {right}
    </div>
  );
}

function Phone({ children, theme, footer }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18 }}>
      <div data-theme={theme === "dusk" ? "dusk" : undefined}
        style={{ width: 390, height: 800, borderRadius: 44, background: "var(--surface)", overflow: "hidden",
          boxShadow: "0 24px 70px rgba(0,0,0,0.28), 0 0 0 11px #1a1a1a, 0 0 0 13px #2c2c2c", display: "flex", flexDirection: "column", position: "relative" }}>
        <StatusBar />
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{children}</div>
      </div>
      {footer}
    </div>
  );
}

// ── Screens ──────────────────────────────────────────────────────────────
function HomeScreen({ onOpenTour, onSignIn, onSettings, onOpenRegions, selectedRegion, signedIn }) {
  const tours = selectedRegion ? TOURS.filter((t) => t.region === selectedRegion) : TOURS;
  return (
    <>
      <NavHeader wordmark
        left={signedIn ? null : <Button variant="ghost" title="Sign in" fullWidth={false} onPress={onSignIn} />}
        right={<HeaderIconButton name="settings" accessibilityLabel="Settings" onPress={onSettings} />}
      />
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-sm) var(--gutter) var(--gutter)" }}>
        <Card framed>
          <Text variant="label" color="accentWarm">{VOICE.home.kicker}</Text>
          <Text variant="display" color="ink" style={{ display: "block", marginTop: "var(--space-sm)" }}>{VOICE.greeting}</Text>
          <div style={{ margin: "var(--space-md) 0" }}><RouteTrack progress={0.12} glow /></div>
          <Text variant="dim" color="inkDim">{VOICE.tagline}</Text>
        </Card>

        <div style={{ marginTop: "var(--space-lg)" }}>
          <Divider dashed />
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginTop: "var(--space-md)", marginBottom: "var(--space-sm)" }}>
            <Text variant="label" color="inkFaint" style={{ flex: 1 }}>{VOICE.home.section}</Text>
            <FilterChip label={selectedRegion || VOICE.home.where.all} onPress={onOpenRegions} active={!!selectedRegion} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {tours.map((t) => (
            <Card key={t.id} onPress={() => onOpenTour(t.id)}>
              <Text variant="title" color="ink">{t.headline}</Text>
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "var(--space-sm)", marginTop: "var(--space-xs)" }}>
                <Text variant="label" color="inkFaint" style={{ flex: 1 }}>{t.start} → {t.end}</Text>
                <Badge tone="amber" label={`${t.minutes} MIN`} />
              </div>
              <Text variant="body" color="inkDim" style={{ display: "block", marginTop: "var(--space-xs)" }}>{t.teaser}</Text>
            </Card>
          ))}
        </div>
      </div>
    </>
  );
}

function TourDetailScreen({ tour, onBack, onDrive, onPreview }) {
  return (
    <>
      <NavHeader title={tour.region} onBack={onBack} right={<HeaderIconButton name="more" accessibilityLabel="More actions" />} />
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-sm) var(--gutter) var(--gutter)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        <Card framed style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <Text variant="label" color="accentWarm">{tour.region.toUpperCase()}</Text>
          <Text variant="display" color="ink">{tour.headline}</Text>
          <Text variant="label" color="inkFaint">{tour.start} → {tour.end}</Text>
          <div style={{ marginTop: "var(--space-xs)" }}><RouteTrack progress={0.06} glow={false} /></div>
          <Divider dashed />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "var(--space-sm)" }}>
            <Text variant="monoStrong" color="inkDim">{tour.stops.length} STOPS · ~{tour.minutes} MIN</Text>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)" }}>
              <Icon name="downloaded" size={14} color="accent" />
              <Text variant="label" color="accent">Saved offline</Text>
            </span>
          </div>
        </Card>

        {tour.summary ? <Text variant="body" color="inkDim">{tour.summary}</Text> : null}

        <Button icon="car" title="Start the drive" onPress={onDrive} />
        <Text variant="dim" color="inkDim">The skipper talks as you reach each stop on the real roads.</Text>

        <Button variant="secondary" icon="play" title="Take the simulated drive" onPress={onPreview} />

        <StopList
          title={`THE ROUTE · ${tour.stops.length} STOPS`}
          items={tour.stops.map((s) => ({ seq: s.seq, name: s.name, sublabel: STOP_LABEL[s.type], icon: STOP_ICON[s.type] }))}
        />
      </div>
    </>
  );
}

function PlayerScreen({ tour, onBack }) {
  const [playing, setPlaying] = React.useState(true);
  const [pos, setPos] = React.useState(138000);
  const dur = 405000;
  const activeSeq = 6; // Rubicon Point — a story stop, now playing
  const items = tour.stops.map((s) => ({
    seq: s.seq, name: s.name, sublabel: STOP_LABEL[s.type], icon: STOP_ICON[s.type],
    state: s.seq < activeSeq ? "passed" : s.seq === activeSeq ? "active" : "upcoming",
  }));
  const active = tour.stops.find((s) => s.seq === activeSeq);
  return (
    <>
      <NavHeader title="Drive" onBack={onBack} />
      <div style={{ padding: "var(--space-md) var(--gutter) 0" }}>
        <Text variant="title" color="ink" style={{ display: "block" }}>{tour.headline}</Text>
        <Text variant="dim" color="inkDim">{tour.region} · live drive · {activeSeq - 1}/{tour.stops.length} stops</Text>
      </div>
      <div style={{ margin: "var(--space-md) var(--gutter) 0" }}>
        <RouteTrack progress={(activeSeq - 1) / (tour.stops.length - 1)} glow={false} />
      </div>
      <div style={{ flex: 1, minHeight: 0, margin: "var(--space-sm) var(--gutter) 0" }}>
        <StopList scroll style={{ height: "100%" }} items={items} />
      </div>
      <Divider dashed style={{ margin: "var(--space-sm) var(--gutter)" }} />
      <div style={{ padding: "0 var(--gutter) var(--space-lg)" }}>
        <NowCard
          kicker={`NOW PLAYING · ${STOP_LABEL[active.type].toUpperCase()}`}
          title={active.name}
          glow={playing}
          right={<Badge tone={STOP_TONE[active.type]} label={STOP_LABEL[active.type]} />}
          transport={
            <TransportBar
              playing={playing}
              onPlayPause={() => setPlaying((p) => !p)}
              canSeek
              onSeekBack={() => setPos((p) => Math.max(0, p - 15000))}
              onSeekForward={() => setPos((p) => Math.min(dur, p + 15000))}
              secondary={{ title: "Pull over", onPress: onBack }}
            />
          }
        >
          <Scrubber positionMs={pos} durationMs={dur} onSeek={setPos} />
        </NowCard>
      </div>
    </>
  );
}

// ── Regions picker (a modal "board" moment) ────────────────────────────────
function RegionsScreen({ selectedRegion, onChoose, onClose }) {
  const Row = ({ label, meta, selected, onPress }) => (
    <Card onPress={onPress} active={selected}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
        <Icon name={selected ? "check" : "region"} size={20} color={selected ? "accent" : "inkDim"} />
        <Text variant="title" color="ink" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</Text>
        {meta ? <Text variant="dim" color="inkFaint">{meta}</Text> : null}
      </div>
    </Card>
  );
  return (
    <>
      <NavHeader title={VOICE.home.where.title} onClose={onClose} />
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-sm) var(--gutter) var(--gutter)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        <Row label={VOICE.home.where.all} selected={!selectedRegion} onPress={() => onChoose(null)} />
        <Divider />
        {REGIONS.map((opt) => (
          <Row key={opt.slug} label={opt.name} meta={`${opt.count} ${opt.count === 1 ? "drive" : "drives"}`}
            selected={selectedRegion === opt.slug} onPress={() => onChoose(opt.slug)} />
        ))}
      </div>
    </>
  );
}

// ── Sign in / Create account ───────────────────────────────────────────────
function SignInScreen({ onBack, onAuthed, initialMode }) {
  // The free-ticket gate opens this in "up" (create account); the header/settings
  // "Sign in" links open it in "in".
  const [mode, setMode] = React.useState(initialMode === "up" ? "up" : "in");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const submit = () => {
    if (busy) return;
    setError(null);
    if (!email.includes("@") || password.length < 4) {
      setError(VOICE.error.generic);
      return;
    }
    setBusy(true);
    setTimeout(() => { setBusy(false); onAuthed(email); }, 900); // simulate the network round-trip
  };
  return (
    <>
      <NavHeader title={mode === "in" ? "Sign in" : "Create account"} onBack={onBack} />
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-sm) var(--gutter) var(--gutter)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", marginBottom: "var(--space-sm)" }}>
          <Text variant="display" color="ink">{mode === "in" ? VOICE.auth.signInHeader : VOICE.auth.signUpHeader}</Text>
          <Text variant="body" color="inkDim">{VOICE.auth.subhead}</Text>
        </div>
        <Input value={email} onChange={setEmail} placeholder="Email" type="email" autoComplete="email" onSubmit={submit} />
        <Input value={password} onChange={setPassword} placeholder="Password" type="password" autoComplete="current-password" onSubmit={submit} />
        {error ? <Text variant="dim" color="danger">{error}</Text> : null}
        <Button title={mode === "in" ? "Sign in" : "Create account"} loading={busy} onPress={submit} style={{ marginTop: "var(--space-xs)" }} />
        <Button variant="ghost" title={mode === "in" ? "Need an account? Sign up" : "Have an account? Sign in"}
          onPress={() => { setError(null); setMode(mode === "in" ? "up" : "in"); }} />
      </div>
    </>
  );
}

// ── Settings (the parked-context home for prefs + account) ──────────────────
function SettingsScreen({ onBack, signedIn, email, name, onChangeName, onSaveName, savingName, onSignIn, onSignOut, themeMode, onChangeThemeMode, onOpenLegal }) {
  const [draft, setDraft] = React.useState(name || "");
  React.useEffect(() => { setDraft(name || ""); }, [name]);
  const dirty = draft.trim() !== (name || "").trim();
  const save = () => { if (!dirty || savingName) return; onSaveName(draft.trim()); };
  return (
    <>
      <NavHeader title="Settings" onBack={onBack} />
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-sm) var(--gutter) var(--gutter)", display: "flex", flexDirection: "column", gap: "var(--space-xl)" }}>
        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <Text variant="label" color="inkFaint">{VOICE.settings.account}</Text>
          {signedIn ? (
            <>
              <Text variant="dim" color="inkFaint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Riding as {(name && name.trim()) || email}
              </Text>
              <Input value={draft} onChange={setDraft} placeholder="Add your name" autoComplete="name" onSubmit={save} />
              <Button variant="secondary" title="Save name" loading={savingName} disabled={!dirty} onPress={save} />
              <Button variant="secondary" title="Sign out" onPress={onSignOut} />
            </>
          ) : (
            <>
              <Text variant="dim" color="inkFaint">{VOICE.guest}</Text>
              <Button variant="secondary" title="Sign in" onPress={onSignIn} />
            </>
          )}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <Text variant="label" color="inkFaint">{VOICE.settings.appearance}</Text>
          <ThemeModePicker mode={themeMode} onChange={onChangeThemeMode} />
          <Text variant="dim" color="inkFaint">{VOICE.settings.appearanceHint}</Text>
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
          <Text variant="label" color="inkFaint">{VOICE.settings.credits}</Text>
          <Button variant="secondary" title={VOICE.settings.creditsAction} onPress={onOpenLegal} />
        </section>
      </div>
    </>
  );
}

// ── The freemium wall (tour + preview) ──────────────────────────────────────
function GateScreen({ onBack, onGetTicket, onSample }) {
  return (
    <>
      <NavHeader title={VOICE.gate.title} onBack={onBack} />
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-xl) var(--gutter)" }}>
        <Card framed style={{ alignSelf: "stretch", display: "flex", flexDirection: "column", alignItems: "center", gap: "var(--space-md)", padding: "var(--space-xxl) var(--space-xl)" }}>
          <Badge tone="amber" filled label="FREE" />
          <Text variant="placardTitle" color="ink" align="center">{VOICE.gate.title}</Text>
          <Text variant="body" color="inkDim" align="center" style={{ textWrap: "pretty" }}>
            {VOICE.gate.driveNote} {VOICE.gate.body}
          </Text>
          <Button icon="ticket" title={VOICE.gate.action} onPress={onGetTicket} style={{ marginTop: "var(--space-xs)" }} />
          <Button variant="ghost" title={VOICE.gate.secondary} onPress={onSample} />
        </Card>
      </div>
    </>
  );
}

// ── Legal / attribution (Settings → Credits) ───────────────────────────────
const LICENSES = [
  { name: "USGS Geographic Names", code: "PUBLIC DOMAIN" },
  { name: "Sierra Club trail notes", code: "CC BY-SA 4.0" },
  { name: "Tahoe Historical Society", code: "CC BY 4.0" },
  { name: "Glovebox playlist · K. Rourke", code: "LICENSED" },
];
function LegalScreen({ onBack }) {
  return (
    <>
      <NavHeader title={VOICE.legal.title} onBack={onBack} />
      <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-sm) var(--gutter) var(--gutter)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
        <Text variant="body" color="inkDim" style={{ textWrap: "pretty" }}>{VOICE.legal.intro}</Text>
        <StopList items={LICENSES.map((l, i) => ({ seq: i, name: l.name, sublabel: l.code, icon: "ticket" }))} />
        <Text variant="dim" color="inkFaint" align="center">{VOICE.legal.footer}</Text>
      </div>
    </>
  );
}

// ── The shared states, titled like the screens that host them ───────────────
function StateScreen({ kind }) {
  const map = {
    loading: { title: "The Drives", props: { message: VOICE.loading.drives, loading: true } },
    empty: { title: "The Drives", props: { message: VOICE.empty.drives } },
    error: { title: "The Drives", props: { message: VOICE.error.generic, tone: "danger", action: { label: VOICE.error.retry, onPress: () => {} } } },
  };
  const s = map[kind] || map.loading;
  return (
    <>
      <NavHeader title={s.title} />
      <StateView {...s.props} />
    </>
  );
}

Object.assign(window, {
  TOURS, REGIONS, VOICE, Phone,
  HomeScreen, TourDetailScreen, PlayerScreen,
  RegionsScreen, SignInScreen, SettingsScreen, GateScreen, LegalScreen, StateScreen,
});
