# Skipper — Design Language ("Trailhead 89")

> A 1938 WPA national-park poster that learned to play audio. The product is a
> warm, corny, hand-crafted labor of love, so the interface should make you smile
> _before_ the skipper says a word — while staying glanceable from a car mount at
> 60 mph. **Charm is the product; legibility is non-negotiable.**

This is the source of truth for the app's look, feel, and voice. The code lives in
`src/theme/` (tokens + themes) and `src/ui/` (primitives). Screens compose
primitives and never hardcode a hex, font, or spacing number.

> A browsable HTML **mirror** of this system (a specimen book + brand front door,
> exported from Claude Design) lives at the repo root in `/design-system` — open
> `design-system/index.html`. It's generated *from* this code, so when they
> disagree, this code wins; see `design-system/README.md`.

---

## 1. The feeling

Cream map-paper, a confident pine green, a low sunset amber, ink-brown lettering
thick enough to read through a windshield. References: the screen-printed "SEE
AMERICA" poster series, carved-and-routed ranger trail signs, enamel travel
badges, the dog-eared Rand McNally atlas in the glovebox. Dark mode isn't "black
mode" — it's **dusk settling over the park**: deep pine sky, parchment text that
won't burn night-driving eyes, a campfire-amber glow on whatever's playing.

The persona is **the Skipper** — a road-trip tour guide with the soul of a corny
old ride-along skipper. So the one moving thing on the route is a little **car
token** gliding the trail, and the voice talks in engines, pit stops, the open
road, and his cranky old truck. The park is the _setting_; the Skipper is the
_star_.

## 2. Principles (in priority order)

1. **Glanceable beats decorated.** Every screen must be legible in a half-second
   from a mount. Ornament (screw-dots, sunbursts, stamps, the carved keyline) is
   reserved for **non-driving** surfaces and **large** sizes. When ornament fights
   the glance, ornament loses.
2. **Charm lives in voice, motif, and warmth — not clutter.** One signature move
   per screen (the car on the trail; the glowing NOW card; the passport-stamp on
   a passed stop). Never six.
3. **Contrast is enforced by the token set, not by discipline.** See §4. There is
   intentionally no "amber text on paper" role to misuse.
4. **Dark mode is a peer, not an afterthought.** Night is the headline drive. **Auto**
   follows the phone (dusk-dark at night by default); the explicit Auto/Day/Dusk picker
   (`ThemeModePicker`) lives on Settings behind the home gear — deliberately NOT in global
   chrome, so nothing tempts a mid-drive fiddle.
5. **Big thumbs, gloves, potholes.** Nothing tappable below 48pt; primary CTAs ≥60pt.

## 3. Tokens (`src/theme/tokens.ts`)

Raw values + scales. Components reference the **semantic roles** in §4, not these.

- **Spacing** (`space`) — 4-pt grid: `xs 4 · sm 8 · md 12 · lg 16 · xl 20 · xxl 24 · xxxl 32 · huge 48`. Screen edge = `gutter 16`.
- **Radius** (`radius`) — `sm 8 · md 12 · lg 16 · xl 20 · pill 999`.
- **Border** (`border`) — `hair 0.5 · thin 1 · keyline 1.5` (the carved double-rule).
- **Motion** (`duration`, ms) — `fast 120 · base 220 · slow 420 · stamp 520`.
- **Hit targets** (`hit`) — `min 48 · cta 60`.

## 4. Color — semantic roles (`src/theme/theme.ts`)

Two themes (`lightTheme` / `darkTheme`) map the raw palette onto one role set, so
light↔dark swap for free. **The contrast footguns are designed out:**

- `amberToken` is a **fill/shape color only** — used for the moving car token, meter
  pips, the Scrubber thumb. There is **no** amber-text-on-surface role. (The route list's
  active row is a **pine/sunken** cue, not amber — the card owns the one glow.)
- Warm accent **text** (the NOW kicker, badge labels) uses `accentWarm`, which is a
  **burnt** amber in daylight (`#9A4D17`, ~5:1 on paper) and lantern amber at dusk.
- A **filled** amber disc takes `onAmber` (= ink-brown in both themes, 5.25:1 light /
  7.52:1 dusk) — never `onPrimary` (cream is tuned for the pine fill, not amber).
