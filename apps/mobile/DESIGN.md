# Skipper — Design Language ("Trailhead 89")

> A 1938 WPA national-park poster that learned to play audio. The product is a
> warm, corny, hand-crafted labor of love, so the interface should make you smile
> _before_ the skipper says a word — while staying glanceable from a car mount at
> 60 mph. **Charm is the product; legibility is non-negotiable.**

This is the source of truth for the app's look, feel, and voice. The code lives in
`src/theme/` (tokens + themes) and `src/ui/` (primitives). Screens compose
primitives and never hardcode a hex, font, or spacing number.

---

## 1. The feeling

Cream map-paper, a confident pine green, a low sunset amber, ink-brown lettering
thick enough to read through a windshield. References: the screen-printed "SEE
AMERICA" poster series, carved-and-routed ranger trail signs, enamel travel
badges, the dog-eared Rand McNally atlas in the glovebox. Dark mode isn't "black
mode" — it's **dusk settling over the park**: deep pine sky, parchment text that
won't burn night-driving eyes, a campfire-amber glow on whatever's playing.

The persona is a **skipper** — a boat captain who calls his car a boat and means
it. So the one moving thing on the route is a little **boat token** gliding the
trail, and the voice talks in wakes, knots, docks, and boarding passes. The park
is the _setting_; the skipper is the _star_.

## 2. Principles (in priority order)

1. **Glanceable beats decorated.** Every screen must be legible in a half-second
   from a mount. Ornament (screw-dots, sunbursts, stamps, the carved keyline) is
   reserved for **non-driving** surfaces and **large** sizes. When ornament fights
   the glance, ornament loses.
2. **Charm lives in voice, motif, and warmth — not clutter.** One signature move
   per screen (the boat on the trail; the glowing NOW card; the passport-stamp on
   a passed stop). Never six.
3. **Contrast is enforced by the token set, not by discipline.** See §4. There is
   intentionally no "amber text on paper" role to misuse.
4. **Dark mode is a peer, not an afterthought.** Night is the headline drive. The
   mood toggle (`◑ DAY` / `◐ DUSK`) is a first-class, always-reachable control.
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

- `amberToken` is a **fill/shape color only** — used for the moving boat token,
  meter pips, the active edge-bar. There is **no** amber-text-on-surface role.
- Warm accent **text** (the NOW kicker, badge labels) uses `accentWarm`, which is a
  **burnt** amber in daylight (`#9A4D17`, ~5:1 on paper) and lantern amber at dusk.
- A **filled** amber disc takes `onAmber` (= ink-brown in both themes, 5.25:1 light /
  7.52:1 dusk) — never `onPrimary` (cream is tuned for the pine fill, not amber).
- `primaryFill` + `onPrimary` flip by theme and are always paired: **pine + cream**
  in daylight (a ranger sign), **lantern-amber + ink** at dusk (a campfire-lit
  button). Never restyle one without the other.
- Every text role here clears **4.5:1 on `surface` AND `surfaceRaised`** in both
  themes (verified, not aspirational). Caveat: `danger` / `water` / `accentWarm` as
  _text_ are scoped to those two surfaces — they dip just under 4.5:1 on
  `surfaceSunken`, so don't put colored text on an inset well.
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

- **Alfa Slab One** — the WPA silkscreen display. Heavy strokes are _more_
  glanceable at large sizes, so this doubles as a legibility win. **Large only.**
- **Bitter** — a screen-tuned slab serif; carries the placard warmth down to UI
  scale (400 / 600 / 700). All body, headings, labels.
- **Space Mono** — the park-permit / odometer numerals (timers, coords, mileage).
  Tabular feel = stamped, non-jumping clocks.

| Variant             | Family / size         | Use                                |
| ------------------- | --------------------- | ---------------------------------- |
| `wordmark`          | Alfa Slab 26          | "SKIPPER" in the home header       |
| `display`           | Alfa Slab 30          | screen hero titles                 |
| `placardTitle`      | Alfa Slab 22          | NOW-playing stop name, card titles |
| `titleXL`/`title`   | Bitter 700 24/20      | screen + section titles            |
| `heading`           | Bitter 700 17         | card headings, button labels       |
| `body`/`bodyStrong` | Bitter 400/600 16     | paragraphs, list names             |
| `label`             | Bitter 600 12.5 UPPER | kickers, badges, section labels    |
| `dim`               | Bitter 400 13.5       | sublabels, metadata                |
| `mono`/`monoStrong` | Space Mono 14/15      | timers, coordinates, mileage       |

**Rule:** heavy display faces are reserved for large sizes; small in-car-critical
text stays Bitter (never Alfa Slab below ~20pt — it muddies the glance).

