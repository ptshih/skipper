# `apps/mobile` internals

**Status:** Snapshot — 2026-08-02, written by reading `apps/mobile` source directly during 1.1 step
12. **Derived and it will drift** — the code wins, `apps/mobile/CLAUDE.md` + `DESIGN.md` own the
design-system rules, and the root `CLAUDE.md` owns the player/audio/GPS landmines (they span
`@skipper/engine` too). Its job is orientation: enough shape to read the real thing without getting
lost. Split out of [architecture-overview.md](architecture-overview.md) so the detail has one home;
that doc keeps the one-paragraph version and points here. Volatile values (timeouts, grace windows,
SDK pins) are left as pointers to their one home rather than copied into prose.

## The shape

Expo Router, file-based, new arch.

| Screen | What it is |
|---|---|
| `app/_layout.tsx` | The shell — providers, splash, fonts, startup janitors, `VersionGate` |
| `app/index.tsx` | **Home is the conversation.** The planner; MY DRIVES is the archive below it |
| `app/sample.tsx` | The one ungated sample clip, with its postcard |
| `app/sign-in.tsx` | The account wall's destination |
| `app/settings.tsx` | Theme, sim mode, account, deletion |
| `app/legal.tsx` | Sources & licenses (bundled, must render in a dead zone) |
| `app/developer.tsx` | Dev-only affordances |
| `app/drives/[id]/index.tsx` | Drive detail + the per-stop mini-preview |
| `app/drives/[id]/play.tsx` | The live, GPS-triggered player |

**There is no state management library.** No Redux, no Zustand, no React Query. Three contexts —
`ThemeProvider`, `SimModeProvider`, `Connectivity` — and everything else is local React state plus
hand-rolled hooks. Dependencies are almost entirely `expo-*` primitives, `react-native-maps`,
`better-auth`, `posthog-react-native`.

The consequence to know going in: every screen hand-rolls its own fetch / loading / error lifecycle.
`StateView` standardizes how that *looks*, not how it is *managed*. There is no cache layer and no
shared retry policy; `connectivity` + `offline` do that job instead, deliberately.

## The defining pattern: pure/native splits

Nearly every module with real logic exists **twice** — a pure half and a native half:

| Pure (runs under `bun test`) | Native (side effects only) |
|---|---|
| `connectivity-util.ts` | `connectivity.ts` |
| `gps-util.ts` | `gps.ts` |
| `offline-util.ts` | `clip-store.ts`, `offline.ts` |
| `anon-session-util.ts` | `anon-session.ts` |
| `planner-util.ts`, `planner-transcript.ts`, `planner-route.ts`, `say-buffer.ts` | `planner.ts` |
| `labels.ts`, `planner-examples.ts` | — |

The reason is mechanical: React Native modules cannot be imported under `bun test`, so all judgement
is pushed into files importing nothing native, and the native file holds only side effects.
`clip-store.ts` states its own version — every decision it *could* make already lives in
`offline-util`; what remains is the moves, the presence probes, the listing and the deletes, plus one
judgement of its own (did the destination actually land), which is the crash-safety contract.

This is the most consistent architectural decision in the app, and the reason the mobile test suite
is meaningful despite there being no RN test runner.

