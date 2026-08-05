# `apps/mobile` internals

**Status:** Snapshot — 2026-08-02, **partly re-read and corrected 2026-08-05** for the
download-before-start build (`docs/designs/download-before-start.md`): a live drive is gated on a
complete local copy, a drive's audio is only ever played from disk, the whole re-sign path is gone,
and `?mode` is retired in favour of the `simMode` setting. The sections that moved say so; everything
else is still the 2026-08-02 read. **Derived and it will drift** — the code wins,
`apps/mobile/CLAUDE.md` + `DESIGN.md` own the
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
| `app/sign-in.tsx` | The account wall's destination |
| `app/settings.tsx` | Theme, account, deletion, and the admin-only way into Developer |
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

Owns four things: the trigger engine, the audio player, lock-screen Now Playing, and the fire-queue —
plus, since 2026-08-05, its half of the download gate (see Offline below), which it *refuses* on
rather than merely reports, so a screen that forgot to render it cannot roll an incomplete drive.

**The clock is the GPS fix stream.** Each `GpsFix` runs `engine.update(fix)`; any stop that fires is
queued and played. Critically, **a finished clip returns to quiet and waits for the next GPS trigger
— it never advances by a clip ending.** The drive is driven by the road, not by a playlist.

The source is swappable behind `GpsFixSource` (`gps.ts`; the pure half is `gps-source.ts`):
`simulatedSource` walks **this drive's own route polyline** and emits synthetic fixes on a wall-clock
timer (couch-testable on the iOS Simulator, with a fast scale so a full drive triggers in a couple of
minutes), and `liveSource` wraps `expo-location`'s `watchPositionAsync`. The hooks subscribe to one or
the other and nothing else changes. ⚠ The sim source is **not** a recorded trace and it exercises none
of the mapping pipeline (`replaySource` is the one that replays a real recording) — `sim-mode.tsx`
says the same thing at the definition, because copy that invites trusting a desk pass more than it
deserves is worse than no copy.

**Which one runs is the `simMode` SETTING, not the route.** `?mode` on the play route was retired
2026-08-05: it resolved from three inputs (the persisted toggle, the param, `__DEV__`), so the
*absence* of the param was load-bearing and its meaning flipped with build type. Now
`driveMode = simMode ? 'sim' : 'live'` — one input, one expression, and the deep link
`skipper://drives/<id>/play?mode=live` says nothing because nothing reads it. See the `sim-mode.tsx`
bullet below for the default.

**The stall ladder has two deliberately different paths — and neither is about the network any more,
because a drive's audio is always a local `file://` (see Offline below):**

- **URI present but will not play** (a truncated or undecodable download): **one pass.** Wait
  `LOCAL_CLIP_STALL_MS` (`@skipper/engine`'s `player.ts`), then surface a visible stall note, emit
  `stop_skipped` / `load_timeout`, and skip the stop. Skipping matters: otherwise the clip stays busy
  and the sequential pump — and the end of the drive — hangs forever on silence.
  ⚠ This *was* two passes on `PRE_START_STALL_MS`: wait 12 s, re-sign the url, reload, wait 12 s
  again. There is nothing to re-sign now (the uri is a file on this device; it cannot expire, and
  reloading re-resolves to the identical bytes), so deleting that rung **halved the dead air** rather
  than merely deleting a line.
  ⚠ The short value is a **desk estimate that still owes a real-device check** — the old number was
  generous precisely because expo-audio's status reporting was not trusted here, and if local decode
  state lags the way a stream's did, too short trades dead air for lost stops, which is the worse
  currency.
- **URI missing entirely**: advance after a short timer with **no note**. The stop passes in silence.

⚠ That second path is why `clip-store.ts` calls itself "the module that must never lose a rider's
download": a missing clip is a silent hole *by construction*, on the theory that it is impossible if
the store did its job. The corollary is that a store regression is invisible **to the rider** — they
hear silence and never learn a stop was there. It does reach us: `stop_skipped{reason:'no_audio'}` is
exactly that hole, and it is the one the gate exists to make rare.

⚠ `PRE_START_STALL_MS` (12 s) is **not** dead — it survives for the surfaces that still stream, i.e.
`useRoutePreview`, which plays before a drive exists. (⚠ `GET /sample` was the other such surface and was deleted 2026-08-05 with the onboarding gate.) **"Offline for everything" is a
rule about DRIVE audio; it was never "delete all streaming".**

A separate **post-start** watchdog (`POST_START_STALL_MS`) covers the other half: a clip that started
and then froze, because `expo-audio` fires no `didJustFinish` across an OS interruption. The pure
branch logic for it is `decideStall` in `@skipper/engine`. ⚠ It is not a streaming feature and never
was — call / Siri / Bluetooth-handoff recovery happens to a local file just as readily — so it stays
exactly as it is.

**The player's stop list is tappable for stops the road has already PASSED** (`isReplayable` /
`replayStop`), which is `replayLast` generalized off its hardcoded seq: it feeds the same queue → pump
→ clip-load path, never touches `firedSeqs` or the engine, and marks the clip preemptible so a live
GPS trigger wins — *the road always beats rider-initiated playback*. ⚠ Two halves of that must not be
separated. It refuses unless the queue is quiet, because `replayingSeq` is a single ref set at ENQUEUE
time: allow two queued replays and the second is silently un-preemptible and the road stops winning
(widen it and that ref must become a Set in the same change). And it refuses a seq whose clip is not
on this phone — replaying a silent stop would re-run the no-audio branch and emit a second
`stop_skipped`, inflating the very number that measures the silence. You can't re-hear silence.

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

