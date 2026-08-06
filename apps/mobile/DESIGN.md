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
   per screen (the car on the trail; the glowing NOW card; the passport-stamp cascade
   when the drive ENDS — §9, the live per-stop ink is still unbuilt). Never six.
3. **Contrast is enforced by the token set, not by discipline.** See §4. There is
   intentionally no "amber text on paper" role to misuse.
4. **DAY IS THE REFERENCE THEME; dusk is a first-class peer** (founder, 2026-08-03 — this reverses
   the earlier "night is the headline drive"). Most drives happen in daylight, so DAY is what gets
   designed, reviewed and measured FIRST, and a daylight contrast failure is blocking rather than a
   follow-up. ⚠ This changed the PRIORITY, not the RUNTIME: **Auto** still follows the phone, so a day
   driver already gets day and a night driver still gets dusk — flipping the default would hand a
   night driver a bright screen, which is the thing dusk exists to prevent. The explicit
   Auto/Day/Dusk picker (`ThemeModePicker`) lives on Settings behind the home gear — deliberately NOT
   in global chrome, so nothing tempts a mid-drive fiddle.
   ⚠ The reversal was earned, not stylistic: reviewing dusk first is exactly why two daylight-only
   defects shipped and were caught by measurement rather than by eye — the route line at 2.07 on the
   day roads, and the amber puck at ~2.5 on the day basemap (TODO.md). When a theme is reviewed
   second, its bugs are found second.
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

- `amberToken` is a **fill/shape color only**, and this is the whole of what wears it: the car
  token (`RouteTrack`), the `Scrubber` thumb, the lit `NowCard`'s border, a `filled` amber `Badge`,
  the map's active-stop dot + rider puck (`DriveMap`), the collapsed player's peek-bar edge, and
  the low-opacity `Sunburst` watermark (home + `/sample`). The route list's active row is a
  **pine/sunken** cue, not amber — the card owns the one glow. There is **no** amber-text-on-surface
  role, and since 2026-08-03 that is a compile error rather than a convention: `Text`'s `color` takes
  `TextColorRole` (a `Pick` off `ThemeColors`), so `<Text color="amberToken">` no longer typechecks.
  ⚠ This bullet used to name "meter pips", and the app has never drawn one. Same failure shape as
  the `glow` row below: a phantom entry in a list a reader takes as exhaustive is how a hand-rolled
  amber surface gets talked into existing. Grep the role before trusting any consumer list here.
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
- **`routeTrail` exists because a role can collide with the BASEMAP** (2026-08-03). The route was
  drawn in `trackInactive` — correct on our own surfaces, where nothing competes — but
  `theme/mapStyle.ts` paints the basemap's minor roads from that exact value, so the line sat on the
  roads at **contrast 1.00 in both themes**. On device it did not read as faint, it read as a
  MISSING polyline, and was only found in the accessibility tree. Its own role now, with its own
  regression test (§11): the route must clear 3:1 on the roads *unaided*, since a `surface` casing
  can't rescue a line lost in the road it traces. ⚠ The dusk value is the DAYLIGHT tan on purpose —
  over a night basemap a light atlas tan is the legible mark, and this is a route, not text.
- **The separating edge on a map mark is TWO-TONE, and that is forced, not decorative** (2026-08-03).
  Every marker ring was `surface` — the token `mapStyle.ts` also paints the basemap's LAND from — so
  the edge measured **1.00 against land in both themes**: it separated marks from water and roads and
  did nothing on the surface a route mostly lies on. ⚠ Swapping it for `ink` is the obvious fix and is
  WRONG: measured, that repairs land (12.99) and breaks the lake (4.69 → 2.71), which the §11 gate
  caught the moment it was tried. Day land is pale and day water is dark, so no single edge colour
  clears both — the same reason the route line needed a casing. `ink` is the inverse of `surface` in
  both themes, so an inner `surface` ring inside an outer `ink` hairline covers pale and dark layers
  at once, which is how a map pin has always been built.
