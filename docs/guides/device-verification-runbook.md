# On-device verification runbook — M1 phone player

> **Update (2026-07-16):** the couch **PREVIEW is CUT.** Any step that says to tap **"Take the simulated
> drive"** or open a `?mode=preview` player is OBSOLETE — that CTA and mode are gone. Auditioning is now
> the drive-detail mini-preview (List/Map toggle + tap a stop to hear one clip); the "Preview drive"
> header and tappable-rows-only-in-preview checks below no longer apply. ⚠ **Two clauses of this
> banner went stale on 2026-08-05:** the player's list is NO longer "always read-only" (a PASSED stop
> is tappable — §4), and the dev `⋯ → "Simulate the drive"` item is DELETED, not unchanged (§11 of the
> download-before-start doc). See
> [`../decisions/detail-page-mini-preview.md`](../decisions/detail-page-mini-preview.md).

> **Status:** guide (written 2026-06-10) — ⚠ **PARTLY SUPERSEDED 2026-08-05** by the
> download-before-start gate: the unsaved-drive alert, the `?mode` param and drive-audio streaming are
> all gone, and §§2–4, §6–§8 were rewritten that day against what replaced them (the banner below
> carries the deltas). ⚠ **written against the M1 player, BEFORE the conversation
> was the home screen. For a 1.1 submission pass, execute
> [1-1-submission-sweep.md](1-1-submission-sweep.md) instead**, which supersedes this file's ordering and
> adds the two desk passes that stand in for RISK-1's real drive. This one stays useful for the
> player/audio/GPS checks it pioneered, several of which the sweep cites rather than restates.
> Originally: the one-sitting EAS dev-build pass that clears the last
> M1 gate: the phone-player *feel* + real GPS, neither of which `bun run check` can judge. Step
> list is code-anchored to `apps/mobile` as of 2026-06-10 — re-verify anchors against the current
> tree before trusting a line number. Pairs with `docs/guides/eas-setup.md` (how to build/install
> the dev build) and `docs/designs/gps-player-spec.md` §6–§7 (the engineering accept bar this reports
> against).