### The two preview hooks sit on OPPOSITE sides of the offline boundary

They share the pre-start watchdog machinery (`preview-audio.ts`) and the exclusive-focus flip. They do
**not** share the budget, and the reason is the boundary itself.

`useStopPreview` (drive detail, tap a stop) resolves audio through `offline.loadPlayback`'s seq→uri
map — **never `clip.url` directly**, because a downloaded drive nulls every presigned URL on disk, so
a raw `clip.url` read is silently unplayable in exactly the dead-zone case the product exists for.
Since 2026-08-05 that map is **local `file://` and nothing else**: a seq that is absent is genuinely
not on this phone (the auto-download is still running, the copy is partial, or the drive was never
saved), there is nothing to re-sign and nothing to stream, so the hook answers null and the row gets
the unplayable hint. Turning "not yet" into a *saving…* row is the screen's job. Reading a local file,
it takes the short `LOCAL_CLIP_STALL_MS`.

`useRoutePreview` (in-conversation) **still streams, deliberately, and keeps the generous
`PRE_START_STALL_MS`.** It plays *before a drive exists* — before the wall, before a credit, with
nothing on disk to play from — so it is the one place the offline rule structurally cannot reach, and
that is the rule's edge rather than an exception to it. It **has no re-sign path, deliberately**: the
URL arrives on the proposal, and there is no endpoint that could mint a fresh one for anyone (the
owner-only sign route was deleted with the rest of the re-sign path; even while it existed the
anonymous rider — the entire audience for this surface — could not call it). A dead presign is
therefore terminal, and the honest offer is "make the drive", not a retry that cannot work. ⚠ Which
makes *reaching* that terminal state the whole job: it is bounded by a pre-start watchdog on a clock,
not by the vendor populating `status.error` (whose behavior for an HTTP 403 on a remote source is
device-unverified) — which is also why the 12 s budget stays generous here while the drive's shrank.

## Offline: three modules, one job

**The rule, since 2026-08-05: a DRIVE's audio is only ever played from disk**
(`docs/designs/download-before-start.md` §10). Not "the app never streams" — see the boundary in the
preview hooks above.

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

The store keeps **bytes, not URLs**: presigned R2 URLs expire, and a drive's manifest (`GET
/drives/:id`, and the identical shape returned by `POST /drives`) carries them inline, so a download
needs no separate sign call. ⚠ Those manifests are now the **only** way an audio url reaches the app —
the re-sign endpoint they made redundant has been deleted, so nothing can mint a fresh one after the
fact. That is precisely why the copy has to be complete before the drive rolls.

**The gate.** A live drive is available only when this phone holds a complete copy. `decideDriveGate`
(pure, `offline-util.ts`) answers `play` / `needs-download` / `nothing-saved` from three inputs —
online, any-local, missing-count — and **both** the detail CTA and `useDrive` call that one
expression. Two call sites, one expression, on purpose: `skipper://drives/<id>/play` is a real deep
link, so a gate living only on the CTA is not a gate; and authorising on one value while the player
acts on another is the failure this codebase keeps re-learning. ⚠ The gate keys on **completeness,
never on freshness** — `isDownloadStale` / `isDownloadExpired` stay soft, because stranding a rider in
Tahoe over a perfectly good but expired copy is worse than the copy being old
(`offline-freshness-ttl.md`). It also steps aside where it cannot help: offline
with a partial copy still rolls (a missing byte costs one stop, never a drive, and `missingClipCount`
discloses the gap on the ready card); offline with nothing saved is the only hard block.

**The download starts itself at CREATE and survives navigation.** The create handler in
`app/index.tsx` fires it — not the push to the detail screen, which is byte-identical to three *open*
pushes, one of them a rider re-entering a drive they backed out of — and it is fire-and-forget, so
navigating away, or never arriving, does not stop it. A drive is small enough (the measurement is in
`download-before-start.md`) that the copy normally lands while the rider is still reading the
itinerary — which is what makes the gate invisible rather than a wall, and it is the whole reason the
gate is defensible. The `AbortController`, the progress snapshot and a `canceled` tombstone live in a
module-level registry (`activeDownload` / `subscribeDownload` / `cancelDownload`), never in a screen
ref: a rider who backs out to check the map must not return to a drive they still cannot start, and an
explicit Cancel is the only thing that may stop a transfer. ⚠ The tombstone is load-bearing — the abort path is
deliberately silent, which made "the rider cancelled" indistinguishable from "nothing started", and
under an auto-start that ambiguity re-fires the download the instant it is cancelled.

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
`wall_shown`, `signup_completed`, `drive_created`, `drive_started`, `stop_fired`,
`stop_skipped`, `drive_completed`, `font_load_failed`.