- The amber **glow** (`glow` token) is applied via RN's cross-platform `boxShadow`,
  not iOS-only `shadow*` props, so the night-drive halo renders on Android too.
  ⚠ **AND IT IS A DUSK EFFECT, FULL STOP** (2026-08-03). Measured, the halo composites to 2.45 against
  the night surface and **1.30** against paper — in daylight it rendered *nothing* while still costing
  a shadow pass. Every consumer now theme-gates it and uses `shadowCast` in day, which is what this
  table already calls "neutral daylight cast shadow": a lantern glows at dusk, a painted ranger sign
  in the sun casts a shadow. `Button` had done this correctly since it was written; the pattern simply
  never propagated to `NowCard`, `RouteTrack` or `DriveMap`, which is why day looked flat.
  ⚠ So the light theme's `glow` value is now read by NOTHING. It stays only because `ThemeColors`
  requires the key — do not "wire it up" to make it useful.

| Role            | Daylight        | Dusk            | Use                                              |
| --------------- | --------------- | --------------- | ------------------------------------------------ |
| `surface`       | `#F2E7CC` paper | `#14201B` night | app background                                   |
| `surfaceRaised` | `#FBF3DD`       | `#1E2B24`       | cards / placards                                 |
| `surfaceSunken` | `#E7D9B5`       | `#101A15`       | inset wells (timer chips, track bed)             |
| `surfaceFade`   | `surface` @ 0 α | `surface` @ 0 α | the transparent end of a scroll-edge fade (`EdgeFade`) — derived from `surface`, never CSS `transparent` (which interpolates through black and tints the dissolve) |
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
| `routeTrail`    | `#6B552F`       | `#CDB988`       | the route line **on a basemap** — distinct from `trackInactive`, the same trail on our OWN surfaces |
| `rule`          | `#CDB988`       | `#3A4A3E`       | dividers, card keylines                          |
| `danger`        | `#A8401F` rust  | `#E97559` ember | errors                                           |
| `onDanger`      | `#FBF3DD`       | `#2A2014`       | text on a `danger` fill (the `rust` filled Badge) — a `TextColorRole`, gate-tested as an ON_FILL pair |
| `glow`          | (unused — see ⚠) | amber 42% α     | campfire halo (boxShadow) — DUSK only: NOW card, CTA, car token, map puck + active stop |
| `shadowCast`    | ink 20% α       | black 50% α     | neutral daylight cast shadow                     |
| `scrim`         | ink 42% α       | black 55% α     | behind sheets / gates                            |

**On the map's district wash** — `areaFill`/`areaStroke` were cut in the 1.1 sweep along with
the AREA trigger they coloured. Nothing draws a district hull any more. Recorded because the reasoning
is worth keeping if one ever returns: teal was deliberate and constrained on both sides — pine is the
story-dot colour, so a pine wash reads as the same object class, and the screen's one amber is spent on
the rider's puck (§8).

## 5. Type (`fonts` + `typeScale`)

Three families, loaded via `@expo-google-fonts` (held behind the splash by
`useAppFonts()` in `_layout.tsx`):

- **Zilla Slab** — constructed, even-weight slab with park-sign energy (700 for all
  display uses; the token bakes the weight in — never set display to 400). **Large only (~18pt+).**
- **Lora** — calligraphic screen slab; road-notebook warmth carried to UI scale
  (400 / 600 / 700). All body, headings, labels.
- **Overpass Mono** — highway-sign / odometer numerals, designed with US federal
  highway-signage DNA. Numbers that must not reflow as they tick: the player's elapsed/remaining
  timers, the ±15 jog labels. ⚠ This bullet claimed "coords" and no screen renders a coordinate —
  there is no call site and never was. And SemiBold 600 is **not** "the badge weight":
  a `Badge` renders `variant="label"` (Lora 600). `monoStrong`'s one call site is the drive-detail
  permit line ("N STOPS · ~M MIN") — a stamped placard number, not a pill.

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
| `mono`/`monoStrong` | Overpass Mono 400/600 · 14/15 | player timers + ±15 jogs / the drive-detail permit line |

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
- **`Glyph`** — the escape hatch `Icon` doesn't cover: an emoji/symbol character rendered in the
  SYSTEM font, because a custom-font run does not fall back and would render tofu. Decorative
  (hidden from the a11y tree); a placeholder until the §9 enamel-badge SVGs land.
- **`Card`** — the ranger placard. Plain by default (glanceable); `framed` adds the
  carved double-keyline + corner screw-dots — **non-driving surfaces only**.
- **`Badge`** — enamel pill for stop types and lengths. `tone`
  (`pine·amber·teal·rust·neutral`) maps to a contrast-safe text color; `filled` for
  a solid disc.