⚠ The corollary: **a hook is effectively untestable here.** `useDrive`, `useRoutePreview` and
`useStopPreview` hold timer-and-ref state and import `expo-audio`, so their coverage comes only
through the pure decision helpers they call (`@skipper/engine`'s `player.ts`). When adding logic to a
hook, the question to ask is which part of it can move into a pure module.

## Startup sequence (`_layout.tsx`)

Fonts + splash → `ThemeProvider` (mode read from secure-store *before* first paint) →
`SimModeProvider` (same, so a tester's sim session survives a cold start with no live→sim flip race)
→ `AnalyticsProvider` → `useAnonymousMint()` → `reclaimLegacyRoamPack()` → `sweepOrphanClips()` →
`VersionGate`.

Two of those are janitorial and worth understanding:

- **`reclaimLegacyRoamPack`** — deleting roam did not delete its bytes. The offline pack was
  reclaimable only through a `deleteRoamPack()` that went with the feature, permanently stranding it
  on every device that ever tapped Save. This runs once at launch. ⚠ Any future feature deletion that
  owned disk has the same shape.
- **`sweepOrphanClips`** — the subject-keyed store's collector.

## Home is the conversation

`app/index.tsx` is the planner, and its header names three things nothing else holds:

1. **The transcript.** The planner is stateless by design (D10) — no `conversations` table, no server
   copy, and INV-13 forbids persisting rider content on the client. So this React state is *the only
   copy of the conversation that exists anywhere*. That is why the account wall and the route card
   render **inline** rather than via `<AccountGate>` or `router.replace`: anything that unmounts home
   destroys it. ⚠ **This is a standing constraint on this file**, intended (founder, 2026-08-02), and
   the kind someone violates without knowing why. Cost + revisit sketches are in TODO.md.
2. **The spend.** Every send bills a model call, every drawn route bills Routes, every "Make this
   drive" spends a non-refundable credit. Hence: no auto-retry ever (a retry is a rider tap), no
   auto-fire on return from signup, and a **per-card** double-tap guard — a screen-level guard would
   let card #1 block card #2, or worse, let card #2 dedupe against card #1's idempotency key.
3. **The wire shape**, via a single `toWire()`.

## The planner client and the SSE contract

`planner.ts` reads one turn as SSE: zero or more `event: say` frames each carrying one delta, then
**exactly one** `event: turn` frame carrying the whole response. Three rules that are easy to get
wrong and each cost something real:

- **The terminal frame is authoritative and its `say` may differ from the deltas.** A refusal
  *replaces* the streamed text entirely; a truncation *appends* a retry line to it. So a caller
  **replaces** its buffer with the terminal `say` — it must never append the terminal frame to what
  it already animated. Deltas are a typing animation; the terminal frame is the message.
- **EOF with no `turn` frame means the turn failed.** There is no `[DONE]` sentinel — the terminal
  frame *is* the sentinel.
- **A partial `say` from a failed turn must be dropped** from the transcript and never re-sent. It is
  a transcript of something the model never said; re-sending it both poisons the next turn's cached
  prompt prefix and lies to the rider.

`say-buffer.ts` coalesces deltas to **sentence granularity**. Rendering each token as it lands makes
the skipper read like a teletype rather than someone talking — and, the forcing reason, a bubble that
re-renders per token floods TalkBack. The visible text changes a sentence at a time and the one-shot
a11y announce waits for settle.

`planner-transcript.ts` owns every rule about what a transcript *is*, pure and native-free; the screen
owns only the React state.

## The player (`useDrive`)

Owns four things: the trigger engine, the audio player, lock-screen Now Playing, and the fire-queue.

**The clock is the GPS fix stream.** Each `GpsFix` runs `engine.update(fix)`; any stop that fires is
queued and played. Critically, **a finished clip returns to quiet and waits for the next GPS trigger
— it never advances by a clip ending.** The drive is driven by the road, not by a playlist.

The source is swappable behind `GpsFixSource` (`gps.ts`): `simulatedSource` replays a recorded Tahoe
drive on a wall-clock timer (couch-testable on the iOS Simulator, with a fast scale so a full drive
triggers in a couple of minutes), and `liveSource` wraps `expo-location`'s `watchPositionAsync`. The
hooks subscribe to one or the other and nothing else changes. `?mode=live` on the play route picks.

**The stall ladder has two deliberately different paths:**

- **URI present but will not play** (expired presign, decode failure, dead-zone stream buffering
  forever): after the pre-start grace (`PRE_START_STALL_MS` in `@skipper/engine`'s `player.ts`),
  re-sign **once** and reload. If it still will not start on the second pass — or the re-sign itself
  fails, which is the dead-zone case — surface a visible stall note and skip the stop. Skipping *now*
  on a failed re-sign matters: otherwise the clip stays busy and the sequential pump (and the end of
  the drive) hangs forever on silence.
- **URI missing entirely**: advance after a short timer with **no note**. The stop passes in silence.

⚠ That second path is why `clip-store.ts` calls itself "the module that must never lose a rider's
download": a missing clip is a silent hole *by construction*, on the theory that it is impossible if
the store did its job. The corollary is that a store regression is invisible from both ends — the
rider hears silence and never learns a stop was there, and no signal reaches us. See TODO.md's
PostHog Stage 4.

A separate **post-start** watchdog (`POST_START_STALL_MS`) covers the other half: a clip that started
and then froze, because `expo-audio` fires no `didJustFinish` across an OS interruption. The pure
branch logic for it is `decideStall` in `@skipper/engine`.

## Audio: who owns the channel

The drive takes **exclusive** focus (`doNotMix`) — founder-decided, not a default. The drive *is* the
audio, not a voice-over ducking the rider's music; ducking was built, tried and rejected.
⚠ `setAudioModeAsync` is **process-wide and last-writer-wins**, so every surface re-asserts its own
mode on each play rather than once on mount — otherwise a rider who opens a drive and comes back gets
a preview clip that keeps talking after they leave the app.

Three surfaces:

- **Narration** — the `useDrive` player.
- **Drive music** (`driveMusic.ts`) — a shuffled rotation that plays between stops, fades out under
  narration, and fades a **fresh** track in for the next leg, so every narrated leg gets a different
  song. Rotation is keyed off **segment kind** (advancing only on leaving a `clip`), not play state —
  so pausing and resuming never rotates the track, and every swap is masked by the narration just
  ducked under. The playlist loops so it never runs dry.
- **Previews** — `useStopPreview` (drive detail, per-stop) and `useRoutePreview` (in-conversation).
  Each keeps **one reused player**, because `expo-audio` allocates a native player per
  `useAudioPlayer()` and N cards must never mean N native players.

⚠ **Handing the session back is an obligation, not a nicety.** Under `doNotMix`, pausing does not
release the audio session — iOS resumes the rider's own music only once the session is deactivated.
Every path that ends playback (dismiss, clip ran out, clip *failed*) must call
`setIsAudioActiveAsync(false)`, or the rider is left in silence with no control on screen that fixes
it. This was learned at the end of a drive and applies to every surface taking exclusive focus.

### The two preview hooks differ in one structural way

`useStopPreview` resolves audio through `offline.loadPlayback`'s seq→uri map — **never `clip.url`
directly**, because a downloaded drive nulls every presigned URL on disk, so a raw `clip.url` read is
silently unplayable in exactly the dead-zone case the product exists for. It can re-sign on a miss.

`useRoutePreview` **has no re-sign path, deliberately.** The URL arrives on the proposal, and the only
endpoint that could mint a fresh one is an owner route behind `requireAccount` — which the anonymous
rider, the entire audience for that surface, cannot call. A dead presign is therefore terminal, and
the honest offer is "make the drive", not a retry that cannot work. ⚠ Which makes *reaching* that
terminal state the whole job: it is bounded by a pre-start watchdog on a clock, not by the vendor
populating `status.error` (whose behavior for an HTTP 403 on a remote source is device-unverified).

## Offline: three modules, one job

- **`download.ts`** — the single hardened byte-transfer primitive: one file to disk, bounded,
  verified, with the retry/backoff/cancel semantics a dead zone demands. Its second caller (the roam
  pack) is gone and the split is kept anyway: the extraction is what makes a second downloader
  impossible to justify.
- **`clip-store.ts`** — shared, subject-keyed bytes in `Paths.document/clips/`. **`Paths.document`,
  not `Paths.cache`** — the OS evicts cache. Its crash-safety contract runs one direction: a collision
  deletes the **source**, an ambiguous outcome leaves **both** copies, and the sweep deletes nothing
  at all unless it can prove the keep-set is complete.
- **`offline.ts`** — the per-drive index. Bytes are shared; the index is per-drive, because **only a
  drive's own manifest is authoritative for that drive** (INV-6) — which is also why there is no
  region-level pack. Two drives down the same corridor share bytes instead of holding two copies.

The store keeps **bytes, not URLs**: presigned R2 URLs expire, and a drive's manifest carries them
inline, so a download needs no separate sign call.

## Connectivity

One app-wide answer to "does this device have a network right now", governed by a stated asymmetry:
**a false OFFLINE verdict is catastrophic** (every request short-circuits and the app is bricked with
signal in hand); a false ONLINE verdict costs only the request timeout already paid. Every choice in
the module follows from that.

Why it exists at all: without it, "you're offline" is indistinguishable from a 500, and every
dead-zone fallback only fires after the full request timeout. A Tahoe cold start was ~15 s of
skeletons before falling back to saved drives, then ~15 s more on tap.

⚠ `expo-network` is used, but **only** `addNetworkStateListener`. `getNetworkStateAsync()` and
`useNetworkState()` are deliberately never called, and the listener must be armed early in
`index.js`, beside the import.

## Auth, and the anonymous mint

Better Auth's Expo client (`auth.ts`), sessions in `expo-secure-store` with **device-only** keychain
accessibility — the token is not migrated to a new device on restore and is not synced to iCloud
Keychain, so it survives neither an uninstall/reinstall nor a leak to another device. Deep-link scheme
must match `app.json` and the server's trusted origins.

The app mints an anonymous session at open (D16), but it is **a convenience, never a precondition**:
`planner.ts` does not import `authClient`, so `POST /drives/plan` sends no cookie by construction, and
`/drives/propose` is open to anonymous — a mint that never lands degrades to exactly nothing. ⚠ Two
rules follow: nothing may grow a dependency on it having succeeded, and nothing may persist state
keyed on the id it produces, because that row is hard-deleted at link with no cascade (INV-4).

⚠ On the client, session truthiness is **not** "signed in" — an anonymous session is truthy. Every
check goes through the one helper that excludes `isAnonymous`, mirroring the server's `tierOf`.

## Location priming

`useLocationPriming` is the shell every live-GPS entry runs before it can start:

1. A double-tap guard (a pending ref) so the status read / OS prompt cannot re-fire while one is in
   flight.
2. Read foreground status **without prompting**.
3. First time only (undetermined): show a pre-permission explainer, **then** iOS's one-shot prompt.
   ⚠ That explainer has **no "Not Now" button** — App Store 5.1.1(iv) forbids one.
4. Already decided → request straight through, no OS UI.

No location is requested anywhere in the pre-drive flow. Background updates are a separate, deferred
escalation (`docs/designs/background-location-spec.md`); the drive holds the screen awake via
`expo-keep-awake` because foreground `watchPositionAsync` dies on lock.

## Design system — "Trailhead 89"

`theme/tokens.ts` (raw palette, two moods: DAY aged map-paper, DUSK the park at night) →
`theme/theme.ts` (semantic light/dark color roles) → `ui/` (primitives plus "smart" composites like
`AccountGate`, `StateView`, `VersionGate`). Screens compose `@/ui` and semantic roles; never a raw
hex, rgba or `fontFamily`.

Enforced, not merely documented:
- `bun run lint:tokens` fails on a raw color or font anywhere in `app/` or `src/ui/`.
- A contrast unit test asserts every text role clears 4.5:1 in **both** themes.
- Mobile `bun run check` = `lint:tokens` + `typecheck` + `test`, and touching `apps/mobile` means
  running it *in this workspace* as well as at the root.

In-car legibility footgun-killers are baked into the role set rather than left to reviewers:
`amberToken` is a fill/shape color with intentionally **no** "amber text on surface" role (warm accent
text uses `accentWarm`), and `primaryFill`/`onPrimary` flip together by theme so they cannot be
mismatched. Icons are **vector** (`@expo/vector-icons` via `ui/Icon.tsx`), never emoji — there is no
color-emoji fallback and emoji render as tofu.

Full rules: `apps/mobile/CLAUDE.md` (loads when working there) + `apps/mobile/DESIGN.md`.

## Analytics, and the privacy invariant

PostHog (`analytics.tsx`), covering product analytics, JS crashes (uncaught exceptions + unhandled
rejections) and **native** crashes, with dSYM / source-map upload at build time via EAS env vars.

The event map is a **closed typed contract** — every property is a number, a boolean or a closed
union. As of this writing: `planner_ready`, `plan_turn_sent`, `proposal_shown`, `preview_clip_played`,
`sample_played`, `wall_shown`, `signup_completed`, `drive_created`, `drive_started`,
`font_load_failed`.

⚠ **INV-13 applies to analytics exactly as it applies to logs**: no rider prose, no place name, no
coordinate, no URL, no drive id. A property that does not typecheck against the map is a signal to
drop the property, not to widen the map. `identify()` is banned at the SDK level. The invariant is
restated in `planner.ts`, `say-buffer.ts`, `planner-transcript.ts`, `anon-session.ts`,
`region-cache.ts` and `app/index.tsx`.

⚠ `preview_clip_played` is emitted **twice per clip on purpose** — once at start with
`completed: false`, once at the end with `completed: true`. The funnel step is satisfied by the first;
the completion *rate* is the ratio. Collapsing it to one event at the end would erase every abandoned
clip, which is the half worth measuring.

⚠ **The funnel ends at `drive_started`.** There is no event for a stop firing, a clip playing on the
road, a stop skipped for missing audio, or a drive completing — so the measured part is everything
*before* the thing the app exists to do. Filed as PostHog Stage 4 in TODO.md.

## Smaller modules worth knowing exist

- **`region-cache.ts`** — the last good `GET /regions` answer on disk, so offline and outage states
  can name real places instead of only apologising. ⚠ Stores **public place names only** — no
  transcript, no anchor ids, no coordinates. An endpoint is named on the wire by anchor id and only
  the server holds that mapping (INV-1); a cached display string must never be turned back into one.
- **`licenses.ts`** — the one home for the data-source attribution catalog behind `app/legal.tsx`. It
  was served by an API endpoint until the 1.1 sweep; the app still had to bundle a byte-identical
  fallback (a legal page must render in a dead zone), so the release was never actually avoided and
  two copies that can disagree is strictly worse than one that cannot. ⚠ Per-clip attribution is
  frozen on the narration row at generation time — this is the catalog, not the credit.
- **`postcards.ts`** — WPA-style poster art for the sample screen, keyed by the clip's QID so it can
  never show the wrong place; an unmapped QID falls back to a generic frame rather than mislabeling.
  Deliberately illustration, not an AI photo: a faked photo of a real landmark fights the
  never-invents doctrine; a stylized poster does not claim to be real.
- **`labels.ts`** — brand-voiced text for domain enums, mapped at the view boundary. DTOs keep raw
  enum values; screens never show them.
- **`sim-mode.tsx`** — a developer toggle that swaps every real-GPS path for the simulated source,
  persisted to secure-store and read at startup. Does not touch the anonymous preview (already
  GPS-less) or any generation parameter.
- **`connectivity-util.ts` / `gps-util.ts` / `offline-util.ts`** — the pure halves; the first place to
  look when changing behavior, because that is where the rules live.

## Where it is fragile

- **The conversation cannot survive an unmount.** Intended (founder, 2026-08-02), logged in TODO.md
  so the cost stays visible. The inline-rendering constraint on `app/index.tsx` follows from it.
- **A missing clip is silent by construction**, and nothing measures it. The 400 ms no-note path plus
  the absent in-drive analytics means a `clip-store` regression is invisible from both ends at once —
  a drive that plays 3 of 11 stops looks exactly like a quiet stretch of road.
- **Hooks are untestable by construction.** Logic that matters must move into a pure module or it
  ships uncovered; the two audio watchdogs are the current examples.
- **Process-wide audio mode** means any new surface that plays sound can silently break another one's
  focus, and the symptom (a clip that keeps talking after you leave) appears somewhere else entirely.