> **Update (2026-07-30, ⚠ half of it SUPERSEDED 2026-08-05 — read the next banner):** the offline
> download is **no longer `⋯`-only.** The placard now always shows an offline state (a faint
> `Not saved` chip when it isn't downloaded — that slot used to render nothing). The **"Save for
> offline"** button that sat under the Start CTA, and the one-time *"This drive isn't saved yet"*
> alert, are both GONE — see below. The `⋯` entry itself is unchanged.

> **Update (2026-08-05) — THE DOWNLOAD IS THE GATE, and the alert is deleted.**
> ([`../designs/download-before-start.md`](../designs/download-before-start.md)). Three things change
> what a tester does:
> - **A drive's audio is only ever played from DISK.** The streaming path for a drive is gone with the
>   whole re-sign ladder (`POST /drives/:id/assets/sign`, `resignPlayback`, `signDriveAudio`, the
>   "Playing from download" chip, the `resign_failed` skip reason). Any step below that says "it
>   streams", "it re-signs", or reads the chip is checking something that no longer exists.
> - ⚠ **This is NOT "the app never streams".** `GET /sample` and the anonymous route-preview clip play
>   BEFORE a drive exists, with nothing on disk to play from — they deliberately still stream, on the
>   generous 12 s `PRE_START_STALL_MS`. §6's one-off-clip checks still exercise a real network fetch.
> - **Start stopped being an Alert and became a STATE.** *"This drive isn't saved yet" /
>   Save it first / Start anyway / Cancel* is deleted — `'Start anyway'` was deleted as a STRING, not
>   relocated, because a live one is how a gate quietly grows a bypass. The copy now downloads
>   automatically the moment a drive is CREATED, Start renders disabled with progress beside it while
>   that runs, and it turns itself on when the last clip lands. The separate save button collapsed
>   INTO that CTA: it appears only when nothing is running and a download is what's owed — and it now
>   reads **"Load up the drive"** (renamed from "Save for offline", founder 2026-08-05, because "save"
>   named an optional courtesy and this is the only way to Start).
> - **`?mode` is retired.** The GPS clock is a SETTING (Settings → Developer → SIMULATED GPS,
>   admin-gated + persisted) defaulting **false everywhere, `__DEV__` included**, and the `__DEV__`
>   "Simulated drive" ⋯ item is gone. The steps below were rewritten off the param that day; any
>   `?mode=…` still visible is quoted as HISTORY, never as something to type. The deep link
>   `skipper://drives/<id>/play` now says nothing about mode, on purpose — which is what closes the
>   bypass structurally rather than by adding a check.

## Why this exists

Everything the design-review follow-through shipped is verified statically — `bun run check`
(token-lint + `tsc` + `bun test`, 45 tests) is green. What it **cannot** judge is the load-bearing
runtime behaviour: animation timing and the one-amber glow budget, rounded-corner clipping of a
scrolling child, the cream-on-cream "now" well's real contrast outdoors, cross-app music
pause+resume, lock-screen Now Playing, the native splash/icon, and real GPS triggering *in motion*.
This is the human pass those need. **One physical iPhone, one dev build, ~one sitting.** The same
session that does the real-GPS test (Phase 4) is also where the audio pause+resume (§6) gets
verified — they share the build, so do them together.

## How to use this

- Work top-to-bottom. Sections are ordered the way a tester actually hits them: build → launch →
  the static screens → the player → the climax → audio → outdoor GPS → offline.
- Each check is a `- [ ]` with **Do / Expect / Watch-for** and a code anchor. Tick it or note the
  failure mode you saw.
- **§0** (build) carries a *prerequisite* — do the prereq before the checks it gates. (§6 no longer
  needs a code change: the pause+resume behaviour is already in code.)
- Report pass/fail against the per-phase **Accept** bar in `docs/designs/gps-player-spec.md` §7.

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

### No code change owed before §6 — the duck-flip is CANCELLED (founder 2026-06-11)
- The old plan flipped the tour to `'duckOthers'`; the founder **reversed it**: narration should
  **pause+resume** other audio, never duck (ducking left the rider's music competing UNDER the
  skipper — distracting). So:
  - **Drive player STAYS `doNotMix`** (`DRIVE_INTERRUPTION_MODE`, `useDrive.ts:67`) — no flip. It
    already pauses the rider's external audio for the drive and resumes it at the end; its own bundled
    music bed fades to **silence** under narration (`driveMusic.ts` ramps), so nothing competes.
  - **Pre-drive audio does the same** (the sample, the route preview clip, a tapped stop): exclusive
    `doNotMix` while a clip sounds, session handed back the instant it ends. ⚠ The `mixWithOthers`
    "polite" variant this line used to describe — roam's between-encounters mode, and the couch
    preview's `applyPoliteAudioMode` — is gone on BOTH counts: roam was removed and 1.1's D35 extended
    exclusive focus to every surface the skipper speaks on. One rule now, not two
    (`docs/decisions/drive-audio-exclusive-focus.md`).
- ⚠️ **The unverified part is the RESUME.** expo-audio has no explicit session-deactivate — we
  relinquish by flipping the interruption mode back to `mixWithOthers`. Whether iOS actually
  **resumes** Spotify/podcasts on that flip is device-only. §6 verifies it. (Lock-screen no longer
  conflicts: both players keep `doNotMix` while sounding, the mode `setActiveForLockScreen` wants.)

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
  drive list; bundle `fm.skipper.app`. Watch-for: signing failure (no membership / UDID not
  registered); iOS blocking launch until the dev profile is trusted. (`app.json:11-13,71-78`)
- [ ] **API is reachable (the #1 setup failure).** Do: with the Mac API (+ Metro) running, open the
  home screen. Expect: the drive catalogue loads real drive cards within a couple seconds; opening a
  drive shows its route + stops. Watch-for: empty list or the in-voice error wall →
  `EXPO_PUBLIC_API_URL` still pointing at `localhost:8787`; **or** a Release build over a LAN-IP URL
  getting no data while Safari can reach it → the ts.net ATS exception doesn't cover a LAN IP.
  (`apps/mobile/src/lib/auth.ts:8`, `app.json:16-23`)

## §1 — Splash & app icon (native; visible only after a fresh build, never on hot-reload)

> ⚠ **On the SIMULATOR, a changed splash keeps rendering the OLD one long after the build is
> correct — and neither a rebuild nor deleting the app clears it.** This burned an hour on
> 2026-08-03. The cache is iOS's launch snapshot (`<data container>/Library/SplashBoard/Snapshots`)
> plus SpringBoard state, and it survives `simctl uninstall`, `--no-build-cache`, and
> `launchctl stop com.apple.SpringBoard`. **The fix is `xcrun simctl shutdown <udid>` then `boot`**
> — a full device restart. (Not `erase`, which wipes every other app on that simulator.)
> Before assuming the build is wrong, prove it isn't: `xcrun assetutil --info <App>/Assets.car`
> lists `SplashScreenLogo` / `AppIcon` with their `UIAppearanceDark` and `ISAppearanceTintable`
> renditions, and compiling `Images.xcassets` yourself with `xcrun actool` should produce
> byte-identical `SHA1Digest`s. If those match, the bundle is fine and you are chasing a cache.
> A real first-launch on a real device is unaffected — this is a simulator artifact.
>
> Note also that the home screen's icon **appearance is pinned to Default** on a fresh simulator,
> so flipping system Dark Mode changes nothing — not even Apple's own icons. Dark and tinted are
> reachable only via long-press → Edit → Customize.

- [ ] **App icon on the home screen.** Do: after a fresh install, find the Skipper icon (home screen,
  app switcher, Settings list); also toggle Dark Mode to check the dusk variant. Expect: the
  **switchback S** — a drawn S with a dashed centre line running through it and a small amber dot
  at its head — in pine on a full-bleed paper (`#F2E7CC`) field (opaque, no alpha); in dark mode
  the dusk variant, parchment on night (`icon-dark.png`). Also check the **tinted** appearance
  (long-press home screen → Edit → Customize → Tinted): it should use our grayscale asset, not a
  tinted version of the paper artwork. Watch-for: the stock black Expo void (build didn't pick up
  the icon, or you're on an old install — re-run `prebuild:ios`); a transparent/black corner;
  clipping under the rounded-rect mask. (`app.json` `ios.icon` + `android.adaptiveIcon`,
  `apps/mobile/assets/brand/icon.svg`)
- [ ] **Splash on cold launch, light *and* dark.** Do: fully quit, cold-launch; then switch the
  device to Dark Mode and cold-launch again. Expect: the centred switchback S (contain, ~240pt) on
  a solid field — pine mark on cream `#F2E7CC` in light, parchment mark on deep pine `#14201B` in
  dark (the dark override). ⚠ These are **two different assets** now, not one recoloured by the
  system: a pine mark left on the night field measures 2.10:1 and reads as a murky smudge, which is
  exactly the symptom if `dark.image` gets collapsed back to `splash-icon.png`. Watch-for:
  white/black default splash (asset not bundled / stale build); cream instead of pine in dark (dark
  override not applied); stretched or off-centre mark. (`app.json` `expo-splash-screen`)

## §2 — Drive detail: trailhead placard, summary, place names, offline chip

- [ ] **Trailhead placard composition.** Do: tap a drive from home; the placard is the first card.
  Expect: a carved ranger-sign card — faint inner keyline ~5pt in, two ~4pt screw-dots (TL/BR),
  amber-warm UPPERCASE region kicker, a heavy **Alfa Slab** display headline, faint small-caps
  `Start → End` anchors, a short dashed trail with the amber rig **parked at ~6% (no glow)**, a
  dashed rule, then a mono `N STOPS · ~M MIN` permit line. Reads comfortably in dark mode (dark-first).
  Watch-for: the rig showing an amber halo (only the Start CTA owns this screen's one glow) or the
  rig animating (it's static); the headline falling back to plain bold (Alfa Slab not loaded); the
  dashed trail rendering solid on iOS. (`apps/mobile/app/drives/[id]/index.tsx:213-245`)
- [ ] **Headline wraps, never truncates.** Do: open a drive with a long name (or bump Dynamic Type
  larger). Expect: the slab headline grows onto 2–3 lines fully visible — no `…` anywhere, nothing cut
  at the gutter. Note: there is **no** per-drive summary paragraph (no `summary` field on the drive
  DTO), and as of 2026-08-03 no explainer under the Start CTA either — `voice.drive.blurb` was deleted
  because the player's own ready card (`voice.drive.readyBody`) says the same thing one tap later, in
  the persona's voice, where the rider can act on it. The only body text left on this screen is the
  save hint, which is ONE line by design. Watch-for: an ellipsis (a stray `numberOfLines`); the save
  hint wrapping to two lines; text colliding with the screw-dots at large type.
  (`apps/mobile/app/drives/[id]/index.tsx`, `src/ui/voice.ts` `offline.saveHint`)
- [ ] **Place names are cleaned.** Do: read the drive-detail itinerary and the home teaser.
  Expect: no name ends in `, California` / `, Nevada` — names read as spoken ("Emerald Bay", "Tahoe
  Keys"). Watch-for: a state suffix slipping through. Note: `cleanPlaceName` strips **only** the
  `, <US State>` suffix — *not* `(disambiguation)` (those are filtered at generation, never a stop);
  and a StopRow truncates to one line, so a legit long name ending in `…` on the row is **expected**,
  not un-cleaned cruft. (`apps/mobile/src/lib/labels.ts:29-32`)
- [ ] **Offline permit chip.** Do: signed in, open an UNDOWNLOADED drive and read the placard's permit
  row *before* doing anything; then tap the "Load up the drive" CTA (or `⋯` → "Download for offline").
  Expect: a faint `Not saved` chip with a vector cloud icon at rest → a faint `Saving k/total` label
  while it runs → a `Saved offline` chip with the "downloaded" icon; the `⋯` item flips to a
  destructive "Remove download". Watch-for: the chip colliding with the `N STOPS · ~M MIN` text on a
  narrow device — **the permit row now ALWAYS carries a chip, so this collision is far likelier than
  when the slot could be empty**; tofu icon (must be vector, not emoji); the row not wrapping at large
  text; the count under the button disagreeing with the chip (there is only ONE count, on the chip).
  (`apps/mobile/app/drives/[id]/index.tsx` — the permit-row chip ladder + `styles.permitRow`)
- [ ] **★ The download GATE, in its three states (2026-08-05 — replaces the deleted unsaved-drive
  alert).** Do: signed in, walk one drive through all three. Expect —
  **(a) nothing saved, online:** there is no Start at all; the CTA is **"Load up the drive"** over
  `saveHint` ("Start opens up once every stop is down.") plus a courtesy **"About N MB."** size line.
  Tap it. (⚠ If bytes for this drive already exist on disk the same slot reads **"Recover it without
  downloading again"** over a DIFFERENT caption, `repairHint` — "Start opens up once it's back
  together." — and the size line is correctly absent. **Watch for the download's caption leaking into
  the repair:** "…once every stop is down" beside a button promising no download is the exact
  contradiction `repairHint` exists to prevent.)
  **(b) while it runs:** the CTA becomes **"Saving for the road…"**, *disabled*, with
  "Start opens up the moment the last stop lands." under it and `Saving k/total` on the placard chip.
  **(c) when it lands:** the CTA turns itself into the live Start with **no tap from you**.
  Watch-for: **any "Start anyway" / "This drive isn't saved yet" alert** — that string was deleted, and
  its return means the gate grew a bypass; a size prompt or a "download over cellular?" dialog (the
  size line is a LABEL, never a gate — founder call, made on the measurement that our largest drive is
  ~11 MB); a disabled Start with nothing running and no explanation (the one case the "never disable"
  instinct is actually about — it should be an actionable CTA instead).
  (`apps/mobile/app/drives/[id]/index.tsx` — `decideDriveGate` + the CTA ladder)
- [ ] **★ The download survives navigation, and only Cancel stops it.** Do: start a download, then back
  out to MY DRIVES and re-enter the drive; then start another and use `⋯` → "Cancel download". Expect:
  the first is still running (or finished) on re-entry — progress continues from where it was, never
  from zero; the second stops and STAYS stopped (it must not silently auto-restart). Watch-for: a
  transfer that dies on unmount (the screen still owns an `AbortController` it shouldn't); a cancelled
  download re-firing the instant you cancel it. (`apps/mobile/src/lib/offline.ts` — the module-level
  in-flight + progress registry)
- [ ] **★ Auto-download at CREATE, and only at create.** Do: create a NEW drive from the home
  conversation and watch the detail screen you are pushed onto without touching anything; then open an
  OLD, never-saved drive from MY DRIVES. Expect: the new one starts saving by itself within a second or
  two and Start enables when it lands; the old one starts NOTHING and shows the "Load up the drive"
  CTA until you ask. Watch-for: an old drive spending tens of MB on a glance (the auto-start got keyed on
  the navigation push instead of the create handler — the two pushes are byte-identical, which is the
  whole trap). (`apps/mobile/app/index.tsx` — the create handler's `downloadDrive`)

## §3 — The gate: anonymous vs signed-in (the honest sample ride)

⚠ **The open funnel MOVED in 1.1 and again on 2026-08-05.** The anonymous taste is no longer a couch
preview of somebody's drive: it is the planner conversation, ONE server-chosen preview clip from the
rider's own proposed route, and `GET /sample` — all of which **stream**, because they play before a
drive (and therefore any download) exists. The wall is `POST /drives`. A DRIVE is user-owned, so
opening one at all needs an account; that is what the gates below catch.

- [ ] **The anonymous taste never 401s.** Do: signed out, from the home conversation ask for a real
  in-region route, then play the clip under **A TASTE OF THIS ONE**; separately, tap
  "Not near Tahoe? Hear a quick sample." Expect: both play, streamed, with **no sign-in and no
  location prompt anywhere on the path**. Watch-for: any account gate on either (they are the front
  door — a gate here is the funnel's numerator dropping to zero); either one going silent because
  someone "forced offline for everything" and took the streaming front door with it.
- [ ] **Live-drive gate keeps its promise.** Do: signed out, open a drive deep link or tap
  "Start the drive"; the owner-scoped fetch 401s → AccountGate. Read it, then tap the ghost
  "Just take the sample ride". Expect: gate titled "Grab your ticket", note "This is the live,
  on-the-road drive.", primary "Get my free ticket", ghost "Just take the sample ride" — and the ghost
  routes to **`/sample`** (the curated postcard). ⚠ It used to route into a `?mode=preview` player of
  THIS drive, which re-hit the same account-gated fetch and looped the rider back onto the gate
  forever; `?mode` no longer exists at all. Watch-for: the ghost being a no-op `back()` (the exact
  regression `6ee056c` fixed); gate body + note both saying "needs a free ticket" (stutter).
  (`apps/mobile/app/drives/[id]/play.tsx` — the `phase === 'gate'` branch, `src/ui/AccountGate.tsx`)
- [ ] **★ The player's OWN download gate (the deep-link case).** Do: signed in, with a drive that is
  NOT fully saved, open `skipper://drives/<id>/play` directly (no detail screen in the stack). Expect:
  the download gate, **not** the player and **not** a location prompt — the message is the save hint
  and the action takes you to the drive screen (which owns the download, its progress and its honest
  offline message). Watch-for: the player starting anyway (the gate lives only on the CTA — that is a
  bypass, and it was the reason the gate was put in two places keyed on one expression); the iOS
  location prompt firing first, spending the one prompt we get on a drive that cannot roll.
  (`apps/mobile/app/drives/[id]/play.tsx` — the `needsDownload` branch, above `locationPrime`)
- [ ] **Download gate "Keep browsing" restores the drive.** Do: signed out, `⋯` → "Download for
  offline"; the 401 swaps detail for the AccountGate. Tap the ghost "Keep browsing". Expect: it
  returns to the fully-rendered drive-detail **in place** (`setNeedsAccount(false)`) — it does NOT pop
  to home. Watch-for: wrong ghost label, or it popping the stack to the drives list.
  (`apps/mobile/app/drives/[id]/index.tsx:51-67,150-157`)
- [ ] **Signed-in user never sees the gate.** Do: sign in (free account), tap "Start the drive" and
  separately "Load up the drive" (or `⋯` → "Download for offline"). Expect: the live drive opens (⚠ on
  an UNSAVED drive there is no Start to tap at all — the download gate above owns that CTA; save it
  first, which is a wait, not an alert to dismiss), and a *location* permission gate may follow —
  that's GPS, §7. Download shows the not-saved→saving→saved chip; no AccountGate. Watch-for: a signed-in user still hitting "Grab your ticket" (session cookie not sent);
  or staying stuck on the gate after signing in from it (the play-screen session-retry should drop
  them into the drive). (`tierOf` in `packages/shared/src/access.ts` — the one implementation both the
  server and the app now derive "signed in" from; `withSession`/`requireAccount` in
  `apps/api/src/entitlements.ts` are what turn that into the 401 the gate renders. Cited by SYMBOL, not
  file:line: this entry pointed at a deleted `apps/api/src/tiers.ts` and at unrelated `index.ts` lines
  for exactly one sweep before anyone read it on a drive.)

## §4 — The route card (shared StopList): static on detail, fixed-shell on the player

Same component (`apps/mobile/src/ui/StopList.tsx`) in two modes.

⚠ **How to get a simulated drive now (2026-08-05):** the `__DEV__` `⋯` → "Simulated drive" item is
GONE — and note it never said "sim" in the first place: it pushed a BARE `/play` and leaned on
`__DEV__` to be read that way, which is precisely why the param was retired. Sign in as an **admin**,
then **Settings → Developer → SIMULATED
GPS → "Simulated"** (the alternative is "Real GPS", which is the default in every build, `__DEV__`
included). It is one persisted value that the player reads, so the drive you get from "Start the
drive" IS the simulated one; the "Real time / 8× faster" knob appears on the ready card. ⚠ **Turn it
back to Real GPS afterwards** — leaving it on silently simulates the next real drive and suppresses
the admin trace recorder, which is gated on a `live` drive. And note the drive still has to be
DOWNLOADED first: sim behaves exactly as live, deliberately, so our own QA runs the gate riders run.

- [ ] **Detail = one card, page scrolls.** Do: on drive detail, scroll to the itinerary (under the
  hint + List/Map row). Expect: a single raised card of hairline-ruled ONE-LINE rows (glyph + name +
  a mono clip length on the right; a type word — `View` / `Pit stop` — appears before the length only
  on a non-story stop); rules are **inset**, not full-bleed, and the rows share that inset; the card
  has no internal scrollbar — the *page* scrolls and the card grows to fit; no row highlighted (all
  "upcoming"). Watch-for: rows as separate floating cards; the card scrolling internally; a row
  looking active/checked on the static screen; the same type label repeating down every row (the
  wallpaper this replaced).
  (`apps/mobile/app/drives/[id]/index.tsx:283`, `src/ui/StopList.tsx:105`)
- [ ] **Player = fixed shell, rows scroll inside.** Do: open the player (a saved drive, sim or live);
  drag up/down inside the route card between the trail (top) and the player dock (bottom).
  Expect: the card's outer rounded rect (all four corners) stays anchored and fills the gap; only the
  rows slide inside it. Watch-for: the whole card scrolling with the page; the card collapsing to
  content height and leaving a gap (flex:1 not applied); rows not scrolling at all (clipped out of
  reach). (`apps/mobile/app/drives/[id]/play.tsx:351,499`)
- [ ] **Rows clip to the rounded corners.** Do: slowly drag so a row is half-in/half-out at the top
  and bottom edges. Expect: the partial row is cut along the card's corner radius — the cream edge
  stays a clean rounded rect, nothing spills past the corners. Watch-for: content leaking over square
  corners (`overflow:hidden` not honoured on iOS for the rounded card).
  (`apps/mobile/src/ui/StopList.tsx`, `src/ui/Card.tsx`)
- [ ] **Active "now" row is a TICK, not a filled row.** Do: play a sim drive; find the current
  stop's row. Expect: a short **pine rule in the row's left margin** (aligned with the divider rules'
  own inset), pine/accent glyph (never amber), bold name, and `NOW` where other rows show their
  length; passed rows dimmed with the check in place of the glyph; only one active at a time.
  ⚠ There is deliberately **no background fill** (2026-08-03): the sunken well this replaced drew a
  rounded rect inside the card's own rounded rect and read as two overlapping selections, worst on the
  first row — which is the active one for most of a drive. Watch-for: any highlight box returning; the
  tick colliding with the glyph; the highlight lagging the audio by seconds.
  (`apps/mobile/src/ui/StopRow.tsx`)
- [ ] **★ Checks mean HEARD, not "the car got there".** Do: run a sim drive at **8×** and watch the
  list while the first clip narrates. Expect: exactly one `NOW` row; every stop the car has already
  rolled past but whose clip is still QUEUED stays plain "upcoming" — no check — and the header
  counter matches the number of checks at all times. ⚠ 8× is the deliberate stress case: the road
  runs 8× faster while audio still plays at 1×, so the fire-queue backs up several stops deep, which
  is what surfaced the original bug (checks on stops nobody had heard). Watch-for: a check appearing
  before its clip has played; the counter running ahead of the checks (they are ONE set —
  `playedSeqs` — so disagreement means someone re-wired one of them to `firedSeqs`).
  (`apps/mobile/src/lib/useDrive.ts` `playedSeqs`, `app/drives/[id]/play.tsx` `stopViews`)
- [ ] **No white scroll indicator; edges dissolve.** Do: flick the player itinerary. Expect: no
  vertical scrollbar on the cream card; a clipped row at the top/bottom **fades** into the card
  instead of being sliced at a hard edge, and the fade appears ONLY when there is genuinely more to
  scroll. Watch-for: a stark white bar flashing on the right; a fade over a short, non-overflowing
  list (dissolving real content at rest); a fade in the wrong paper — it must dissolve into the CARD
  (`surfaceRaised`), not the app background. (`apps/mobile/src/ui/StopList.tsx`, `src/ui/EdgeFade.tsx`)
- [ ] **★ P1 — itinerary stays browsable WHILE a clip plays.** Do: start a sim drive (8× so stops
  fire fast); while a clip is narrating, drag down to later stops and **hold** your view for 5+
  seconds, including across a stop transition. Expect: smooth drag; the list stays where you put it,
  does **not** snap back to the active row on every audio tick, and does **not** get yanked away the
  instant you lift off — a ~5s touch-grace holds it even if a new stop fires; only after that, on the
  *next* transition, does auto-scroll quietly re-centre (focused row near the top). Watch-for: the
  list snapping back every ~0.5s (the pre-fix regression — stops array rebuilt each tick); a jump the
  instant you release; auto-scroll never resuming (grace timer stuck).
  (`apps/mobile/app/drives/[id]/play.tsx:101,113,128`)
- [ ] **★ Rows are tappable for PASSED stops only (2026-08-05 — replaces "read-only on the drive").**
  Do: mid-drive, in the quiet between clips, tap a stop the road has already gone by; then tap an
  UPCOMING row; then tap a passed row *while a clip is playing*; then tap a passed row and, before it
  finishes, let the car reach a real stop. Expect: the passed row re-hears that stop (brief pressed
  dim) on the same mechanism as "Replay that"; the upcoming row does **nothing** and does not even
  announce itself as a button to VoiceOver (the pressability is PER-ROW, not per-list); a tap over a
  playing clip is refused, exactly as the Replay button is; and a live GPS trigger **preempts** the
  replay — the road always wins. Watch-for: an upcoming row playing ahead (it would then fire AGAIN on
  approach and the rider hears it twice, since a replay deliberately never touches the fired set); two
  taps in a row queueing two replays, the second of which the road can no longer preempt; a tap
  resetting the retry state for every other stop in the drive.
  (`apps/mobile/app/drives/[id]/play.tsx` — `replayFromRow` + `canPressItem={d.isReplayable}`,
  `src/lib/useDrive.ts` `isReplayable`/`replayStop`)

## §5 — The drive-complete moment (reach it via the 8× sim)

There is **no** dedicated drive-complete component — the moment is composed inline in `play.tsx`
(done-branch card + a progress-to-1 effect) plus the StopList/StopRow stamp path.

- [ ] **Reach completion.** Do: open a tour → in the pre-drive "READY TO ROLL" card pick **"8×
  faster"** (`play.tsx:404`), tap "Let's roll", let it run ~2 min uninterrupted to the end. Do **not**
  tap "Pull over" (that resets, doesn't complete). Expect: after the last stop (+ the "One for the
  road" outro), the card flips to kicker "DRIVE COMPLETE", title "You've arrived", body "That's the
  end of the road, folks. Watch your step climbing out." Watch-for: the drive hanging on the last
  clip; the outro double-playing or skipping; the run stalling if the screen locks mid-sim.
  (`apps/mobile/app/drives/[id]/play.tsx:45,404`, `src/lib/useDrive.ts:437`)
- [ ] **Rig pulls into the driveway.** Do: watch the dashed RouteTrack as phase flips to `done`.
  Expect: the amber car token **glides** smoothly to the far-right end over ~0.4s (a single eased
  timing) — like rolling the last few feet to a stop, not a jump; the token's halo turns **off** in
  the done state. Watch-for: the token snapping instantly (timing didn't run, or Reduce Motion is
  on); stopping short / overshooting; jank. (`apps/mobile/app/drives/[id]/play.tsx:134`,
  `src/ui/RouteTrack.tsx:23`)
- [ ] **Stamp cascade down the itinerary.** Do: scroll the list to the top first, then watch at
  completion. Expect: each passed row's check (checkmark-circle, inkFaint) pops in top-to-bottom,
  staggered ~80ms apart, each with a small scale-up + rotate settle (a postmark stamp) — checkmarks
  rubber-stamped down the list, not all at once. Watch-for: all checks appearing simultaneously
  (stagger not applied); no animation; the cascade re-firing on every tick.
  (`apps/mobile/app/drives/[id]/play.tsx:359`, `src/ui/StopRow.tsx:48`)
- [ ] **The done card owns the single glow.** Do: compare the done card against the token and the
  transport buttons. Expect: the done card has an amber keyline + soft amber halo and is the **only**
  amber-glowing element (token halo off, Restart CTA glow-less). Watch-for: a flat/dead card (no
  glow), or a *second* glow somewhere (the two-glow regression this fixed); the halo washing out in
  light vs dark. (`apps/mobile/app/drives/[id]/play.tsx:226,277`, `src/ui/NowCard.tsx:50`)
- [ ] **Copy + exits.** Do: read the card; tap "Run it again, skipper" (replays); re-complete, tap
  "Back to the trailhead". Expect: a mono tally reads **`{N} STOPS` — a STATIC stamped count, NOT an
  animated odometer**; Restart replays from the top; "Back to the trailhead" calls `goBack()` with
  **no** "Pull over?" confirm (that guard fires only while `driving`). Watch-for: a tester expecting
  an odometer roll and filing the static count as a bug; the confirm alert wrongly firing at done.
  (`apps/mobile/app/drives/[id]/play.tsx:227,269`)
- [ ] **Reduce Motion fallback.** Do: iOS Settings → Accessibility → Motion → Reduce Motion ON; complete
  a drive again. Expect: the rig jumps straight to 100% (no glide), the stamp cascade is replaced by
  the static end state (checks simply present), card copy/glow unchanged — still looks *finished*,
  just no flourishes. Watch-for: animations still playing; or the checks NOT appearing at all (end
  state not rendered, leaving passed rows uncheck'd). (`apps/mobile/app/drives/[id]/play.tsx:136,359`)

## §6 — Audio pause+resume (no prereq flip — it's already in code)

The founder's call (2026-06-11): narration pauses+resumes other audio, never ducks. Every surface
keeps `doNotMix` while a clip sounds and hands the session back when it stops. This concerns the
**rider's external** music (Spotify/Apple Music) — the drive's *own*
bundled bed is a separate engine (`driveMusic.ts`) that fades to silence under narration, don't
conflate them. Use a real device with a real music app; the simulator can't run cross-app focus.

**Drive player** (`doNotMix`, unchanged):
- [ ] **Rider's music pauses for the drive, resumes at the end.** Do: start Spotify; return to
  Skipper, start a sim or live drive. Expect: the music **pauses** when the drive's audio takes over
  and **resumes** when you end the drive / leave the player. Watch-for: music ducking instead of
  pausing (wrong mode); never resuming after the drive ends (the resume landmine — report it).
  (`apps/mobile/src/lib/useDrive.ts:67`)
- [ ] **★ Lock-screen Now Playing holds (now its happy path).** Do: with a clip playing, lock the
  phone / open Control Center; check the Now Playing widget + try play/pause + scrub. Expect: the
  **skipper** clip — title = stop name, artist = host, album = tour — and working transport. With
  `doNotMix` retained there's no `setActiveForLockScreen` conflict, so this should *just work*.
  Watch-for: card missing/replaced by the music app; dead transport. (`useDrive.ts:721`)

**Pre-drive audio** (the sample postcard, the route preview clip, a tapped stop on drive detail):

> 🔴 **The four checks that were here belonged to the ROAM player and it no longer exists** (removed
> 1.1, 2026-08-01, along with `useRoam.ts` and its `mixWithOthers` ⇄ `doNotMix` per-encounter dance).
> They are replaced rather than deleted because **the risk they were testing did not go away — it
> MOVED.** Every pre-drive surface now takes the same EXCLUSIVE `doNotMix` the drive does
> (`docs/decisions/drive-audio-exclusive-focus.md`, extended 2026-08-01), so each one INTERRUPTS the
> rider's music and each one owes the session back afterwards. That hand-back is the identical
> unverifiable-from-a-desk flip §6 exists for, and it is now spread across three call sites
> (`useStopPreview.ts`, `useRoutePreview.ts`, `useDrive.ts`) instead of one.

- [ ] **★ A one-off clip pauses the rider's music and gives it back.** Do: start Spotify; return to
  Skipper and play the free sample, then the route-preview clip under **A TASTE OF THIS ONE**, then a
  stop from a drive-detail page (that drive must be SAVED — the mini-preview plays only from disk).
  Expect: the music **pauses** when the skipper starts and **resumes** within a beat of the clip
  ending — from EACH of the three surfaces, tested separately. Watch-for: music **staying paused**
  after the clip (the hand-back didn't take — the core risk, and the failure this section exists for);
  ducking instead of pausing; the skipper overlapping.
- [ ] **A clip that never sounds never touches the music.** Do: play the sample or the route-preview
  clip on thin/no signal (those two still STREAM, so the network is the way to force this), or
  interrupt one mid-load. Expect: focus is taken only on real audio, so the rider's music is
  untouched. Watch-for: music pausing for a clip that then fails to play. (⚠ `preview-util.ts` calls
  this out as "the obligation that was missed, twice" — a clip that merely ATTEMPTED to play still
  owes the hand-back.)
- [ ] **Same behaviour on a live drive.** Do: re-confirm with SIMULATED GPS off (the audio session is
  mode-agnostic). Watch-for: any `live`↔`sim` divergence — surprising by construction now, since the
  mode is one persisted boolean the player reads and nothing else branches on it. Report it.
  (`apps/mobile/app/drives/[id]/play.tsx` — `driveMode = simMode ? 'sim' : 'live'`)

## §7 — Real GPS, outdoors & in motion (Phase 4 — the bike/drive test)

Foreground When-In-Use only. ⚠ **`?mode` is retired (2026-08-05)** — the clock is now one expression,
`driveMode = simMode ? 'sim' : 'live'`, read from the persisted Settings → Developer toggle. That
toggle is **false everywhere by default, `__DEV__` included** (a `__DEV__` default would have silently
simulated the founder's own real drive and produced no admin trace of a drive that cannot be
re-recorded). So "Start the drive" on any build is a LIVE, real-GPS drive unless someone deliberately
flipped it — and `skipper://drives/<id>/play?mode=live` no longer says anything, because nothing reads
it. ⚠ Every live drive here needs the drive SAVED first; the player's own download gate sits ABOVE the
location prompts, so a drive that cannot roll never spends iOS's one-shot permission prompt.

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
- [ ] **Live mode uses REAL GPS.** Do: with Settings → Developer → SIMULATED GPS on **Real GPS**,
  start a drive; observe the ready screen, then stand still vs move. Expect: **no** "Real time / 8×
  faster" toggle (that's sim-only), **no `SIM` tag** beside the stop counter in the itinerary header
  (only the simulator half is ever announced — a live drive says nothing, which is the un-newsworthy
  case); the route dot stays put while stationary and advances proportionally to real distance as you
  move. Watch-for: the 8× toggle or the `SIM` tag appearing (the persisted toggle is on — check
  Settings, since nothing else can put you in sim any more); the dot advancing on a timer while still.
  (`apps/mobile/src/lib/useDrive.ts`, `app/drives/[id]/play.tsx` — `driveMode`)
- [ ] **iOS −1 sentinel is handled.** Do: watch the first seconds before GPS settles (cold start
  outdoors / stepping out from indoors); also crawl/stand near a stop. Expect: a "Looking for the
  satellites — hang tight." cue after ~8s of no usable fix, **not** a frozen screen or a spuriously
  fired stop; invalid speed (−1) coerced to 0, invalid course (−1) passed RAW (= unknown → the
  heading gate is skipped, proximity-only), and a fix with accuracy `< 0` *or* `> 50m` dropped.
  Watch-for: a stop firing the instant the drive starts while you're far away (a wild low-accuracy
  first fix slipped the gate); a long quiet stretch while driving right past stops (a heading-gate
  regression). (`apps/mobile/src/lib/gps.ts:135,302`, `packages/engine/src/trigger.ts:116`)
  **⚠ CONFIRMED IN THE FIELD (2026-06-10, free-roam's first live drive):** the −1→0 coercion DID
  read as a real northbound heading and gated out everything non-north. Roam's fix: `liveRoamSource`
  passes the RAW course and `RoamEngine` skips the gate when `headingDeg < 0` (unknown). **The same
  sentinel contract is now PORTED to the drive path** (2026-06-11: `liveSource` passes raw course;
  `TriggerEngine` skips the gate on a negative heading — unit-tested, but the port itself is what
  this checklist item now verifies on the road). Residual to weigh on-device: drive stops are
  one-shot, so during a −1 stretch a behind/abeam stop within radius CAN fire wrong-direction and
  is then consumed — judged better than the field-confirmed silence, same policy as crawling speed.
- [ ] **★ Triggers fire at the right points while moving (the core bet).** Do: bike/drive the real
  route at a steady pace; note where narration starts relative to each stop; ideally test an
  out-and-back leg or a stop the road passes close to but doesn't reach. Expect: narration begins a
  roughly constant **time** ahead (~12s lead = `max(stop floor, speed·12s)`), so faster = triggers
  from farther out; above ~5mph a stop fires only inside the 90° forward heading cone (a passed/
  opposite-direction stop does **not** fire); each stop fires at most once; after a clip it returns to
  ducked-quiet and **waits** for the next trigger (never auto-advances). Watch-for: narration firing
  late/on top of the stop at speed (lead not scaling); a behind/abeam stop firing (heading gate off);
  double-/re-fire on a return leg; stops never firing despite driving right past (accuracy gate too
  tight, or alongM projection broken). (`packages/engine/src/trigger.ts:70,99,101`)
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

## §8 — Offline — airplane-mode acceptance (⚠ no longer a Phase-3 extra: it is the ONLY way a drive plays)

- [ ] **Download, then drive with zero network.** Do: signed in, save a drive (the CTA, or `⋯` →
  "Download for offline"); wait for completion; turn on **Airplane Mode** (confirm Wi-Fi/Tailscale
  off); reopen the drive and start it, and pull up the home list. Expect: the `⋯` item flipped to
  "Remove download"; in Airplane Mode the detail still renders (from the saved manifest) and audio
  plays from local `file://` bytes (intro/outro brackets + every stop) with no network; the home list
  still shows the downloaded drive. ⚠ There is no longer a "Playing from download" chip to look for —
  it was deleted because a chip asserting what is now always true asserts nothing. Watch-for: download
  "finishes" but playback is silent/errors (clips not actually on disk); files written to OS-evictable
  cache instead of the document dir; manifest storing absolute `file://` URIs (must be **relative**
  filenames) or presigned R2 URLs (~1h TTL) instead of bytes → playback dies after an hour offline; a
  half/failed download reading as ready; **any network request at all while a drive plays**.
  (`apps/mobile/src/lib/offline.ts` — `loadPlayback` is disk-only now)
- [ ] **★★ THE ONE CHECK THE BUILD STILL OWES: does a real local clip start inside
  `LOCAL_CLIP_STALL_MS`?** ⚠ The pre-start watchdog dropped from the 12 s remote budget
  (`PRE_START_STALL_MS`) to **2.5 s** for a file on disk (`packages/engine/src/player.ts`), and
  **2.5 s is a DESK ESTIMATE** — a guess at the worst case, a cold read of a ~1 MB `.m4a` while the OS
  is busy elsewhere. It has never been measured on a phone. Do: drive a saved drive end to end on the
  oldest/coldest device you have, cold-launched, ideally with the phone otherwise busy (a big download
  in another app, low power mode, Airplane Mode so nothing else competes). Expect: **every** stop's
  audio starts — no stop announced and then skipped. Watch-for: **`stop_skipped` with reason
  `load_timeout` on a clip that is provably on disk** — replay that stop from its row (§4) and if it
  plays fine, the watchdog fired early. That is the failure mode that matters: the generous 12 s
  existed because expo-audio's status reporting was NOT trusted here (`sawFresh` exists because
  `playing` flips true on the play() *intent*), so if local decode state lags the same way, the short
  value **skips clips that would have played — trading dead air for LOST STOPS, which is the worse
  currency.** If you see even one, report the value, don't quietly raise it: this is the precondition
  the shorter threshold shipped on. (`packages/engine/src/player.ts` `LOCAL_CLIP_STALL_MS`,
  `apps/mobile/src/lib/useDrive.ts` — the clip-load watchdog)
- [ ] **A genuinely dead local clip still skips, once.** Do: force one (remove a clip file from the
  drive's directory, or interrupt a download so a stop's bytes never land) and drive past it. Expect:
  ~2.5 s of quiet, then the drive **moves on** — one pass, not two. ⚠ The re-sign rung is gone, so a
  dead clip costs a couple of seconds, not the old 24 s. Watch-for: the drive hanging on it; a second
  wait (the deleted rung came back); the skip reason reading `resign_failed` (deleted — a local file
  cannot expire, so the only cause left is a truncated or undecodable download).

---

## Known gaps & follow-ups (decide / file after the pass)

- **Duck vs lock-screen Now Playing conflict (§6).** The riskiest assumption: `'duckOthers'` may
  break the skipper's lock-screen card (`setActiveForLockScreen` wants `doNotMix`). If §6 shows they
  don't coexist, the flip needs a different approach (e.g. revert + revisit) — capture the finding in
  `docs/designs/gps-player-spec.md` (Phase 0).
- **No `UIBackgroundModes:['audio']` (§7).** Locked-screen audio during a live drive is unverified
  and may require this native entry + a rebuild. Decide before the build if you want to test it.

## Map notes for the tester / next agent (current code, not stale memory)

- The drive player is **one file**: `apps/mobile/app/drives/[id]/play.tsx`, and since 2026-08-05 it is
  **one route with one meaning** — no `?mode`, no couch preview, just `driveMode = simMode ? 'sim' :
  'live'` off the persisted Settings toggle. There is no `app/drive/[id].tsx` or `app/preview/[id].tsx`
  (older memory names them — they don't exist). Drive detail is `apps/mobile/app/drives/[id]/index.tsx`.
- No dedicated drive-complete component — composed inline in `play.tsx` + the StopList/StopRow stamp
  path. The completion tally is a **static `{N} STOPS`**, not an animated odometer. The "passport
  cascade" is the existing itinerary's checkmarks stamping in, not a separate passport screen.
- The active "now" row is a **pine tick in the row's left margin** — no background fill. (It WAS a
  `surfaceSunken` well; that drew a rounded rect inside the card's own rounded rect and read as two
  overlapping selections. See §4's check, which is the current truth.)
- **There is no `?mode` to be missing or malformed.** The sim clock is a persisted SETTING, default
  false in every build including `__DEV__`, and the player carries no build-type branch — the
  environment picks a *default value*, it does not participate in *deciding*.
- **A drive's audio is only ever played from disk**, so there is no streaming fallback, no re-sign, and
  no `POST /drives/:id/assets/sign`. ⚠ `GET /sample` and the anonymous route-preview clip are the
  deliberate exception and still stream — they play before a drive (and any download) exists.