⚠ **INV-13 applies to analytics exactly as it applies to logs**: no rider prose, no place name, no
coordinate, no URL, no drive id. A property that does not typecheck against the map is a signal to
drop the property, not to widen the map. `identify()` is banned at the SDK level. The invariant is
restated in `planner.ts`, `say-buffer.ts`, `planner-transcript.ts`, `anon-session.ts`,
`region-cache.ts` and `app/index.tsx`.

⚠ `preview_clip_played` is emitted **twice per clip on purpose** — once at start with
`completed: false`, once at the end with `completed: true`. The funnel step is satisfied by the first;
the completion *rate* is the ratio. Collapsing it to one event at the end would erase every abandoned
clip, which is the half worth measuring.

⚠ **The funnel no longer ends at `drive_started`** — it runs through the drive itself: `stop_fired`
(the heartbeat, emitted on the FRESHNESS edge, never on expo-audio's `playing`, which flips on the
play() intent), `stop_skipped` carrying a closed reason union, and `drive_completed` for an arrival
only — a "Pull over" is an ABANDON, and folding it in would make the number that says "the bet works"
unable to tell finishing from quitting. ⚠ TODO.md still carries the item that asked for these
(PostHog Stage 4); the events are in the code.

⚠ **The skip reasons narrowed on 2026-08-05 and the narrowing is the signal.** `resign_failed` is
gone — it meant "no network here" as distinct from "our audio is broken", and a drive that plays only
from disk cannot have it — and `load_timeout` now means only a truncated or undecodable download.
`DriveStopProps.offline` went with them: it rode `stop_fired`, `stop_skipped` AND `drive_completed`,
and once every drive plays from download it is constant `true` — a dead axis on three funnel events.
⚠ The consequence to keep in view: "does streaming lose stops on real roads?" can no longer be
answered, because the real drive will exercise the gated path. That question closes permanently
unanswered, knowingly (`download-before-start.md` Q3).

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
- ⚠ **`postcards.ts` was DELETED 2026-08-05** with the sample screen. It held WPA-style poster art keyed by the clip's QID so it could
  never show the wrong place; an unmapped QID falls back to a generic frame rather than mislabeling.
  Deliberately illustration, not an AI photo: a faked photo of a real landmark fights the
  never-invents doctrine; a stylized poster does not claim to be real.
- **`labels.ts`** — brand-voiced text for domain enums, mapped at the view boundary. DTOs keep raw
  enum values; screens never show them.
- **`sim-mode.tsx`** — the admin-only developer toggle (Settings → Developer) for **which clock
  drives the GPS**, persisted to secure-store and read at startup so a sim session survives a cold
  start with no live→sim flip race. ⚠ **Exactly one path acts on it** — `app/drives/[id]/play.tsx` →
  `useDrive`, the live drive. It used to say "swaps every real-GPS path in the app", which was true
  while roam was the second one; the Developer screen reads it only to draw its own switch, which is
  the *writer*. Since `download-before-start.md` §11 it is also the ONLY input: the `?mode` param and
  the `__DEV__` "Simulated drive" ⋯ item are both gone. ⚠ It **defaults false everywhere**,
  single-sourced in `DEFAULT_SIM_MODE`, and `__DEV__` must **not** seed it (founder, 2026-08-05): the
  real drive is run from a dev build on a real device, so a `__DEV__` default would silently simulate
  it *and* record no trace, since the admin `TraceRecorder` is gated on `mode === 'live'`. Does not
  touch the anonymous preview (already GPS-less) or any generation parameter.
- **`connectivity-util.ts` / `gps-util.ts` / `offline-util.ts`** — the pure halves; the first place to
  look when changing behavior, because that is where the rules live.

## Where it is fragile

- **The conversation cannot survive an unmount.** Intended (founder, 2026-08-02), logged in TODO.md
  so the cost stays visible. The inline-rendering constraint on `app/index.tsx` follows from it.
- **A missing clip is still silent to the RIDER**, by construction: the 400 ms no-note path advances
  past a stop with no uri and says nothing, so a drive that plays 3 of 11 stops looks to them exactly
  like a quiet stretch of road. Two things now bound it — the gate refuses to start an incomplete
  drive at all, and `stop_skipped{reason:'no_audio'}` means a `clip-store` regression is at least
  visible to *us*. ⚠ It is not visible to the rider, and the in-persona line that would make the
  failure attributable is still unbuilt (`download-before-start.md` §4).
- **Hooks are untestable by construction.** Logic that matters must move into a pure module or it
  ships uncovered; the two audio watchdogs are the current examples.
- **Process-wide audio mode** means any new surface that plays sound can silently break another one's
  focus, and the symptom (a clip that keeps talking after you leave) appears somewhere else entirely.