## 6. Components (`src/ui/`)

All token-driven and theme-aware. Compose these; don't restyle from scratch.

- **`Text`** — the only text primitive. `variant` (type scale) + `color` (a
  **semantic role only** — the type system blocks raw hex).
- **`Screen`** — paints `surface`, owns safe-area (top inset belongs to the Stack
  header). `scroll` / `padded` / `center` flags.
- **`Button`** — `primary` (enamel CTA: ranger-green sign by day, campfire-lit amber
  by dusk, ≥60pt), `secondary` (outlined placard), `ghost` (text link). `glyph` =
  leading icon (emoji placeholder today).
- **`Card`** — the ranger placard. Plain by default (glanceable); `framed` adds the
  carved double-keyline + corner screw-dots — **non-driving surfaces only**.
- **`Badge`** — enamel pill for stop types, lengths, the joke meter. `tone`
  (`pine·amber·teal·rust·neutral`) maps to a contrast-safe text color; `filled` for
  a solid disc.
- **`Divider`** — hairline or `dashed` (the atlas-trail rule).
- **`RouteTrack`** — the signature motif: a dashed trail with the **boat token**
  gliding along it. Driven by an `Animated.Value` in `[0,1]` (JS-driven — keep it
  the only thing animating per frame).
- **`StopRow`** — a stop with three glance-states: `upcoming` (hollow ▶), `active`
  (amber edge-bar + tinted bed, ♪), `passed` (filled bullet + ✦ stamp).
- **`NowCard`** — the now-playing placard; the one surface that earns the amber glow.
- **`Input`** — themed field, ≥48pt, pine focus ring.
- **`ThemeToggle`** — Daylight ⇄ Dusk.

## 7. Voice in the UI (`src/ui/voice.ts`)

Microcopy is brand-critical and **centralized** — every empty/error/loading/CTA
string speaks as the skipper. Keep it warm, corny, and short (glanceable). Examples:

- Loading: _"Firing up the engine, folks. She starts when she's good and ready."_
- Empty: _"No drives charted here yet. We're still out mapping the good water."_
- Error: _"Well, that's a knot in the line. Give her another pull?"_
- Play CTA: _"All aboard — start the drive."_
- Gate: _"Anonymous riders get the sampler. Grab a free boarding pass and the whole lake's yours."_
- Drive complete: _"That's the dock, folks. Watch your step on the way off."_

**Invariant:** voice is _delivery_, never _facts_. No place names, hours, or data
live in `voice.ts`. (Mirrors the generator's "persona lives in DELIVERY" rule.)

## 8. In-car & accessibility rules

- Half-second glance test: if a driver can't parse a screen's primary state in
  ~500ms, simplify it.
- ≥48pt hit targets; ≥60pt primary CTAs; generous spacing between tappables.
- No low-contrast text on the move. Amber is a fill; warm text is `accentWarm`.
- At most **one** moving/glowing amber element on screen at once (the boat token
  _or_ the NOW glow, not a field of them) — peripheral-vision halation is a real
  night-driving distraction.
- Respect Dynamic Type direction (sizes are starting points; don't cap user scaling
  hard).

## 9. Deferred ornament (earn it later — don't block on it)

These are **specced, not built** — the bet is that the system reads as Trailhead 89
on day one with emoji placeholders, then gets richer:

- **Custom enamel-badge SVG set** (`react-native-svg`): replace the emoji glyphs in
  `stops.ts` / buttons with hand-drawn badges — story = open placard, scenic =
  twin-peaks-with-binoculars, break = enamel coffee cup, the boat token, CA-89
  highway shields for corridor numbers.
- **Passport-stamp animation:** reaching a stop "inks" a postmark on its row
  (`Animated` scale + rotate + opacity, `duration.stamp`). `StopRow` already models
  the `passed` state; this is the motion on top.
- **Amber sunburst + postmark watermarks** behind hero headers / empty states
  (`expo-linear-gradient` or a static SVG — never animate color stops on Android).
- **Splash/app icon** rework to the wordmark + badge (`assets/` is currently empty).
- **Persist the theme override** to `expo-secure-store` (today it's in-memory).

## 10. How to extend

1. New color need → add a **semantic role** to `ThemeColors` + map it in both
   themes. Never reach past a role to a raw hex in a screen.
2. New text style → add a `typeScale` variant; don't inline `fontFamily`/`fontSize`.
3. New surface → compose `Screen` + `Card` + `Text`; if you're writing a `StyleSheet`
   color, stop and add/lookup a token.
4. New copy → add it to `voice.ts` in character.
