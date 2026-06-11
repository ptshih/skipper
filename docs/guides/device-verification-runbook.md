# On-device verification runbook — M1 phone player

> **Status:** guide (written 2026-06-10) — the one-sitting EAS dev-build pass that clears the last
> M1 gate: the phone-player *feel* + real GPS, neither of which `bun run check` can judge. Step
> list is code-anchored to `apps/mobile` as of 2026-06-10 — re-verify anchors against the current
> tree before trusting a line number. Pairs with `docs/guides/eas-setup.md` (how to build/install
> the dev build) and `docs/specs/gps-player-spec.md` §6–§7 (the engineering accept bar this reports
> against).

## Why this exists

Everything the design-review follow-through shipped is verified statically — `bun run check`
(token-lint + `tsc` + `bun test`, 45 tests) is green. What it **cannot** judge is the load-bearing
runtime behaviour: animation timing and the one-amber glow budget, rounded-corner clipping of a
scrolling child, the cream-on-cream "now" well's real contrast outdoors, cross-app music ducking,
lock-screen Now Playing, the native splash/icon, and real GPS triggering *in motion*. This is the
human pass those need. **One physical iPhone, one dev build, ~one sitting.** The same session that
does the real-GPS test (Phase 4) is also where the audio duck-flip (Phase 0) gets verified — they
share the build, so do them together.

## How to use this

- Work top-to-bottom. Sections are ordered the way a tester actually hits them: build → launch →
  the static screens → the player → the climax → audio → outdoor GPS → offline.
- Each check is a `- [ ]` with **Do / Expect / Watch-for** and a code anchor. Tick it or note the
  failure mode you saw.
- **§0** (build) and **§6** (the duck flip) carry a *prerequisite* — do the prereq before the checks
  it gates.
- Report pass/fail against the per-phase **Accept** bar in `docs/specs/gps-player-spec.md` §7.

---

## Before you start — prerequisites + the one code change owed

### Build prerequisites
- **Signing.** Apple Developer membership; the iPhone's UDID registered. The native project signs
  automatically — team `L24UJYJ5DK` (Manoa, Inc.), bundle `fm.skipper.app` (`apps/mobile/app.json`).
  Requires your Apple ID to be a member of the Manoa, Inc. team with `fm.skipper.app` registered as
  an App ID there (the personal team `AYA5T52A22` whose dev cert is in the keychain can NOT sign it). First
  launch of a dev-cert build: trust the profile in iOS Settings → General → VPN & Device Management.
- **Simplest — target the production API (`https://api.skipper.fm`).** The Cloud Run API is live and
  serves the same tours (it reads the same Neon DB), so bake `EXPO_PUBLIC_API_URL=https://api.skipper.fm`
  and skip the local-API + Tailscale + ATS dance below entirely. It's HTTPS, so **no ATS exception is
  needed** (the `ts.net` caveat is moot), and a **standalone Release build then needs nothing local for
  the in-car drive** — no Mac, no Metro, no tailnet, the phone is self-sufficient against production.
  (A *dev* build still needs Metro on the Mac for the JS bundle during the static-screen checks; only
  the API moves to prod.) The local-Mac path below is the alternative when you're iterating on the API
  itself. (api.skipper.fm verified live + serving the tours 2026-06-10.)
- **(Local-API alternative) Mac runs the API *and* (for a dev build) Metro at once:**
  - repo root: `bun run dev` → API on `:8787`
  - `apps/mobile`: `bun start` → Metro
- **Bake a phone-reachable API URL** (local-API path). `EXPO_PUBLIC_API_URL` is an `EXPO_PUBLIC_*` var
  — inlined into the JS bundle at *build* time, not read at runtime. The fallback is
  `http://localhost:8787`, which a physical phone can't reach (`apps/mobile/src/lib/auth.ts:8`). Set it
  when you build, e.g. `EXPO_PUBLIC_API_URL=http://hayrik.tail97e2d7.ts.net:8787` over Tailscale, or
  `http://<Mac-LAN-IP>:8787` on the same Wi-Fi. Phone and Mac must share that network (the same
  tailnet if using the `ts.net` host).