- **`Divider`** — hairline or `dashed` (the atlas-trail rule).
- **`Segmented`** — the sunken track of 2+ exclusive options, selected one lifted to a raised enamel
  segment. This **is** the drive-detail List⇄Map toggle; `ThemeModePicker` and `SimModePicker` are its
  two hand-built siblings, not wrappers. Placard/settings surfaces only — an eyes-on-road surface
  wants a floating icon button.
- **`Skeleton` / `SkeletonGroup`** — inert `surfaceSunken` blocks in the shape of the content that's
  coming, replacing a spinner on a blank screen. ⚠ The **group** breathes, never the blocks: one shared
  opacity pulse so the screen is never a field of animating rectangles (§8). Neutral, never amber, and
  Reduce Motion holds it static.
- **`EdgeFade`** + **`useScrollEdgeFades`** — content dissolves into the surface behind it at a
  clipped scroll edge instead of hard-cutting under the header (the iOS-26 scroll-edge read). ⚠ Always
  the pair: the hook decides whether an edge is *genuinely* overflowing, and a fade shown over a short
  screen dissolves real content at rest, which reads as a rendering bug. `on="raised"` for a list that
  scrolls INSIDE a card (the itinerary) — a fade must dissolve into the paper actually behind it.
  `underHeader` for a SCREEN's top edge: where the nav bar floats (iOS 26 — `src/ui/screenInsets.ts`)
  the strip spans the bar plus a tail past it, so the dissolve happens ACROSS the nav bar and finishes
  below it. ⚠ That strip is **static — never gated on a scroll position**, and that is the whole
  design: paper over paper is invisible at rest and dissolves whatever passes under it, so it cannot
  be wrong about where the scroll is. Gating it on scroll state is what made it fail under
  auto-scroll, over-scroll and keyboard resize. ⚠ Do NOT reach for `headerBlurEffect` or
  `scrollEdgeEffects` instead — both were tried on device and rejected; `screenInsets.ts` records why.
- **`useScreenPadding`** (`src/ui/screenInsets.ts`) — what the chrome costs the content, at BOTH edges,
  for all three shells. ⚠ Do not re-derive either inset in a shell: the home-indicator rule was already
  written out three times before the floating bar threatened to make a fourth copy of the top one.
- **`useThemedActionSheet`** — the app's ONE native action sheet: the region picker ("Roads I know")
  and the drive ⋯ menu. Callers pass only what differs (title, options, which index is destructive);
  the theme is applied once here. ⚠ Do NOT hand-build a Modal sheet for a short list of choices, and
  do NOT use `Alert` for one — it caps at **three buttons on Android** (RN docs), which silently
  dropped actions from a 5-item ⋯ menu, and it announces rather than offers. The library delegates to
  the real `ActionSheetIOS` on iOS (UIKit draws it, so only `userInterfaceStyle` applies) and draws a
  scrollable sheet on Android, so an option list may be any length.
- **`Sunburst`** — the WPA travel-poster watermark behind the home and `/sample` mastheads. Tapered
  rays built from border-triangle Views (no SVG dep), decorative, pointer-events off. Ornament —
  §2.1 keeps it off driving surfaces.
- **`AttributionButton`** — the quiet ⓘ that reveals **this clip's** sources; wraps `SourceCredit` in a
  sheet. Not decoration: naming the specific work + linking the deed is what CC BY-SA requires wherever
  the adapted work is presented, so a Settings-level catalog cannot stand in for it. Renders nothing
  when a clip has no attribution (scenic/break ground on no source text, so an empty ⓘ would lie).
- **`RouteTrack`** — the signature motif: a dashed trail with the **car token**
  gliding along it. Driven by an `Animated.Value` in `[0,1]` (JS-driven — keep it
  the only thing animating per frame).
- **`StopRow`** — ONE line, three glance-states, two marks: a LEADING glyph + a TRAILING `meta`
  (the clip's length, prefixed by the stop type only when it isn't a story). `upcoming` (calm
  glyph + name + length), `active` (a **pine** tick in the left margin + accent glyph + bold name +
  `NOW` — never amber, and never a filled row: a highlight BOX inside the raised route card read as
  two nested selections), `passed` (the check replaces the glyph; name dimmed). Composed by `StopList`.