- `primaryFill` + `onPrimary` flip by theme and are always paired: **pine + cream**
  in daylight (a ranger sign), **lantern-amber + ink** at dusk (a campfire-lit
  button). Never restyle one without the other.
- Every text role here clears **4.5:1 on `surface` AND `surfaceRaised`** in both
  themes (verified by `theme.test.ts`, not aspirational). Caveat: on the **light
  `surfaceSunken`** token, `inkFaint` (4.30), `water` (4.12), `danger` (4.39), and
  `accentWarm` (4.35) all dip under 4.5:1 — so as _text_ on an inset well use only
  `ink`, `inkDim`, or `accent` (the set `theme.test.ts` now gate-enforces on
  `surfaceSunken`). Dark-mode sunken clears all of them.
- The amber **glow** (`glow` token) is applied via RN's cross-platform `boxShadow`,
  not iOS-only `shadow*` props, so the night-drive halo renders on Android too.

| Role            | Daylight        | Dusk            | Use                                              |
| --------------- | --------------- | --------------- | ------------------------------------------------ |
| `surface`       | `#F2E7CC` paper | `#14201B` night | app background                                   |
| `surfaceRaised` | `#FBF3DD`       | `#1E2B24`       | cards / placards                                 |
| `surfaceSunken` | `#E7D9B5`       | `#101A15`       | inset wells (timer chips, track bed)             |
| `keyline`       | `#FFF8E6`       | `#2A3A30`       | carved inner rule                                |
| `ink`           | `#2A2014`       | `#ECE0C4`       | primary text                                     |
| `inkDim`        | `#5C4A30`       | `#A99D80`       | secondary text                                   |
| `inkFaint`      | `#74603E`       | `#9A9075`       | hints (cleared to ≥4.5:1)                        |
| `accent`        | `#1E5B40` pine  | `#5FA877`       | active bullets, links, icons, success **text**   |
| `accentWarm`    | `#9A4D17`       | `#EBA351`       | warm accent **text** (kickers, badges)           |
| `amberToken`    | `#DD7A33`       | `#EBA351`       | bright amber **fill/shape only**                 |
| `onAmber`       | `#2A2014`       | `#2A2014`       | ink on a filled amber disc                       |
| `water`         | `#2C6E7E` teal  | `#5FA7B8`       | scenic / water motif                             |
| `primaryFill`   | `#1E5B40`       | `#EBA351`       | primary button + active-track fill               |
| `onPrimary`     | `#FBF3DD`       | `#2A2014`       | text on `primaryFill`                            |
| `trackActive`   | `#1E5B40`       | `#5FA877`       | traveled portion of the route trail              |
| `trackInactive` | `#CDB988`       | `#3A4A3E`       | dashed untraveled trail + hairlines              |
| `rule`          | `#CDB988`       | `#3A4A3E`       | dividers, card keylines                          |
| `danger`        | `#A8401F` rust  | `#E97559` ember | errors                                           |
| `glow`          | amber 30% α     | amber 42% α     | campfire halo (boxShadow) — NOW card, CTA, token |
| `shadowCast`    | ink 20% α       | black 50% α     | neutral daylight cast shadow                     |
| `scrim`         | ink 42% α       | black 55% α     | behind sheets / gates                            |

## 5. Type (`fonts` + `typeScale`)

Three families, loaded via `@expo-google-fonts` (held behind the splash by
`useAppFonts()` in `_layout.tsx`):

- **Zilla Slab** — constructed, even-weight slab with park-sign energy (700 for all
  display uses; the token bakes the weight in — never set display to 400). **Large only (~18pt+).**
- **Lora** — calligraphic screen slab; road-notebook warmth carried to UI scale
  (400 / 600 / 700). All body, headings, labels.
- **Overpass Mono** — highway-sign / odometer numerals (timers, coords, mileage).
  Designed with US federal highway-signage DNA; SemiBold 600 is the badge weight.

| Variant             | Family / size           | Use                                |
| ------------------- | ----------------------- | ---------------------------------- |
| `wordmark`          | Zilla Slab 700 · 26     | "SKIPPER" in the home header       |
| `display`           | Zilla Slab 700 · 30     | screen hero titles                 |
| `placardTitle`      | Zilla Slab 700 · 22     | NOW-playing stop name, card titles |
| `titleXL`/`title`   | Lora 700 · 24/20        | screen + section titles            |
| `heading`           | Lora 700 · 17           | card headings, button labels       |
| `body`/`bodyStrong` | Lora 400/600 · 16       | paragraphs, list names             |
| `label`             | Lora 600 · 12.5 UPPER   | kickers, badges, section labels    |
| `dim`               | Lora 400 · 13.5         | sublabels, metadata                |
| `mono`/`monoStrong` | Overpass Mono 400/600 · 14/15 | timers, coordinates, mileage  |