- **Release-build cleartext caveat** (local-API path only — moot on `https://api.skipper.fm`). A
  standalone *Release* build embeds the JS and enforces iOS App Transport Security. The committed ATS
  exception covers **only `*.ts.net`** (`app.json:16-23`) — so a LAN-IP API URL works in a *Debug/dev*
  build (ATS relaxed) but is **blocked in Release**. For a Release smoke test against the local API use
  the Tailscale `ts.net` host; otherwise stay on a dev build, or just use the production API above.
- **Fastest path** (avoids EAS project resolution entirely, per the local-build memory): from
  `apps/mobile`, `EXPO_PUBLIC_API_URL=… bunx expo run:ios --device <udid>` (a.k.a. `bun run ios`).
  Signing auto-resolves from the keychain dev cert. The EAS *cloud* path is in
  `docs/guides/eas-setup.md` (note its projectId is stale — see Known gaps).

### The code change owed BEFORE §6 (audio)
- [ ] **Flip the interruption mode.** Change `DRIVE_INTERRUPTION_MODE` from `'doNotMix'` to
  `'duckOthers'` at `apps/mobile/src/lib/useDrive.ts:67`. JS-only, hot-reloadable, **no native
  rebuild.** Do it *in this session* so you can immediately verify the risk below. Until flipped, the
  rider's external music **pauses** under narration instead of ducking — that's expected current
  behaviour, not a bug.
- ⚠️ **This is not a guaranteed-safe one-liner.** expo-audio's own types warn that
  `setActiveForLockScreen` "must be set to `doNotMix`"
  (`apps/mobile/node_modules/expo-audio/build/Audio.types.d.ts:572`), and the player *does* call
  `player.setActiveForLockScreen(true, …)` (`useDrive.ts:721`). So `'duckOthers'` and the skipper's
  lock-screen Now Playing card may conflict. §6 tests exactly this. **If they don't coexist, report
  it — don't force the flip.**

### Two open native risks to decide before/at build
- **No background-audio mode.** `app.json` declares no `ios.UIBackgroundModes:['audio']`
  (`app.json:11`). So locked-screen / backgrounded audio during a *live* drive is **unverified** —
  keep-awake holds the screen on, but a *manual* lock may suspend audio. Adding the mode is a native
  change (needs a rebuild). If you want to test locked-screen audio (§7), decide whether to add it
  before you build.
- **Background GPS is intentionally OFF** (`isIosBackgroundLocationEnabled:false`, foreground
  When-In-Use only, `app.json:49`). Don't expect background location — the design is a foreground
  watch held alive by keep-awake.

---

## §0 — Build, install, reach the API

- [ ] **Signed build installs & launches.** Do: build & install via `expo run:ios --device <udid>`
  (or the EAS dev-build). Expect: the Skipper icon appears, launches past the splash to the home
  tour list; bundle `fm.skipper.app`. Watch-for: signing failure (no membership / UDID not
  registered); iOS blocking launch until the dev profile is trusted. (`app.json:11-13,71-78`)