- **`StopList`** — the route itinerary: one card of `StopRow`s, hairline-ruled, shared by
  drive detail (`app/drives/[id]`) and the player. A `scroll` mode makes it a fixed shell
  (rows scroll inside, the player) vs content-sized (the host page scrolls, drive detail).
  ⚠ In `scroll` mode it also FOLLOWS the drive itself (`followRow`) — the caller says which row, not
  how. The player used to hold a ref and scroll this list from outside, which split one behaviour in
  two: the screen moved the list, the list measured it, and a programmatic scroll delivers no
  `onScroll` — so its edge fades froze at the last drag and lied for the rest of the drive. The
  browsing suppression (don't yank the list out from under a rider reading ahead) travels with it.
- **`NowCard`** — the now-playing placard. Holds a kicker + title (+ optional mono timer/badge), a
  state-dependent middle, and the transport. It **takes** the amber glow when it's lit, but it is one
  of five surfaces that can (§4's `glow` row) — §8's rule is one glowing amber **at a time**, not one
  glowing amber component. When a clip is playing, the others dim themselves for it.
- **`TransportBar`** — the player transport: a glow-less center play/pause flanked by ±15
  jogs, plus a `single`-CTA mode (ready/done) with an optional ghost secondary.
- **`Scrubber`** — the in-clip position bar (sunken bed, pine fill, amber car-token thumb).
- **`FilterChip`** — the home region chip (rendered only if a second region ever ships), and the
  pill `ExampleAsks` builds on. **`HeaderIconButton`** — the self-drawn circular nav-bar chip
  (strips the iOS-26 Liquid Glass capsule).
- **`Input`** — themed field, ≥48pt, pine focus ring.
- **`ThemeModePicker`** — Auto / Day / Dusk segmented control (lives on Settings).
- **`StateView`** — the shared loading / error / empty centered state (`loading`,
  `tone`, `action`, `title`). Kills the repeated `<Screen center>…` boilerplate.
- **`AccountGate`** — the shared freemium wall (drive detail + player). A "smart" composite:
  unlike the pure primitives it knows the sign-in route + gate copy.
- **`LocationGate`** — the same idea for GPS permission: it owns the three-state message/action pick
  (still-askable → in-app re-prompt; denied *or* approximate-only → Settings), so the two calling
  screens can't drift.
- **`LocationPrime`** — the one-shot pre-permission explainer shown right before iOS's single-shot
  prompt. ⚠ **Never add a "Not Now"** — App Store 5.1.1(iv) forbids a dismiss on a pre-prompt; its only
  action leads into the system prompt.
- **`VersionGate`** — mounted once above the navigator: blocks below `minimum`, nudges (dismissibly,
  per version) below `recommended`, and **fails open** on any error. ⚠ The one surface written in plain
  English, not the persona — a forced update is a utility moment.
- **`SimModePicker`** — Real GPS ⇄ Simulated, on the admin-only Developer screen.

**Planner (1.1).** Presentation only — none of these fetch, spend, or hold the transcript; `app/index.tsx`
does. That split is what keeps a non-refundable credit out of a view component.

- **`ConversationScreen`** — the planner's shell: a scroll region with a pinned, keyboard-aware footer
  and an auto-scroll state machine. Deliberately **not** a flag on `Screen` (thirteen call sites want
  none of it), but it shares the same `useScrollEdgeFades`/`EdgeFade` pair and the same
  `useScreenPadding`. ⚠ Must render inside a Stack screen — `useHeaderHeight()` throws without a header
  context. ⚠ Its `keyboardVerticalOffset` is a function of where the shell STARTS, so it is 0 under a
  floating bar and the header height under an opaque one — the wrong one floats the composer clear of
  the keys, and no typecheck can see it.
- **`TurnBubble`** — one turn. The asymmetry carries the speaker: skipper = full-width prose behind a
  2pt pine rule (no card — he *is* the page); rider = right-aligned, pressed into `surfaceSunken`.
  ⚠ It renders what it's handed and never buffers; the streaming say-buffer is `src/lib/say-buffer.ts`.
- **`TypingDots`** — the "he's about to speak" beat. ONE shared opacity breath, not three staggered
  dots (§8: one moving thing). `inkFaint`, never amber. ⚠ Its a11y label is static and its live region
  is off — a pulsing node inside an open region buries the announce the settled turn makes.
- **`Composer`** — the growing multiline field + one enamel send disc. ⚠ No `maxLength` (the turn caps
  live in `apps/api/src/limits.ts` and come back in persona) and Return does **not** send — on a
  multiline field that costs the rider their paragraph.
- **`ExampleAsks`** — the tappable opening asks under the cold open. They're `FilterChip`s typed to
  `body`, not `label`: an ask is a whole sentence, and small-caps shouts it. Actions, never a selector —
  `active` is never passed.
- **`PreviewCard`** — the route as DRAWN, inline in the transcript, one tap from a spent credit. Its
  `state` union carries the whole wall, including `needsAccount` — a state of the *card*, never
  `<AccountGate>`, which is a whole `<Screen>` and would unmount home along with the only copy of the
  transcript. ⚠ Only the newest card renders its `DriveMap` (each is a real native `MapView`).
- **`PlannerUnavailableCard`** — offline or outage, replacing the composer rather than greying it out.
  It exists to still say something **true** (the region's curated anchor names) instead of only
  apologising. ⚠ `outage` is a transport failure only — the server answers 200 in persona, so never
  build a heuristic on what `say` contains.
- **`ClipBar`** — the pinned preview-clip transport in the footer slot, so a clip that scrolls away
  can still be stopped (roam paid for that lesson). Deliberately **flat** — no glow: the proposal CTA
  already spends the screen's amber.

**Map.** ⚠ `DriveMap`, `SourceCredit` and `mapChrome` are deliberately **not** barrel-exported from
`src/ui/index.ts` — deep-import them. They're compositions with real native/licence weight, not
primitives to reach for.

- **`DriveMap`** — the tinted Google basemap plus our overlay: route line, stop markers, and the puck,
  which rides the route at the same 0..1 `progress` the car token uses (so live GPS, sim and the couch
  preview all drive it identically, and it's always on the road). Without a Maps key iOS falls back to
  untinted Apple Maps — List mode stays the offline + accessibility-complete equivalent.
- **`mapChrome`** — the shared map chrome: base `MapView` props, puck styles, the recenter chip, and
  `toLatLng`. ⚠ That converter is why this file exists rather than a second copy: the wire is GeoJSON
  `[lng, lat]`, RN-maps wants `{latitude, longitude}`, and swapping them draws in the Indian Ocean
  and throws nothing.
- **`SourceCredit`** — the "work · license" rows inside the ⓘ sheet. Mounted only by
  `AttributionButton`; named so it can't be confused with the `Attribution` wire type.

## 7. Voice in the UI (`src/ui/voice.ts`)

Microcopy is brand-critical and **centralized** — every empty/error/loading/CTA
string speaks as the skipper. Keep it warm, corny, and short (glanceable).

⚠ Cited **by key**, never quoted loose: four of the six examples that used to sit here were strings
the app had already stopped shipping, and a doc that quotes copy verbatim rots on the next copy edit.
Read the key; the file is the text.

- `voice.loading.drives` — _"Charting the good roads…"_ (and `.drive`, _"Pulling the logbook…"_)
- `voice.empty.drive` — _"This drive took a wrong turn. Head back and pick another."_
- `voice.error.generic` — _"Well, that’s a kink in the hose. Give her another pull?"_
- `voice.cta.play` — _"Let’s roll."_ Short **because** the center CTA is flanked by the ±15s jogs.
- `voice.gate.body` — _"The full drive needs a (free) ticket — ten seconds, and the skipper never
  stops talking."_
- `voice.driveComplete` — _"That’s the end of the road, folks. Watch your step climbing out."_

**Invariant:** voice is _delivery_, never _facts_ (mirrors the studio pipeline's "persona lives in
DELIVERY" rule). Concretely: nothing volatile or per-place is authored here — a poi name, hours, a
rating, a count, a duration. A string that VARIES by region templates from the API instead
(`voice.plan.example*` fill `{a}`/`{b}` from `region.exampleAnchors`, so a chip can never name a road
the skipper doesn't run).

⚠ **The rule is not "no place name ever" — it's never author a fact the API owns.** The carve-out
that used to illustrate it (`/sample`'s "POSTCARD FROM LAKE TAHOE", founder 2026-08-03) named a
region on purpose, because that screen was about ONE fixed curated clip with nothing to template
from. It is no longer an example of anything: **`voice.sample` and the `/sample` screen were both
deleted 2026-08-05**, so today every string in `voice` is region-free and the carve-out has no live
instance. Kept as a note rather than dropped because the *reasoning* is what to reach for when the
next fixed-content screen appears — the test is whether there is a fact the API owns, not whether a
place name appears.

The counter-case still stands and is the one to copy: `voice.offline.saveHint` sits on a drive-detail
button whose `DriveManifest` carries no region, so naming one would be wrong for every drive outside
it. ⚠ It no longer speaks "about the ROAD" — that described the retired *"Signal's thin out there —
best saved now"*. It now speaks about the **CONTROL** ("Start opens up once every stop is down."),
which is region-free for a stronger reason than the old line was: it describes this app's own
behaviour, which is true everywhere, rather than a claim about coverage that was only true in some
places.

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
  drive lists, Legal) stay **uncapped** — full iOS Dynamic Type incl. the accessibility
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
- **Splash/app icon.** ✅ Shipped: the **switchback S** — a drawn S whose dashed centre line
  makes it a road, pine on paper by day and parchment on night at dusk, with a decorative amber
  dot at the head. Text-free. It replaced the "M1 compass porthole" (a play triangle over a
  compass dial), which stacked four ideas and whose ring went sub-pixel below ~120pt. Two
  choices here are load-bearing and were measured, not eyeballed:
  - **Paper is the ground on purpose.** The outdoors/travel category is uniformly a saturated
    field with a mountain on it; paper is what makes the icon findable in that grid.
  - **Amber is decorative and must stay that way.** iOS derives the tinted/clear appearances by
    LUMINANCE, so amber (2.63:1 on pine, 2.47:1 on paper — both under the 3:1 non-text bar)
    collapses there. The mark reads without it.

  Six assets, SVG sources + `build.sh` in `assets/brand/`, wired in `app.json`. ⚠ The splash
  needs **two** assets: one image renders over paper in light and night in dark, and a bare
  letterform can't serve both (pine on night is 2.10:1), so splash `dark.image` points at
  `splash-icon-dark.png` — don't collapse them back to one file. (The enamel travel badge stays
  the separate in-app home-hero mark, not the launcher.)

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
- **`bun test`** (`src/theme/theme.test.ts`) — four gates, in both themes:
  1. every text role clears **4.5:1** on `surface` + `surfaceRaised` (the §4 guarantee);
  2. the **safe sunken set** (`ink`/`inkDim`/`accent`) on `surfaceSunken` — the other roles
     measurably dip there in daylight (§4), so the test's job is to stop that set growing quietly;
  3. each paired **fill + on-fill** combo, including every `filled` Badge tone;
  4. (2026-08-03) a **non-text 3:1 separability gate for marks on the BASEMAP** —
     `routeTrail`/`trackActive`/`amberToken` against land/water/roadMajor/roadMinor/park, plus `routeTrail`
     *unaided* on the roads (the one case a casing can't fix: the ring would trace the same road).
     This is the executable form of the `routeTrail` bug in §4 — nothing asked whether a brand
     colour collided with a map layer we style from the same palette, and all three instances were
     caught by eye instead. ⚠ The rule is a **disjunction** — a mark passes if its own colour OR its
     `surface` ring clears the layer; demanding both failed six honest pairs and is a *wrong* rule,
     not a stricter one. ⚠ And **3:1, not 4.5**: these are graphical objects (WCAG 1.4.11), so
     raising it would fail honest marks and teach the next person to baseline it away.
     ⚠ `amberToken` is knowingly EXCLUDED (it's ~2.5 on the day basemap, TODO.md) because the fix
     means changing the live drive's puck, frozen until the first real drive. It does not pass.
     A fifth assertion holds the whole thing up: **basemap land is exactly `surface`** — which is
     why a mark's ring can vanish on land and needn't be there. Retint land and that stops being
     true, loudly, in the test rather than on a device.
- **`bun run check`** (in `apps/mobile`) runs lint:tokens + **lint** + typecheck + test. ⚠ `lint` is
  ESLint, and it is the ONLY tool that reads the hooks — they import native modules `bun test` can't
  load, so a green test run says nothing about them. Run `check` in this workspace whenever you touch
  the design system; the root `check` does not carry lint:tokens or lint.