**Rule:** Zilla Slab is reserved for large sizes (~18pt+); small in-car-critical
text stays Lora (never Zilla Slab below ~18pt — it muddies the glance).

## 6. Components (`src/ui/`)

All token-driven and theme-aware. Compose these; don't restyle from scratch.

- **`Text`** — the only text primitive. `variant` (type scale) + `color` (a
  **semantic role only** — the type system blocks raw hex).
- **`Screen`** — paints `surface`, owns safe-area (top inset belongs to the Stack
  header). `scroll` / `padded` / `center` flags.
- **`Button`** — `primary` (enamel CTA: ranger-green sign by day, campfire-lit amber
  by dusk, ≥60pt), `secondary` (outlined placard), `ghost` (text link). `icon` = a
  leading vector icon (an `IconName`).
- **`Icon`** — vector icons (Ionicons via `@expo/vector-icons`); semantic names
  (`play`, `car`, `story`…) mapped in `Icon.tsx`. **Use these, NOT emoji** — this
  build has no color-emoji fallback, so emoji render as tofu (`?`).
- **`Card`** — the ranger placard. Plain by default (glanceable); `framed` adds the
  carved double-keyline + corner screw-dots — **non-driving surfaces only**.
- **`Badge`** — enamel pill for stop types, lengths, the joke meter. `tone`
  (`pine·amber·teal·rust·neutral`) maps to a contrast-safe text color; `filled` for
  a solid disc.
- **`Divider`** — hairline or `dashed` (the atlas-trail rule).
- **`RouteTrack`** — the signature motif: a dashed trail with the **car token**
  gliding along it. Driven by an `Animated.Value` in `[0,1]` (JS-driven — keep it
  the only thing animating per frame).
- **`StopRow`** — a stop with three glance-states: `upcoming` (calm glyph + name),
  `active` (a sunken "you-are-here" well + **pine** accent glyph + bold name — never amber;
  the player card owns the one glow), `passed` (dimmed + a quiet check). Composed by `StopList`.
- **`StopList`** — the route itinerary: one card of `StopRow`s, hairline-ruled, shared by
  tour detail and the player. A `scroll` mode makes it a fixed shell (rows scroll inside,
  the player) vs content-sized (the host page scrolls, tour detail).
- **`NowCard`** — the now-playing placard; the one surface that earns the amber glow. Holds a
  kicker + title (+ optional mono timer/badge), a state-dependent middle, and the transport.
- **`TransportBar`** — the player transport: a glow-less center play/pause flanked by ±15
  jogs, plus a `single`-CTA mode (ready/done) with an optional ghost secondary.
- **`Scrubber`** — the in-clip position bar (sunken bed, pine fill, amber car-token thumb).
- **`FilterChip`** — the home "Where to?" region chip. **`HeaderIconButton`** — the
  self-drawn circular nav-bar chip (strips the iOS-26 Liquid Glass capsule).
- **`Input`** — themed field, ≥48pt, pine focus ring.
- **`ThemeModePicker`** — Auto / Day / Dusk segmented control (lives on Settings).
- **`StateView`** — the shared loading / error / empty centered state (`loading`,
  `tone`, `action`, `title`). Kills the repeated `<Screen center>…` boilerplate.
- **`AccountGate`** — the shared freemium wall (tour + preview). A "smart" composite:
  unlike the pure primitives it knows the sign-in route + gate copy.

## 7. Voice in the UI (`src/ui/voice.ts`)

Microcopy is brand-critical and **centralized** — every empty/error/loading/CTA
string speaks as the skipper. Keep it warm, corny, and short (glanceable). Examples:

- Loading: _"Firing up the engine, folks. She starts when she's good and ready."_
- Empty: _"No drives charted here yet. We’re still out mapping the good roads."_
- Error: _"Well, that’s a kink in the hose. Give her another pull?"_
- Play CTA: _"Let’s roll — start the drive."_
- Gate: _"Anonymous riders get the sampler. Hop in for free and the whole lake’s yours."_
- Drive complete: _"That’s the end of the road, folks. Watch your step climbing out."_