- [ ] **API is reachable (the #1 setup failure).** Do: with the Mac API (+ Metro) running, open the
  home screen. Expect: the tour catalogue loads real drive cards within a couple seconds; opening a
  tour shows its route + stops. Watch-for: empty list or the in-voice error wall →
  `EXPO_PUBLIC_API_URL` still pointing at `localhost:8787`; **or** a Release build over a LAN-IP URL
  getting no data while Safari can reach it → the ts.net ATS exception doesn't cover a LAN IP.
  (`apps/mobile/src/lib/auth.ts:8`, `app.json:16-23`)

## §1 — Splash & app icon (native; visible only after a fresh build, never on hot-reload)

- [ ] **App icon on the home screen.** Do: after a fresh install, find the Skipper icon (home screen,
  app switcher, Settings list); also toggle Dark Mode to check the dusk variant. Expect: the M1
  "compass porthole" — a play triangle that's a window onto the park (sun, ridgeline, snow-cap),
  framed by a compass dial with an amber north, on a full-bleed pine (`#1E5B40`) field (opaque, no
  alpha); in dark mode the dusk variant (`icon-dark.png`). Watch-for: the stock black Expo void
  (build didn't pick up the icon, or you're on an old install — re-run `prebuild:ios`); a
  transparent/black corner; clipping under the rounded-rect mask. (`app.json` `ios.icon` +
  `android.adaptiveIcon`, `apps/mobile/assets/brand/icon.svg`)
- [ ] **Splash on cold launch, light *and* dark.** Do: fully quit, cold-launch; then switch the
  device to Dark Mode and cold-launch again. Expect: the centred M1 pine-disc mark (contain, ~240pt)
  on a solid field — cream `#F2E7CC` in light, deep pine `#14201B` in dark (the dark override).
  Watch-for: white/black default splash (asset not bundled / stale build); cream instead of pine in
  dark (dark override not applied); stretched or off-centre mark. (`app.json` `expo-splash-screen`)

## §2 — Tour detail: trailhead placard, summary, place names, offline chip

- [ ] **Trailhead placard composition.** Do: tap a drive from home; the placard is the first card.
  Expect: a carved ranger-sign card — faint inner keyline ~5pt in, two ~4pt screw-dots (TL/BR),
  amber-warm UPPERCASE region kicker, a heavy **Alfa Slab** display headline, faint small-caps
  `Start → End` anchors, a short dashed trail with the amber rig **parked at ~6% (no glow)**, a
  dashed rule, then a mono `N STOPS · ~M MIN` permit line. Reads comfortably in dark mode (dark-first).
  Watch-for: the rig showing an amber halo (only the Start CTA owns this screen's one glow) or the
  rig animating (it's static); the headline falling back to plain bold (Alfa Slab not loaded); the
  dashed trail rendering solid on iOS. (`apps/mobile/app/tours/[id]/index.tsx:213-245`)
- [ ] **Headline + summary wrap, never truncate.** Do: open a tour with a long name (or bump
  Dynamic Type larger). Expect: the slab headline grows onto 2–3 lines fully visible; the `tour.summary`
  paragraph (inkDim body, Bitter) sits just below the placard and wraps in full — no `…` anywhere,
  nothing cut at the gutter. Watch-for: an ellipsis (a stray `numberOfLines`); summary missing on a
  tour that should have one (DTO/regen gap); text colliding with the screw-dots at large type.
  (`apps/mobile/app/tours/[id]/index.tsx:217-222,248-252`)
- [ ] **Place names are cleaned.** Do: read the `THE ROUTE · N STOPS` itinerary and the home teaser.
  Expect: no name ends in `, California` / `, Nevada` — names read as spoken ("Emerald Bay", "Tahoe
  Keys"). Watch-for: a state suffix slipping through. Note: `cleanPlaceName` strips **only** the
  `, <US State>` suffix — *not* `(disambiguation)` (those are filtered at generation, never a stop);
  and a StopRow truncates to one line, so a legit long name ending in `…` on the row is **expected**,
  not un-cleaned cruft. (`apps/mobile/src/lib/labels.ts:29-32`)
- [ ] **Offline permit chip.** Do: signed in, open the header `⋯` → "Download for offline"; watch the
  placard's permit row. Expect: a faint `Saving k/total` label beside the mono permit line, then a
  `Saved offline` chip with a vector "downloaded" icon; the `⋯` item flips to a destructive "Remove
  offline download". Watch-for: the chip colliding with the `N STOPS · ~M MIN` text on a narrow
  device; tofu icon (must be vector, not emoji); the row not wrapping at large text.
  (`apps/mobile/app/tours/[id]/index.tsx:227-244,300-307`)

## §3 — The gate: anonymous vs signed-in (the honest sample ride)

Preview is the open funnel; the wall is the **live drive + offline download** for an anonymous user.

- [ ] **Every tour previews with no account.** Do: signed out, open any tour → tap "Take the
  simulated drive". Expect: detail renders fully (placard + summary + itinerary) anonymously; the
  preview player opens and autostarts; header "Preview drive". **No gate, ever, on this path.**
  Watch-for: a 401 gate appearing on detail or preview (preview must never 401).
  (`apps/mobile/app/tours/[id]/index.tsx:120-121`, `play.tsx:45-47`)
- [ ] **Live-drive gate keeps its promise.** Do: signed out, tap the primary "Start the drive"
  (`?mode=live`); the fetch 401s → AccountGate. Read it, then tap the ghost "Just take the sample
  ride". Expect: gate titled "Grab your ticket", FREE badge, note "This is the live, on-the-road
  drive.", primary "Get my free ticket", ghost "Just take the sample ride" — and the ghost **routes
  into the open couch preview** (`?mode=preview`), no bounce back. Watch-for: the ghost being a
  no-op `back()` (the exact regression `6ee056c` fixed); gate body + note both saying "needs a free
  ticket" (stutter). (`apps/mobile/app/tours/[id]/play.tsx:150-163`, `src/ui/AccountGate.tsx:43-47`)
- [ ] **Download gate "Keep browsing" restores the tour.** Do: signed out, `⋯` → "Download for
  offline"; the 401 swaps detail for the AccountGate. Tap the ghost "Keep browsing". Expect: it
  returns to the fully-rendered tour-detail **in place** (`setNeedsAccount(false)`) — it does NOT pop
  to home. Watch-for: wrong ghost label, or it popping the stack to the drives list.
  (`apps/mobile/app/tours/[id]/index.tsx:51-67,150-157`)
- [ ] **Signed-in user never sees the gate.** Do: sign in (free account), tap "Start the drive" and
  separately `⋯` → "Download for offline". Expect: live drive opens (a *location* permission gate may
  appear — that's GPS, §7, not the account gate); download shows the saving→saved chip; no
  AccountGate. Watch-for: a signed-in user still hitting "Grab your ticket" (session cookie not sent);
  or staying stuck on the gate after signing in from it (the play-screen session-retry should drop
  them into the drive). (`apps/api/src/tiers.ts:25-27`, `apps/api/src/index.ts:128-137`)

## §4 — The route card (shared StopList): static on detail, fixed-shell on the player

Same component (`apps/mobile/src/ui/StopList.tsx`) in two modes.

- [ ] **Detail = one card, page scrolls.** Do: on tour detail, scroll to `THE ROUTE · N STOPS`.
  Expect: a single raised card of hairline-ruled rows (glyph + name + faded type sublabel); rules are
  **inset**, not full-bleed; the card has no internal scrollbar — the *page* scrolls and the card
  grows to fit; no row highlighted (all "upcoming"). Watch-for: rows as separate floating cards; the
  card scrolling internally; a row looking active/checked on the static screen.
  (`apps/mobile/app/tours/[id]/index.tsx:283`, `src/ui/StopList.tsx:105`)
- [ ] **Player = fixed shell, rows scroll inside.** Do: open the player (Preview, or dev `⋯` → "Sim
  drive"); drag up/down inside the route card between the trail (top) and the player dock (bottom).
  Expect: the card's outer rounded rect (all four corners) stays anchored and fills the gap; only the
  rows slide inside it. Watch-for: the whole card scrolling with the page; the card collapsing to
  content height and leaving a gap (flex:1 not applied); rows not scrolling at all (clipped out of
  reach). (`apps/mobile/app/tours/[id]/play.tsx:351,499`)
- [ ] **Rows clip to the rounded corners.** Do: slowly drag so a row is half-in/half-out at the top
  and bottom edges. Expect: the partial row is cut along the card's corner radius — the cream edge
  stays a clean rounded rect, nothing spills past the corners. Watch-for: content leaking over square
  corners (`overflow:hidden` not honoured on iOS for the rounded card); a sunken-well background
  painting past the edge. (`apps/mobile/src/ui/StopList.tsx:117`, `src/ui/Card.tsx:23`)
- [ ] **Active "now" row reads as a sunken well.** Do: play a preview/sim drive; find the current
  stop's row. Expect: a subtly **darker, inset** well (sits *below* the card surface), pine/accent
  glyph (never amber), bold name; passed rows dimmed with a quiet check; only one active at a time.
  Watch-for (the real risk): surfaceSunken-vs-raised contrast too low on the bright cream theme
  outdoors; the row looking *raised* (a chip) instead of sunken; a black-hole well in dark/night
  mode; the highlight lagging the audio by seconds. (`apps/mobile/src/ui/StopRow.tsx:73-79`)
- [ ] **No white scroll indicator.** Do: flick the player itinerary. Expect: no vertical scrollbar on
  the cream card; the only "more below" cue is rows clipping at the rounded edge. Watch-for: a stark
  white bar flashing on the right. (`apps/mobile/src/ui/StopList.tsx:96-98`)
- [ ] **★ P1 — itinerary stays browsable WHILE a clip plays.** Do: start a sim drive (8× so stops
  fire fast); while a clip is narrating, drag down to later stops and **hold** your view for 5+
  seconds, including across a stop transition. Expect: smooth drag; the list stays where you put it,
  does **not** snap back to the active row on every audio tick, and does **not** get yanked away the
  instant you lift off — a ~5s touch-grace holds it even if a new stop fires; only after that, on the
  *next* transition, does auto-scroll quietly re-centre (focused row near the top). Watch-for: the
  list snapping back every ~0.5s (the pre-fix regression — stops array rebuilt each tick); a jump the
  instant you release; auto-scroll never resuming (grace timer stuck).
  (`apps/mobile/app/tours/[id]/play.tsx:101,113,128`)
- [ ] **Rows tappable only in preview.** Do: in *preview*, note the faded hint line above the list
  and tap a row; then in a *sim/live* drive, try tapping a row. Expect: preview rows jump the drive
  to that stop (brief pressed dim); drive rows are read-only — no hint line, no pressed feedback,
  nothing happens. Watch-for: a real/sim row tap jumping the clock; preview taps doing nothing.
  (`apps/mobile/app/tours/[id]/play.tsx:346,358`, `src/ui/StopRow.tsx:64-65`)

## §5 — The drive-complete moment (reach it via the 8× sim)

There is **no** dedicated drive-complete component — the moment is composed inline in `play.tsx`
(done-branch card + a progress-to-1 effect) plus the StopList/StopRow stamp path.

- [ ] **Reach completion.** Do: open a tour → in the pre-drive "READY TO ROLL" card pick **"8×
  faster"** (`play.tsx:404`), tap "Let's roll", let it run ~2 min uninterrupted to the end. Do **not**
  tap "Pull over" (that resets, doesn't complete). Expect: after the last stop (+ the "One for the
  road" outro), the card flips to kicker "DRIVE COMPLETE", title "You've arrived", body "That's the
  end of the road, folks. Watch your step climbing out." Watch-for: the drive hanging on the last
  clip; the outro double-playing or skipping; the run stalling if the screen locks mid-sim.
  (`apps/mobile/app/tours/[id]/play.tsx:45,404`, `src/lib/useDrive.ts:437`)
- [ ] **Rig pulls into the driveway.** Do: watch the dashed RouteTrack as phase flips to `done`.
  Expect: the amber car token **glides** smoothly to the far-right end over ~0.4s (a single eased
  timing) — like rolling the last few feet to a stop, not a jump; the token's halo turns **off** in
  the done state. Watch-for: the token snapping instantly (timing didn't run, or Reduce Motion is
  on); stopping short / overshooting; jank. (`apps/mobile/app/tours/[id]/play.tsx:134`,
  `src/ui/RouteTrack.tsx:23`)
- [ ] **Stamp cascade down the itinerary.** Do: scroll the list to the top first, then watch at
  completion. Expect: each passed row's check (checkmark-circle, inkFaint) pops in top-to-bottom,
  staggered ~80ms apart, each with a small scale-up + rotate settle (a postmark stamp) — checkmarks
  rubber-stamped down the list, not all at once. Watch-for: all checks appearing simultaneously
  (stagger not applied); no animation; the cascade re-firing on every tick.
  (`apps/mobile/app/tours/[id]/play.tsx:359`, `src/ui/StopRow.tsx:48`)
- [ ] **The done card owns the single glow.** Do: compare the done card against the token and the
  transport buttons. Expect: the done card has an amber keyline + soft amber halo and is the **only**
  amber-glowing element (token halo off, Restart CTA glow-less). Watch-for: a flat/dead card (no
  glow), or a *second* glow somewhere (the two-glow regression this fixed); the halo washing out in
  light vs dark. (`apps/mobile/app/tours/[id]/play.tsx:226,277`, `src/ui/NowCard.tsx:50`)
- [ ] **Copy + exits.** Do: read the card; tap "Run it again, skipper" (replays); re-complete, tap
  "Back to the trailhead". Expect: a mono tally reads **`{N} STOPS` — a STATIC stamped count, NOT an
  animated odometer**; Restart replays from the top; "Back to the trailhead" calls `goBack()` with
  **no** "Pull over?" confirm (that guard fires only while `driving`). Watch-for: a tester expecting
  an odometer roll and filing the static count as a bug; the confirm alert wrongly firing at done.
  (`apps/mobile/app/tours/[id]/play.tsx:227,269`)
- [ ] **Reduce Motion fallback.** Do: iOS Settings → Accessibility → Motion → Reduce Motion ON; complete
  a drive again. Expect: the rig jumps straight to 100% (no glide), the stamp cascade is replaced by
  the static end state (checks simply present), card copy/glow unchanged — still looks *finished*,
  just no flourishes. Watch-for: animations still playing; or the checks NOT appearing at all (end
  state not rendered, leaving passed rows uncheck'd). (`apps/mobile/app/tours/[id]/play.tsx:136,359`)

## §6 — Audio duck-flip (do the §"code change owed" prereq first)

Only meaningful **after** flipping `useDrive.ts:67` to `'duckOthers'`. This concerns the **rider's
external** music (Spotify/Apple Music). The app's *own* bundled road-trip music already ducks via a
separate engine (`driveMusic.ts` / `useAudioPlaylist`) — don't conflate them. Use a real device with
a real music app; the simulator can't run cross-app ducking.

- [ ] **Music ducks, not stops.** Do: start Spotify/Apple Music playing; return to Skipper, start a
  sim/preview drive, let a clip begin. Expect: the background music audibly **drops to a low volume
  but keeps playing** under the skipper, then **swells back** to full when the clip ends. Watch-for:
  music fully **pausing** (the flip didn't take, or it's still `doNotMix`); ducked but never
  returning (stuck ducked); no ducking at all (`mixWithOthers` got set instead); the skipper clip
  itself going silent. (`apps/mobile/src/lib/useDrive.ts:67,276`)
- [ ] **★ Lock-screen Now Playing SURVIVES the duck (the documented risk).** Do: with a clip playing
  and music ducked, lock the phone / open Control Center; check the Now Playing widget and try
  play/pause + scrub. Expect: the widget shows the **skipper** clip — title = stop name, artist =
  host name, album = tour name — and the transport controls it. **This must still hold after the flip
  to `'duckOthers'`.** Watch-for: the skipper Now Playing card disappearing or being replaced by the
  music app (the exact `setActiveForLockScreen` "must be doNotMix" conflict); dead transport
  controls; two sources flickering. **If they don't coexist, the flip needs another approach — report
  it.** (`apps/mobile/src/lib/useDrive.ts:721`, `node_modules/expo-audio/build/Audio.types.d.ts:572`)
- [ ] **Background playback while ducked.** Do: start a drive with music playing, lock the phone
  mid-clip, keep listening, let it advance to the next stop while locked. Expect: the skipper clip
  plays to completion through speaker/Bluetooth, music ducked under it and restored after, and the
  next clip fires while backgrounded. Watch-for: skipper audio cutting out on lock (background focus
  lost under `duckOthers`); the music *un*-ducking the instant the app backgrounds. (See §7's
  background-audio caveat — no `UIBackgroundModes:['audio']` is declared.)
  (`apps/mobile/src/lib/useDrive.ts:277-278`)
- [ ] **Same behaviour in live mode.** Do: re-confirm ducking + lock-screen in a real `?mode=live`
  drive (the audio session is mode-agnostic — same `setAudioModeAsync`). Expect: identical to
  sim/preview. Watch-for: any divergence between `live` and `sim` (would be surprising — worth
  reporting). (`apps/mobile/app/tours/[id]/play.tsx:45`)

## §7 — Real GPS, outdoors & in motion (Phase 4 — the bike/drive test)

Foreground When-In-Use only. Mode resolves to `live` via "Start the drive" (`index.tsx:263` →
`?mode=live`). A missing/malformed `?mode` falls back to `sim` only in `__DEV__`, else `preview` —
**never `live`** — so a release build never lands a rider on the sim clock.

- [ ] **Permission prompt on first live drive.** Do: fresh permission state, tap "Start the drive",
  satisfy the account gate, tap Play. Expect: the iOS When-In-Use dialog with "Skipper uses your
  location to play each stop as you reach it on the drive." (`app.json:48`); "Allow While Using"
  (precise) drops straight into the rolling drive. Watch-for: no dialog and the drive silently never
  starting; or the drive starting with *no* prompt at all.
  (`apps/mobile/src/lib/gps.ts:148`, `useDrive.ts:531`)
- [ ] **Denied & reduced-accuracy gates (3 states — easy to under-test).** Do: (A) tap "Don't Allow"
  once; (B) deny twice for the no-reprompt path; (C) in Settings turn **off** Precise Location, leave
  "While Using", start a live drive. Expect: (A) a danger StateView with an in-app "Switch on
  location" re-prompt; (B) "Flip it on in Settings…" with an Open-Settings deep link; (C) "You've
  handed me approximate location… Switch on Precise Location" with Open Settings. After fixing in
  Settings and returning, **the gate clears automatically** (AppState re-check) without re-tapping.
  Watch-for: reduced accuracy treated as fine → the drive starts but **never triggers a stop** (every
  fix fails the 50m gate — a silent dead drive, exactly what the reduced gate prevents); staying
  stuck on the stale gate after returning from Settings.
  (`apps/mobile/src/lib/gps.ts:140`, `useDrive.ts:854`)
- [ ] **Live mode uses REAL GPS.** Do: start a live drive; observe the ready screen, then stand still
  vs move. Expect: **no** "Real time / 8× faster" toggle (that's sim-only), header reads "live drive";
  the route dot stays put while stationary and advances proportionally to real distance as you move.
  Watch-for: the 8× toggle appearing (fell back to sim); the dot advancing on a timer while still;
  header saying "simulated drive". (`apps/mobile/src/lib/useDrive.ts:523`, `play.tsx:325,404`)
- [ ] **iOS −1 sentinel is sanitized.** Do: watch the first seconds before GPS settles (cold start
  outdoors / stepping out from indoors); also crawl/stand near a stop. Expect: a "Looking for the
  satellites — hang tight." cue after ~8s of no usable fix, **not** a frozen screen or a spuriously
  fired stop; invalid speed/heading (−1) coerced to 0, and a fix with accuracy `< 0` *or* `> 50m`
  dropped. Watch-for: a stop firing the instant the drive starts while you're far away (a wild
  low-accuracy first fix slipped the gate); the heading gate permanently blocking all stops (−1
  treated as a real bearing). (`apps/mobile/src/lib/gps.ts:133,216,222`)
- [ ] **★ Triggers fire at the right points while moving (the core bet).** Do: bike/drive the real
  route at a steady pace; note where narration starts relative to each stop; ideally test an
  out-and-back leg or a stop the road passes close to but doesn't reach. Expect: narration begins a
  roughly constant **time** ahead (~12s lead = `max(stop floor, speed·12s)`), so faster = triggers
  from farther out; above ~5mph a stop fires only inside the 90° forward heading cone (a passed/
  opposite-direction stop does **not** fire); each stop fires at most once; after a clip it returns to
  ducked-quiet and **waits** for the next trigger (never auto-advances). Watch-for: narration firing
  late/on top of the stop at speed (lead not scaling); a behind/abeam stop firing (heading gate off);
  double-/re-fire on a return leg; stops never firing despite driving right past (accuracy gate too
  tight, or alongM projection broken). (`packages/drive-core/src/trigger.ts:70,99,101`)
- [ ] **Route dot tracks real position; auto-completes at the end.** Do: drive the full route incl.
  any return leg. Expect: the dot advances **monotonically forward**, never jumping back on a return
  leg; within 25m of the final vertex the outro queues and the drive finishes to the "arrived" done
  card. Watch-for: the dot snapping back to an outbound vertex (nearest-vertex instead of forward
  projection) so end-of-route is never detected; premature completion; the outro never playing.
  (`apps/mobile/src/lib/gps.ts:194,229`)
- [ ] **Keep-awake holds the screen.** Do: set Auto-Lock to 30s, start a live drive, set the phone
  down and wait past 30s; then pause and wait again. Expect: the screen never dims/locks while driving
  & unpaused (the foreground GPS watch dies on lock); on pause or done, the lock releases and normal
  auto-lock resumes. Watch-for: the screen auto-locking mid-drive (GPS stops, stops stop firing); the
  screen staying awake forever after the drive ends. (`apps/mobile/src/lib/useDrive.ts:825`)
- [ ] **★ Clean teardown — no leaked GPS watch (the #1 battery hazard).** Do: start a live drive, run
  briefly, then back out ("Pull over" / chevron → confirm). Watch the iOS status-bar **location
  arrow**. Repeat start/stop several times; also test pause/resume. Expect: the location arrow
  disappears shortly after leaving the drive — the watch is removed on unmount. Watch-for: the arrow
  staying **lit** after you've left (the documented expo `#35925/#35926` leak — `.remove()` can fail
  to stop native updates; a `stopped` guard protects the UI but the native watch still drains
  battery); repeated cycles stacking multiple watches; resume-after-pause never re-acquiring.
  (`apps/mobile/src/lib/gps.ts:211,258`, `useDrive.ts:880`)
- [ ] **GPS-acquire failure surfaces an error.** Do: after granting permission, turn **off** Location
  Services globally (or test a deep dead-zone), start a live drive. Expect: an "error" phase — "Lost
  the GPS signal, folks. Pull over and give her another go." with Retry — not a frozen ready/searching
  screen. Watch-for: a hung screen with no error; the "searching" cue spinning forever.
  (`apps/mobile/src/lib/gps.ts:248`, `useDrive.ts:483`)
- [ ] **Locked-screen / backgrounded audio during a LIVE drive (verify empirically — unverified by
  design).** Do: during a live drive, manually lock the phone or background the app; listen. Expect:
  *uncertain* — `shouldPlayInBackground:true` is set and keep-awake should prevent auto-lock, but
  **no `ios.UIBackgroundModes:['audio']` is declared** (`app.json:11`), so a manual lock may suspend
  audio. Watch-for: audio cutting out on manual lock / backgrounding, or no lock-screen Now Playing
  controls — if so that's a **missing background-audio mode** (a native add + rebuild), not a GPS
  bug. (`apps/mobile/src/lib/useDrive.ts:276`, `app.json:11`)

## §8 — Offline (Phase 3) — airplane-mode acceptance

- [ ] **Download, then drive with zero network.** Do: signed in, on tour detail `⋯` → "Download for
  offline"; wait for completion; turn on **Airplane Mode** (confirm Wi-Fi/Tailscale off); reopen the
  tour and start preview/live, and pull up the home list. Expect: the `⋯` item flipped to "Remove
  offline download"; in Airplane Mode the detail still renders (from the saved manifest) and audio
  plays from local `file://` bytes (intro/outro brackets + every stop) with no network; the home list
  still shows the downloaded drive. Watch-for: download "finishes" but playback is silent/errors
  (clips not actually on disk); files written to OS-evictable cache instead of the document dir;
  manifest storing absolute `file://` URIs (must be **relative** filenames) or presigned R2 URLs
  (~1h TTL) instead of bytes → playback dies after an hour offline; a half/failed download reading as
  ready. (`apps/mobile/src/lib/offline.ts:112-176,287-299`)

---

## Known gaps & follow-ups (decide / file after the pass)

- **Duck vs lock-screen Now Playing conflict (§6).** The riskiest assumption: `'duckOthers'` may
  break the skipper's lock-screen card (`setActiveForLockScreen` wants `doNotMix`). If §6 shows they
  don't coexist, the flip needs a different approach (e.g. revert + revisit) — capture the finding in
  `docs/specs/gps-player-spec.md` (Phase 0).
- **No `UIBackgroundModes:['audio']` (§7).** Locked-screen audio during a live drive is unverified
  and may require this native entry + a rebuild. Decide before the build if you want to test it.
- **Stale EAS projectId in the build guide.** `docs/guides/eas-setup.md` cites projectId
  `5dded9ce-af00-4c5f-957d-52644d7ab155`; the live value in `app.json` is
  `dd556bd3-5c16-430e-8b1f-cfdeb410f26d` (owner `manoa-inc`, correct in both) after the `13f6f52` EAS
  org migration. That guide's "Real device" section also predates the `ts.net` ATS fix (now in
  `app.json:16-23`). Prefer the local `expo run:ios --device` path, which sidesteps EAS project
  resolution entirely; a one-line fix to that guide's projectId is worth doing.

## Map notes for the tester / next agent (current code, not stale memory)

- The drive/preview/sim screen is **one file**: `apps/mobile/app/tours/[id]/play.tsx`, switched by
  `?mode=` (`live | preview | sim`). There is no `app/drive/[id].tsx` or `app/preview/[id].tsx`
  (older memory names them — they don't exist). Tour detail is `apps/mobile/app/tours/[id]/index.tsx`.
- No dedicated drive-complete component — composed inline in `play.tsx` + the StopList/StopRow stamp
  path. The completion tally is a **static `{N} STOPS`**, not an animated odometer. The "passport
  cascade" is the existing itinerary's checkmarks stamping in, not a separate passport screen.
- The active "now" row is a **surfaceSunken well**, not a raised chip (changed in `1f449e0`).
- A missing/malformed `?mode` falls back to `sim` only in `__DEV__`, else `preview` (never `live`).