**Invariant:** voice is _delivery_, never _facts_. No place names, hours, or data
live in `voice.ts`. (Mirrors the generator's "persona lives in DELIVERY" rule.)

## 8. In-car & accessibility rules

- Half-second glance test: if a driver can't parse a screen's primary state in
  ~500ms, simplify it.
- ≥48pt hit targets; ≥60pt primary CTAs; generous spacing between tappables.
- No low-contrast text on the move. Amber is a fill; warm text is `accentWarm`.
- At most **one** moving/glowing amber element on screen at once (the car token
  _or_ the NOW glow, not a field of them) — peripheral-vision halation is a real
  night-driving distraction.
- **Dynamic Type is intentional, not accidental** (`IN_CAR_MAX_FONT_SCALE` in
  `tokens.ts`). SCROLLABLE / non-driving surfaces (Settings, Sign-in, the corridor +
  tour lists, Legal) stay **uncapped** — full iOS Dynamic Type incl. the accessibility
  (AX) sizes, so all real content honors WCAG 1.4.4. Only the few **glance-critical
  in-car player surfaces** — the flanked transport labels, the mono timers, the NOW-card
  title — cap growth (at ~1.35×, iOS's largest _standard_ size) so a label can't blow out
  the fixed control row or truncate mid-word at 60mph. Nothing is lost on a capped
  surface: those strings are short and mirrored by an icon + `accessibilityLabel` (timers
  by the scrubber's spoken `accessibilityValue`). Stop-list auto-scroll multiplies
  `STOP_ROW_HEIGHT` by `PixelRatio.getFontScale()` so it tracks grown rows.

## 9. Deferred ornament (earn it later — don't block on it)

The system reads as Trailhead 89 today on the **vector Ionicon** set (`stops.ts`,
`Icon.tsx`); these enrich it further. Some have since shipped (noted ✅):

- **Custom enamel-badge SVG set** (`react-native-svg`): replace the Ionicon glyphs in
  `stops.ts` / buttons with hand-drawn badges — story = open placard, scenic =
  twin-peaks-with-binoculars, break = enamel coffee cup, the car token, CA-89
  highway shields for corridor numbers.
- **Passport-stamp animation:** reaching a stop "inks" a postmark on its row
  (`Animated` scale + rotate + opacity, `duration.stamp`). ✅ First home shipped: the
  drive-complete cascade stamps the passed rows in (gated on Reduce Motion). The live
  per-stop ink is the remaining piece.
- **Amber sunburst + postmark watermarks** behind hero headers / empty states
  (`expo-linear-gradient` or a static SVG — never animate color stops on Android).
- **Splash/app icon.** ✅ Shipped: the locked **M1 "compass porthole"** — a play triangle
  that's a window onto the park (sun, ridgeline, snow-cap), framed by a compass dial with an
  amber north; text-free, day & dusk (`icon-dark.png`). SVG sources + `build.sh` in
  `assets/brand/`, wired in `app.json`. (The enamel travel badge is now reserved as the
  separate in-app home-hero mark, not the launcher.)

## 10. How to extend

1. New color need → add a **semantic role** to `ThemeColors` + map it in both
   themes. Never reach past a role to a raw hex in a screen.
2. New text style → add a `typeScale` variant; don't inline `fontFamily`/`fontSize`.
3. New surface → compose `Screen` + `Card` + `Text`; if you're writing a `StyleSheet`
   color, stop and add/lookup a token.
4. New copy → add it to `voice.ts` in character.

## 11. Enforcement (the guarantees above are executable, not aspirational)

A review found the real failure mode is **drift between this doc and the code** (the
4.5:1 claim was once false; tokens got hardcoded). So the guarantees self-check:

- **`bun run lint:tokens`** — fails if any file in `app/` or `src/ui/` hardcodes a
  hex / rgba / `fontFamily` string. Colors + fonts live in `src/theme` ONLY.
- **`bun test`** (`src/theme/theme.test.ts`) — asserts every text role clears 4.5:1
  on `surface` + `surfaceRaised` in both themes (this §4 guarantee). A palette tweak
  that breaks it fails the test.
- **`bun run check`** runs lint:tokens + typecheck + test together. Run it when you
  touch the design system; wire it into CI/precommit when there is one.
