# A drive must be SAVED before it can be driven

> **Status:** ✅ **BUILT 2026-08-05** (uncommitted at time of writing; root + `apps/mobile` checks both
> green). Read **§14 first** — an adversarial review found five real defects in the fresh build, two of
> them HIGH, none caught by `bun run check`. ⚠ Still OWED: the real-device check on
> `LOCAL_CLIP_STALL_MS` (2.5 s is a desk estimate; too short trades dead air for LOST STOPS) and Q4's
> `DownloadTask` spike. Everything below is the design record that produced it.
>
> _Original status line:_ 📋 **BUILD-READY spec, founder calls 2026-08-05** — the live drive becomes gated on a
> complete offline copy, and the copy is fetched AUTOMATICALLY at create so the gate is normally
> invisible. Decided after steelmanning both sides against measured download sizes. **Q1 is
> ANSWERED** (founder, same day): auto-download fires regardless of connection type — at ≤11 MB the
> cellular objection does not survive the measurement. Nothing is built yet, and **not to be built
> yet** (founder, 2026-08-05 — hold for the go-ahead). **§10 is the shape**: *a drive's audio is only
> ever played from disk*, retiring an entire server endpoint and the whole re-sign path. **Q1, Q3, N2
> and N3 are all ANSWERED** (founder, 2026-08-05) — fire on any connection; don't wait for the real
> drive; an old unsaved drive auditions nothing until saved; sim behaves exactly as live. ⚠ **Q4 is
> the only open call, and it is a SPIKE, not a decision** — three things about `DownloadTask` need
> verifying on a physical device before the transfer primitive can be safely replaced. **§11 rides
> along** (founder, 2026-08-05): `?mode` is retired entirely — the GPS clock becomes a setting, not a
> route.

## The ask

Should starting a live drive require the drive to be downloaded first, as Shaka Guide does?

**Verdict: yes.** The argument that carried it is not the competitor precedent — it is that the
current failure mode is *silent and unattributable*, and the download it protects against is
*measurably tiny*.

## What we do today

Download is optional. Tapping **Start** on an unsaved drive raises a three-way Alert (*Cancel / Save
it first / Start anyway*, `apps/mobile/app/drives/[id]/index.tsx:185`), and streaming is a fully
supported live path — the code comment says "Deliberately NOT a block". A `Save for offline` button
sits on the main path below the Start CTA.

## The measurement that decided it

The eight real saved drives, by their frozen `selection` joined to `narrations.audio_duration_ms`,
sized at the 64 kbps AAC the encoder actually produces:

| Drive | Drive length | Clips | Audio | Download |
|---|---|---|---|---|
| Zephyr Cove → Reno | 61 min | 20 | 23 min | ~11.3 MB |
| Stateline → Tahoe City | 55 min | 18 | 20 min | ~9.4 MB |
| Heavenly Village Way → Incline Village | 36 min | 12 | 13 min | ~6.4 MB |
| Stateline → Emerald Bay | 26 min | 8 | 10 min | ~4.8 MB |
| Emerald Bay → Vikingsholm | 5 min | 2 | 2 min | ~1.2 MB |

The **largest drive we have ever built is 11 MB** — ten to twenty seconds on LTE. And because the
clip store is keyed by narration SUBJECT and shared across drives (`clip-store.ts`), a second drive
down the same corridor frequently costs **zero bytes**.

⚠ This is the number that makes the gate defensible, and it is the number to re-check before
defending it again. It is a property of the *corpus*, not of the design: ~90-second tellings, a
2-minute pacing floor (`DRIVE_MIN_GAP_SEC`) and a 24-stop cap (`DRIVE_MAX_STOPS_CAP`). A future
region with denser stops, longer tellings, or a higher `AAC_BITRATE` moves it. Shaka's tours are
hundreds of megabytes; ours are not, and that is the whole reason we can do what they do without
their cost.

## Why the gate wins

1. **The failure is silent by construction.** When a streamed clip can't load, the player waits
   `PRE_START_STALL_MS` (12 s, `@skipper/engine/player.ts`), tries one re-sign, then drops the stop.
   The rider gets twelve seconds of dead air and no explanation, then sails past Emerald Bay. They
   do not conclude "bad signal" — they conclude the app is broken. A product whose failure mode is
   invisible cannot afford an optional guard.

2. **⚠ The disclosure asymmetry is backwards, and this is the sharpest fact in the argument.** A
   *partial download* tells the rider on the ready card while they are still parked
   (`missingClipCount`, `useDrive.ts:283`). A *streaming* drive reports `missingClipCount: 0` **by
   construction** — every clip has a url at load time, so nothing is knowable until it fails
   mid-drive. The path with the worse and likelier failure is the one with no disclosure at all.

3. **The rider already paid a non-refundable credit** at `POST /drives`. Letting them consume a
   degraded version of the thing they bought, without knowing it is degraded, is worse than a
   fifteen-second wait.

4. **The persona makes a promise the stream can break.** The planner deflects place questions in
   voice — "I'll tell you all about it when we get there" — and that deflection is what manufactures
   the anticipate beat (CLAUDE.md, the live-planner invariant). A stop dropped in a dead zone turns
   the deflection into a broken promise.

5. **Auditioning is already ungated, so the gate costs it nothing.** The couch "simulated drive" was
   cut; auditioning is now the per-stop mini-preview on the detail screen (tap a stop, hear that one
   clip) plus `GET /sample`. Both stream one clip and neither goes near `?mode=live`. The usual
   "don't make them commit before they've heard anything" objection does not apply here.

6. **The category converged on this.** Shaka Guide's support material is titled *"How to Use Shaka
   Guide App Completely Offline"* and instructs riders to download before the trip while on strong
   wifi. They learned it from real customers on real roads.

## The two objections that survive, and what the design owes them

Neither of these is a reason to reverse the call. Both are conditions the build has to satisfy.

**O1 — Our download moment is structurally different from Shaka's.** Shaka sells a pre-authored
catalogue tour bought days ahead at home. We *generate* the drive on demand: the rider may be at a
trailhead, engine running, one bar, having just spent a credit. A naive gate there means *you paid
and now you cannot start* — the worst experience the app can produce, and one the gate would create
rather than prevent. §2 and §3 exist to answer this.

**O2 — A gate cannot deliver completeness by fiat.** Downloading needs network (`runDownload` fetches
the manifest first and throws when offline), and partial downloads exist by design on thin signal.
So "complete or nothing" is not a rule the world will honour; the design has to say what happens
when it can't be met.

## §1 — The gate itself

`startDrive` stops being an Alert and becomes a **state**. The live drive is available only when
`offlineStatus(driveId)` reports `downloaded === true && missingSeqs.length === 0`.

Presentation depends on whether a download is RUNNING, and the two cases are opposite (founder,
2026-08-05 — "once it's ready the start drive button enables"):

- **A download is running** (the normal case, because §3 starts one at create): Start renders
  **disabled, with progress beside it**. This is correct precisely because the rider is not being
  asked to *do* anything — they are being asked to wait ten seconds, and a control that turns itself
  on is a truer description of that than a button that swaps identity under their thumb.
- **No download is running** (it failed, was cancelled, or §2 says we cannot): Start must **not** be
  a dead disabled button. The CTA becomes the actionable thing — retry the save, or §2's honest
  offline message. ⚠ A disabled control with nothing running and no explanation is the worst version
  of this feature; that is the case the "never disable" instinct was actually about, and it is the
  only case where it applies.

The secondary `voice.offline.save` button collapses into this, which also recovers a row of screen
the itinerary wanted.

⚠ **SUPERSEDED by N3 and §11** — kept because the reasoning is the record of how the gate moved.
This section originally scoped the gate to the `?mode=live` push and exempted "the dev simulator
(`?mode=sim`, header ⋯ menu)". **Two things about that were wrong.** N3 established the gate must key
on the DRIVE, not the mode (sim behaves exactly as live). And ⚠ **there is no `?mode=sim` producer
anywhere in the app** — a scout pass confirmed the ⋯ item at `index.tsx:338` pushes a BARE `/play` and
relies on `__DEV__` to be read as sim, which is precisely the defect §11 retires the param over. The
mini-preview stays ungated in the sense that it needs no download DECISION — but under §10 it plays
only what is on disk (N1).

## §2 — The one place the gate steps aside

**The gate never blocks a rider it cannot help.** It exists to stop an *avoidable* stream; where a
download is impossible, blocking is pure loss and buys nothing.

| Device | On disk | Behaviour |
|---|---|---|
| Online | complete | Start (the normal case) |
| Online | partial or absent | **Gate holds** — this is the case the gate is for |
| Offline | partial | **Start allowed**, `missingClipCount` discloses the gap on the ready card |
| Offline | nothing | Start blocked, message says *you're offline and this isn't saved* |

The offline-with-partial row is what keeps O1 from becoming a rider standing at a trailhead with 19
of 20 stops on their phone and no way to hear them. It also keeps the app's existing stance intact —
`listDownloadedDrives` keeps a 39-of-40 drive, `loadPlayback` serves a partial map rather than
error-walling, "a missing byte costs ONE STOP, never a whole drive" (`offline.ts`). ⚠ Do not
"simplify" this table into a bare completeness check: that single change is what converts the gate
from a guard into the failure it was meant to prevent.

The offline-with-nothing row blocks, and honestly: streaming with no signal produces a fully silent
drive, so there is nothing to allow.

Reads the app-wide connectivity verdict (`connectivity.ts`), which fails OPEN — an unknown verdict
reads as ONLINE. ⚠ That asymmetry is correct here too, but note it points the *strict* way for this
gate: a device that cannot tell will be gated. Acceptable, because the cost is a download that
succeeds; the reverse default would let a false-offline reading wave every stream through.

## §3 — What makes the gate humane: start the download at CREATE

**DECIDED (founder, 2026-08-05).** Not an alternative to the gate — the thing that stops it being a
wall, and the difference between a gate that fires constantly and one that almost never does.

`POST /drives` already pushes the rider to the detail screen (`app/index.tsx:327`), and they are
provably online (they just completed the planner conversation and a create). Fire the download
automatically on the first mount of a freshly-created drive. An 11 MB drive finishes while they read
the itinerary; by the time they reach the CTA, Start has enabled itself and the gate is invisible.

**Fires on any connection.** Q1 answered: at ≤11 MB, cellular is not a cost worth a prompt. Size
disclosure stays as courtesy — `assertFreeSpaceFor` already estimates bytes from clip durations
(`download.ts`, `APPROX_BYTES_PER_SEC`), so "~11 MB" renders without a new source of truth — but it
is a label, never a gate, and never a "download over cellular?" dialog.

### ⚠ "Background" means two different things, and only one of them covers the real scenario

The founder's requirement is that the download not be cancelled by navigation. That is the *cheap*
half. Read the pinned `expo-file-system@57.0.1` type surface (the authority for this version, read
from the installed package rather than from memory):

**(a) Surviving NAVIGATION — nearly free, and mostly already true.** `downloadDrive` keys its
in-flight promise in a MODULE-level `inFlight` map (`offline.ts`), so the transfer is not owned by
the React tree at all. The only thing that kills it is the screen's own unmount cleanup —
`downloadAbort.current?.abort()` (`index.tsx:217`, audit #816). Under a gate that cleanup inverts
from tidy to wrong: a rider who backs out to check the map returns to a drive they still cannot
start. Fix: hold the `AbortController` in a module-level registry keyed by driveId instead of a
component ref, and stop aborting on unmount for an AUTO download. ⚠ Keep the manual cancel working —
a rider who taps Cancel must still cancel.

**(b) Surviving APP SUSPENSION — the one that actually matters here, and it costs a migration.**
The real sequence is: create the drive, lock the phone, walk to the car, mount it. iOS suspends the
app in the middle of that. Navigation-survival does nothing for a suspended app, so the gate would
block a rider whose download was 80% done when they pocketed the phone — the exact failure the
auto-download exists to prevent, arriving by a different door.

- Today's primitive is `File.downloadFileAsync` (`download.ts`), whose `DownloadOptions` has **no**
  `sessionType` field at all — so there is no declared background continuation on that path.
- `DownloadTask` (exported from the same package) takes `DownloadTaskOptions` with
  `sessionType?: 'background' | 'foreground'`, **defaulting to `'background'` on iOS**: *"the native
  transfer may continue after the app is suspended."* It also carries `pause()` / `resumeAsync()` and
  a persistable `DownloadPauseState` via `savable()` / `fromSavable()`.
- ⚠ The documented ceiling, verbatim: *"the JavaScript `DownloadTask` instance is not restored if the
  app is terminated or relaunched, so its promise, progress callbacks, and cancellation state are
  only available while the original JS runtime is still alive."* So background survives SUSPENSION,
  never TERMINATION. Termination is already survivable a different way — the downloader is a top-up
  judged by what is on disk, so a re-run finishes the job — and that property must not be traded away
  for the new API.

⚠ **The cost is concentrated in the one module that must not fork.** `download.ts` opens by saying a
hardened downloader "must not exist twice and drift" — so adopting `DownloadTask` means *replacing*
`downloadFileWithRetry`, not adding a second path beside it, and re-establishing every guard on top:
the 3-attempt retry ladder, the exponential backoff, the nonzero-size verify, and the inner/outer
abort split that distinguishes a per-file timeout from a real cancel. ⚠ `CLIP_DOWNLOAD_TIMEOUT_MS`
also changes MEANING — a 30-second per-file budget is incoherent for a transfer deliberately allowed
to span a suspension, so that constant needs a new definition, not a new value.

This is Q4 in §8. The gate is shippable on (a) alone; whether it SHOULD be is the open call.

## §4 — The silence is a defect either way

Even a gated drive can lose a stop: a byte goes missing after download, or §2's offline escape hatch
lets a partial copy roll. Twelve seconds of unexplained dead air is wrong on every path. An
in-persona line for a stop that could not load — said once, in voice, never as a mid-drive
interruption at each stop (the in-car doctrine forbids that, and `missingClipCount`'s comment already
argues it) — makes the failure *attributable*. Attributable failure does not damage the product the
way silent failure does. Independent of the gate; worth doing regardless of §8's answers.

## §5 — What this does NOT change

- **Stale and expired stay SOFT.** `isDownloadStale` and `isDownloadExpired` never block playback and
  must not start. ⚠ Making expiry blocking would strand a rider in Tahoe over a perfectly good
  31-day-old copy — `offline.ts` refuses this explicitly and `offline-freshness-ttl.md` is the
  record. The gate keys on **completeness**, never on freshness.
- **Partial-tolerance everywhere else.** `presentSeqs` and `listDownloadedDrives` are untouched — a
  partial copy still lists, still loads, still plays what it has.
  ⚠ **CORRECTED 2026-08-05.** This bullet originally also named `loadPlayback` and `resignPlayback` as
  "untouched". That was written before §10 and is **WRONG**: §10 deletes `resignPlayback` whole and
  deletes `loadPlayback`'s online branch. The bullet is about the partial-tolerance STANCE, which
  survives; it was never about those two functions. Left visible rather than quietly reworded because
  a scout pass found it and flagged that anyone reading §5 alone would preserve them.
- **The credit.** It is spent at `POST /drives`, before any of this. The gate can never produce "I
  paid and got nothing" — only "I paid and must wait", which is recoverable. Worth stating because
  the opposite is the intuitive fear.
- **The anonymous preview** (`GET /sample`, the one route-preview clip) is nowhere near this path.

## §6 — Copy

The alert disappears, and with it `voice.offline.unsavedTitle` / `unsavedBody` / `unsavedSave` /
`unsavedStart` — ⚠ `'Start anyway'` is *deleted*, not relocated; leaving that string alive is how a
gate quietly grows a bypass. New strings needed: the gated primary CTA, the offline-and-nothing-saved
block, and the size disclosure. Keep the road idiom and the existing "Signal's thin out there"
phrasing — one road, one voice.

## §7 — Instrumentation

Track when the gate blocks and what the rider does next (downloads / leaves / abandons). Without it
there is no way to tell whether the gate cost the funnel, and the whole case rests on a claim about
rider behaviour we have not yet observed. PostHog is the demand instrument. Pairs with the existing
`stop_skipped` reason, which is what would show the gate working.

## §8 — Open founder calls

These are the reason the doc says *build-ready spec*, not *build it*.

**Q1 — Does the auto-download in §3 fire on cellular? ✅ ANSWERED (founder, 2026-08-05): YES,** on any
connection, with no prompt. The measurement is what settled it — at ≤11 MB the cost is under a minute
of streaming video, and not firing would have blocked nearly every FIRST drive, since riders create
drives in the car. ⚠ Kept here rather than deleted because the answer is downstream of a number: a
denser region or a higher `AAC_BITRATE` reopens it.

**Q2 — What happens when a download is online but *terrible*?** §2 covers offline; it does not cover
one bar. `CLIP_DOWNLOAD_TIMEOUT_MS` is 30 s across `CLIP_DOWNLOAD_ATTEMPTS` (3) *per clip*, so a
20-clip drive on a dying connection can grind for minutes and still land partial — and the rider is
gated the whole time. Options: a time-boxed "this isn't working — start anyway" after N seconds of no
progress; treat a stalled download as §2's offline row; or hold the gate and accept it. ⚠ This is
where O1 actually bites, and no answer here is free.

**Q3 — Does the gate ship before RISK-1's real drive, or after? ✅ ANSWERED (founder, 2026-08-05): do
NOT wait for the drive** — build on the argument. Accepted knowingly: the guard ships without the
evidence that would have sized it, and Q5 explains why that evidence cannot exist yet. ⚠ The
consequence to keep in view is that the real drive will then exercise the GATED path, so it can no
longer answer "does streaming lose stops?" — that question closes unanswered, permanently, and the
`load_timeout` / `resign_failed` reasons that would have answered it are among the things §10 deletes.
That is an acceptable trade for a guard we believe in; it is not a free one.

**Q4 — Does the gate ship on navigation-survival alone (§3a), or wait for the `DownloadTask`
migration (§3b)?** §3a is a small, contained change to where an `AbortController` lives. §3b replaces
the hardened transfer primitive in `download.ts`. The scenario that separates them is not exotic — it
is *lock the phone and walk to the car*, which is what riders do between creating a drive and driving
it. Shipping (a) alone means the gate is correct at the screen and wrong at the lock button. ⚠ Do not
answer this from the download's *duration* ("it's only ten seconds, they won't lock the phone in
time") — the ten seconds is a good-signal number, and the rider most likely to pocket the phone
mid-transfer is the one on thin signal, who is also the one the gate exists for.

### Q4 elaborated — what the `DownloadTask` migration actually involves

**What we swap.** `downloadFileWithRetry` (`download.ts`) currently loops `CLIP_DOWNLOAD_ATTEMPTS`
over `downloadOnce`, which wraps `File.downloadFileAsync(url, dest, { signal })` in a 30 s inner
`AbortController`, verifies `exists && size > 0`, deletes `dest` between attempts, backs off
`400 ms × 2ⁿ`, and treats the OUTER signal as terminal while an inner timeout stays retryable. The
replacement is `new DownloadTask(url, dest, { sessionType: 'background', onProgress, signal })` +
`await task.downloadAsync()`. Every guard above has to be re-established on top of it — ⚠ and
`download.ts` opens by saying a hardened downloader "must not exist twice and drift", so this is a
REPLACEMENT, never a second path beside the first.

**⚠ Three things must be VERIFIED before the design is decidable. Guessing any of them writes a bug
into the one module that cannot have one.**

1. **Behaviour when `dest` already exists is UNSPECIFIED in the types.** `DownloadOptions` carries an
   `idempotent` flag; **`DownloadTaskOptions` does not.** Our retry ladder deletes between attempts
   *precisely because* `downloadFileAsync` rejects on an existing destination, and
   `transferSharedClip`'s temp-and-move dance is built on the same assumption. If `DownloadTask`
   silently overwrites instead, the shared-store collision reasoning changes.
2. **That a real suspension actually continues the transfer** — and ⚠ **this cannot be tested in the
   iOS Simulator.** Background `URLSession` behaviour needs a physical device. (A device, note, not a
   *drive* — this is unaffected by Q3.)
3. **What `onProgress` reports across a suspension.** The progress UI and the §1 CTA both hang off it;
   a callback that goes silent for the suspended interval and then jumps is a different UI problem
   from one that simply pauses.

**⚠ `CLIP_DOWNLOAD_TIMEOUT_MS` changes MEANING, not value.** A 30-second wall-clock budget is
incoherent for a transfer deliberately allowed to span a suspension — a phone left locked for twenty
minutes would trip it every time. It has to become either a foreground-only stall detector (no
`bytesWritten` progress for N seconds *while the app is foregrounded*) or nothing at all. Renaming it
is part of the change; leaving the name with new semantics is how the next reader gets it wrong.

**⚠ Do NOT reach for `savable()` / `fromSavable()`.** They persist `resumeData` and would, in
principle, carry a transfer across app TERMINATION — which `sessionType: 'background'` explicitly does
not ("the JavaScript `DownloadTask` instance is not restored if the app is terminated or relaunched").
But we are **already termination-tolerant by a simpler route**: the downloader is a top-up judged by
what is on disk, so a re-run finishes the job and never re-fetches what landed. Adding persisted
resume state buys a marginal saving and a second source of truth about in-flight bytes — the exact
shape this codebase has been burned by. Named here so nobody builds it reflexively.

**Android** accepts `sessionType` and ignores it (no background continuation). iOS-only for now, so
this is a note, not a blocker.

**Recommendation: run §3b as a SPIKE before committing it to the §10 build.** The three
verifications above are a device-afternoon; the design falls out of their answers. Ship §10 on §3a
(navigation survival), and let the spike decide whether §3b lands with it or follows.

**Q5 — Is there evidence streaming actually loses stops today? CHECKED 2026-08-05 — the instrument is
right, the data is structurally absent.**

- **The instrument is well-shaped for exactly this question.** `StopSkipReason`
  (`analytics.tsx:140`) is a closed union that already separates the two causes that matter here:
  `load_timeout` (had a url, never produced audio) and `resign_failed` (the re-sign died — "no
  network here" as distinct from "our audio is broken"), versus `no_audio` (a partial download's gap
  being driven through). `load_timeout` + `resign_failed` filtered to `mode: 'live'` **is** the
  measurement "streaming loses stops on real roads". Nothing needs building.
- **Events do reach PostHog from real builds.** `EXPO_PUBLIC_POSTHOG_KEY` is blank in both
  `.env.development` and `.env.production`, so a local dev build is inert — but `apps/mobile/eas.json`
  sets it for every EAS profile, so TestFlight and production builds report.
- ⚠ **But the population does not exist yet.** 1.1 is deployed and NOT released to riders, and
  RISK-1 — drive it once for real — has not happened. So `stop_skipped{mode:'live'}` on real roads
  is empty or near-empty by construction, no matter what the dashboard says.
- Querying needs a PERSONAL API key (`phx_…`); only the public client key is committed. Project
  `517151`.

**⚠ This collapses Q5 into Q3.** The gate cannot be sized by evidence today, because the drive that
would produce the evidence is the same drive that is already the top of the milestone list. Either
ship the gate on the argument alone, or drive first and let the reason-split answer it in one trip.

## §9 — ⚠ The gate does NOT let us delete the streaming path

The intuition is natural — *if a live drive always plays from disk, why keep the streaming code?* —
and it is wrong, because the streaming path has **three owners that are not the live drive**. Written
down because this will be re-proposed.

1. **The mini-preview.** `useStopPreview` calls `loadPlayback` AND `resignPlayback` directly
   (`useStopPreview.ts:97,106`) — that is the detail screen's tap-a-stop audition, deliberately left
   ungated by §1 because it is how a rider hears anything before committing. For an undownloaded
   drive it streams, by design.
2. **Sim mode.** ⚠ Written as "`?mode=sim` runs the same `useDrive`" — **there is no such param**; the
   ⋯ item pushes a bare `/play` and leans on `__DEV__`. The point stands (sim ran the same player over
   presigned URLs), and N3 + §11 settle it: gate the DRIVE, retire the param.
3. ~~**§2's escape hatch.**~~ ⚠ **CORRECTION (2026-08-05): §2 is NOT an owner of the streaming path.**
   Offline-with-partial plays the local partial map — that is `loadPlayback`'s OFFLINE branch. The
   partial-tolerance machinery (`presentSeqs`, `missingClipCount`, the `no_audio` skip reason) and the
   STREAMING machinery are separate things, and listing them together here overstated the cost of §10.
   §2 survives the bigger deletion untouched.

⚠ And the **stall watchdog is not a streaming feature at all** — `stalled_mid_clip` is call / Siri /
Bluetooth-handoff recovery (`POST_START_STALL_MS`), which happens to a local file just as readily.

What the gate ALONE deletes: the unsaved-drive Alert and its four `voice.offline.unsaved*` strings
(§6). That is the whole harvest of §1–§3 — the gate's return is correctness, not line count.

**§10 buys the rest, and the founder asked for it (2026-08-05).** Read §9 as the map of what §10 has
to absorb, not as a verdict against it.

## §10 — Forcing offline for EVERYTHING (founder direction, 2026-08-05)

**The rule, in one line: a DRIVE's audio is only ever played from disk.** Not "the app never
streams" — see the boundary below, which is what keeps this from breaking the front door.

### ⚠ The boundary: the anonymous front door structurally CANNOT be offline

`GET /sample` and the one route-preview clip play **before a drive exists** — before the wall, before
a credit, with nothing on disk to play from. They are the taste that sells the thing. They keep
streaming, and that is not a compromise in the rule; it is the rule's edge. ⚠ Deleting the re-sign
route (below) does not touch them: they are served with the same presign and the same TTL as an owner
clip *deliberately*, precisely because the re-sign route is an owner route an anonymous rider could
never reach (`drives.ts` ~1000). State this boundary in the code, or the next sweep reads "force
offline for everything" and takes the front door with it.

### What it actually deletes — verified by following each caller

| Deleted | Why it can go |
|---|---|
| `loadPlayback`'s online branch | a drive's audio never resolves to https again |
| `resignPlayback` (whole function) | local files never expire, so there is nothing to re-sign |
| `signDriveAudio` (`api.ts:276`) | its ONLY caller is `resignPlayback` |
| **`POST /drives/:id/assets/sign`** (`drives.ts:1633`, JSDoc from 1630) | **a whole server endpoint** — its only consumer is the client function above |
| `loadOwnedSelection` (`drives.ts:1595-1612`) | the route's private lean loader; no other caller, and `apps/api` sets `noUnusedLocals` so leaving it FAILS the build |
| `signedDriveAudio` → `signedStopClip` → `signedClip` (`packages/shared/src/schemas.ts`) | ⚠ **three** orphaned Zod schemas, not one — and they leave via an `export *` barrel, so **nothing lints them** |
| `DriveStopProps.offline` (`analytics.tsx`) | rides `stop_fired`, `stop_skipped` AND `drive_completed`; constant `true` after §10 — a dead axis on three funnel events |
| `urlMapFromDriveSigned`, `urlMapFromDriveManifest` (`offline-util.ts`) | each feeds exactly one of the two branches above |
| `Playback.offline` + the "Playing from download" chip (`play.tsx`) | when EVERY drive plays from download the chip asserts nothing |
| `StopSkipReason.resign_failed` | structurally unreachable |
| the re-sign rung of `useDrive`'s stall ladder (`useDrive.ts:529`) | nothing to re-sign |

⚠ `load_timeout` **survives in a narrower form** — a LOCAL file can still fail to decode. Do not
delete it along with `resign_failed`; that is the "a new gate is blind to some subject kind" trap
wearing a different hat.

⚠ **ERRATA (scout pass, 2026-08-05) — line numbers in this document are unreliable; three were wrong
in ways that would cause damage.** The build ran off a reconciled contracts file instead. The ones
worth correcting in place:
- The sign route is at `drives.ts:1633`, **not 1618**. ⚠ Line 1618 is inside the JSDoc of `GET /:id` —
  the manifest route the entire download path depends on. "Delete from 1618" eats the wrong route.
- The re-sign rung is `useDrive.ts:926-943`; `:529` is the `resign` callback the rung CALLS.
- `missingClipCount` is documented at `useDrive.ts:283` but COMPUTED at `:500`.
- The `__DEV__` "Simulated drive" menu item is `index.tsx:338`; the unmount abort is `:219`.

⚠ The stall watchdog itself STAYS. `stalled_mid_clip` is call / Siri / Bluetooth-handoff recovery
(`POST_START_STALL_MS`) and happens to a local file just as readily. It is not a streaming feature and
never was.

### What it costs — the four things that need answering

**N1 — The mini-preview can only play what is on disk.** `useStopPreview.resolveUri`
(`useStopPreview.ts:97`) currently falls through to `resignPlayback`; under the rule it returns null
until the download lands. On a freshly-created drive that is the ~10 s §3 window, so the stop rows
need a *saving…* state rather than a tap that does nothing.

**N2 — Opening an OLD, undownloaded drive. ✅ DECIDED (founder, 2026-08-05): EXPLICIT SAVE, no audio
until then.** §3's auto-download fires at CREATE only; it does **not** fire on open.

`FREE_DRIVE_CAP` is 50, so a rider cannot hold every drive on disk. Opening drive #37 therefore shows
the itinerary, route and map (all from `getDrive`) with **every stop row unplayable** — not even a
single-stop audition — until they tap Save. The reasoning: 11 MB for a glance, across a browsing
session over 50 drives, is how you quietly fill someone's phone, and spending it without an ask is
the same class of decision the rest of this doc refuses to make on the rider's behalf.

⚠ **The accepted regression, named so nobody "fixes" it later:** *"what was this drive again?"* can no
longer be answered by ear on an unsaved drive. That is a real loss and it was taken knowingly.

⚠ **The tempting fix is "just stream the ONE clip they tapped" — and it is the rule by another name.**
It resurrects `loadPlayback`'s online branch, `resignPlayback`, `signDriveAudio` and the sign
endpoint: every row of the deletion table above, to save one tap. Take the regression or take the
streaming; there is no third answer, and a "just this once" exception IS the streaming answer.

**N3 — Sim mode. ✅ DECIDED (founder, 2026-08-05): sim behaves EXACTLY as live.** And the dive turned
up that this is not merely the price of the harvest — **it closes a hole that exists today.**

⚠ **THE GATE AND THE MODE ARE RESOLVED IN DIFFERENT PLACES, AND THE MODE WINS.** `startDrive` pushes
`?mode=live` from the detail screen (`index.tsx:186`), but `play.tsx:57` RE-DERIVES `driveMode` from
three inputs — the persisted global sim toggle (which "wins over an explicit `?mode=live`"), the query
param, and `__DEV__`. So a gate keyed on `live` **authorises on one value while the player acts on
another**: exactly the "count, authorise, and ACT from ONE expression" failure CLAUDE.md names, in a
codebase that has already been bitten by it twice. Gating the DRIVE rather than the MODE deletes the
second value instead of trying to keep two in sync.

Three consequences, each of which independently justifies the call:

1. **In a dev build, EVERY drive is sim** (`__DEV__` → `'sim'` fallback, `play.tsx:61`). Gate `live`
   only and *none of our simulator QA ever exercises the gate* — we would ship a guard we had never
   once run. ⚠ This is precisely the "a new gate is blind to some SUBJECT KIND — name which before
   shipping" trap; the answer here is that it would be blind to every drive we ourselves test.
2. **The sim toggle is a bypass.** It is admin-only (`isAdmin`, server-set role, self-guarded in
   `developer.tsx:61`), so no rider can reach it — but WE can, which means our own passes would run
   the ungated path while riders ran the gated one. Green on ours proves nothing about theirs.
3. **⚠ The player is reachable WITHOUT the detail screen.** `app.json` sets `scheme: "skipper"` and
   expo-router maps file routes to deep links, so `skipper://drives/<id>/play` should land straight in
   the player — where a MISSING mode resolves to `'live'` in a release build. A gate that lives only
   on the CTA is bypassed by that. (Verify this in 60 seconds before building; the fix is the same
   either way.) ⚠ Note `associatedDomains` is `webcredentials:` only — no `applinks:` — so this is the
   custom scheme, not an https universal link.

**So the gate lands in TWO places, keyed on the same one expression:**
- **the CTA** (`index.tsx`) — so the rider is told *why*, and can act on it;
- **the player** (`useDrive` / `play.tsx`) — so it is TRUE regardless of how the screen was reached.

Both ask the same question — *does this drive have a complete local copy?* — and neither asks about
mode. `driveMode` then means only **which clock drives the GPS**, which is all `analytics.tsx:130`
ever claimed it meant.

**Cost:** our own QA downloads before it simulates — ~10 s in the simulator, once per drive, and free
for the second drive down a corridor thanks to the shared store. Small upside: sim QA becomes
network-independent after that first pull. ⚠ The `sim-qa` skill's flow needs updating with it.

**N4 — Nothing here touches §2.** Offline-with-partial still rolls off the local map. See the §9
correction.

### Why this is worth considering, stated plainly

It replaces a *conditional* ("play local if complete, else stream, else fall back to partial local")
with an *invariant* ("a drive's audio is local"). The conditional is the shape that produced the
silent-skip class of bug in the first place, and every branch of it is a state someone has to hold in
their head. An invariant is enforceable, testable, and explainable to a rider in one sentence. That
is a better return than the line count.

## §11 — Retire `?mode` (founder, 2026-08-05)

N3 found that the gate and the mode are decided in different places. This is the same finding pulled
one level down: **`?mode` is a REQUEST, not a decision**, and it should not exist.

### What is actually wrong with it

`play.tsx:57` resolves the mode from THREE inputs — the persisted global sim toggle, the query param,
and `__DEV__` — and the param is the weakest of them. Two things follow, and both are worse than they
look:

1. **The ABSENCE of the param is load-bearing, and its meaning flips with build type.** No `?mode`
   means `'sim'` in a dev build and `'live'` in a release build.
2. **Neither producer names what it wants.** There are exactly two push sites in the app:
   `/play?mode=live` (the Start CTA) and — ⚠ — **`/play` with NO param at all** for the `__DEV__`-only
   "Simulated drive" ⋯ action (`index.tsx:335`). So *the simulated drive never says "sim"*. It says
   nothing and relies on `__DEV__` to be read as sim. A button labelled "Simulated drive" is one guard
   removal from starting a REAL GPS drive, and nothing about the call site would look wrong.

So no producer can know what will play, and no reader of a push site can tell either. That is the
same authorise-here / act-there shape as N3, encoded in a URL.

### The replacement: the GPS clock is a SETTING, not a route

```
driveMode = simMode ? 'sim' : 'live'      // one input, one expression
```

`/drives/[id]/play` becomes one route with one meaning. Consequences:

- **The deep-link bypass closes structurally**, not by adding a check — `skipper://…/play?mode=live`
  stops being able to say anything, because nothing reads it.
- **⚠ `__DEV__` moves to the DEFAULT of the setting, never into the resolution.** `readStoredSimMode()`
  falls back to `__DEV__` instead of `false`. A fresh dev build still simulates — which is WHY the
  fallback exists: the iOS Simulator's GPS is static, so a live drive there never triggers a stop —
  but the player itself carries no build-type branch. The environment picks a *default value*; it does
  not participate in *deciding*.
- **The two sim controls collapse into one.** Today the global toggle AND the `__DEV__` ⋯ item both
  produce a sim drive, and they do not agree (see below). Two controls for one boolean is how they
  drift; keep the Settings → Developer toggle (already admin-gated and persisted) and delete the menu
  item, or make the menu item flip that toggle rather than encode mode in a push.

### ⚠ The detail that must not be lost in the collapse: `defaultFast`

`play.tsx:66` passes `defaultFast: simMode` — deliberately, so a drive reached by the GLOBAL toggle
replays FAST (couch-testing a full drive at 1× is impractical) while the `__DEV__`-fallback sim stays
REAL-TIME so trigger-timing tests are unchanged. That distinction is currently carried by *how sim was
reached*, which is exactly the thing §11 deletes.

⚠ **This is the same bug class one more time: a value inferred from another value's provenance.**
Replay speed is a replay concern and was never a mode concern. It needs to become its own persisted
flag next to the sim toggle — otherwise collapsing the two sim flavours silently makes every
trigger-timing test run fast, and nothing fails.

### Rejected: separate routes (`/play` + `/simulate`)

Explicit and typed by expo-router, but it contradicts N3 — if sim behaves exactly as live, two routes
assert a difference that no longer exists. It also ADDS a deep-linkable sim surface rather than
removing one, and a new `app/*.tsx` needs the router-typegen dance before `tsc` goes green.

## §12 — Player-logic dive (COMPLETE, 2026-08-05)

**Scope covered:** the engine's decision layer (`trigger.ts`, `player.ts`), the fire queue and pump,
pause semantics, the stop list, the clip-load effect and stall ladder, the audio session and
interruption handling, the GPS pipeline and end predicate, the music bed, and drive-end accounting.

**Verdict: five things worth acting on, and no defects in the safety-critical core.** Three separate
hypotheses — a phone call silencing the rest of a drive, a preview/drive session race, and a drive that
never ends when GPS fails near the finish — were each already answered by design at the definition
site. ⚠ That is the durable lesson of this pass, and it is the reason §12.7–§12.9 exist at all: the
riskiest thing here is not a missing guard, it is a future "simplification" removing one whose reason
is invisible from the call site. Four of the nine sub-sections below record a REASON, not a change.

**Actionable:** §12.3 (tappable list, passed stops only, with two generalization traps), §12.5 (stall
ladder collapses; threshold to ~2–3 s after a device check), §12.6 (`clipRetried` single-seq delete),
§12.2 (pause is a COPY fix, no mechanism change), §12.9 (fix a misleading comment).

Findings are about
the PLAYER, not the gate — recorded here because they are the same silent-hole family the gate exists
to close, and two of them survive §10 untouched.

### §12.1 — ⚠ The build enforces a lag bound the RUNTIME does not

`DRIVE_MAX_LAG_SEC = 45` (`drive-select.ts`) drops, at BUILD time, any clip that would start more than
45 s after its trigger — stated principle: *silence beats a clip playing far behind the car*. At
PLAYBACK there is no counterpart: `decidePump` only ever waits / plays / finishes / idles, and
**nothing is ever dropped for being late.** The build-time bound assumes clips play back-to-back from
their triggers with no stalls, no replays and no pauses.

⚠ **Why this is not cosmetic: the narration is DEICTIC by design.** `persona/skipper.ts` sanctions
"coming up" and "just out there", tells the skipper to *gesture at it out the window*, and a BREAK
stop says there is a place to pull off **coming up**. A late clip therefore asserts something false
about where the rider is, and a late break stop directs them to pull over somewhere already behind
them. ⚠ Note §10 *helps* here — a local file cannot stall on the network — so the remaining runtime
deviations are pause, replay, and sim-fast.

### §12.2 — Pause: the MECHANISM is right, the LABEL is wrong

Pausing a live drive calls `sub?.remove()` (`gps.ts`), releasing the GPS watch to save battery and
re-acquiring on resume. So while paused the car keeps moving, no fixes are processed, and every stop
passed never enters the trigger engine at all — not fired, not retired, invisible to `stop_skipped`
(whose reasons are all about AUDIO, not about never triggering).

**Category check (2026-08-05):** Shaka Guide ships exactly this behaviour and NAMES it — a **"Tour
Switch"** riders are told to turn OFF for a long stop, described plainly as *stopping the app from
using your GPS*, with the tour "picking up where you left off" on resume. GuideAlong: "stop and enjoy,
or bypass anything you want — the tour will start back up automatically."

⚠ **So the fix is COPY, not mechanism.** "Pause" implies pausing audio; the control actually suspends
the tour. Renaming/reframing it to say what it does is cheaper and more honest than keeping GPS alive
(battery), playing stale clips (§12.1), or ending the drive. **No mechanism change.**

### §12.3 — The player's stop list becomes TAPPABLE for PASSED stops (founder, 2026-08-05)

Reverses the `play.tsx` comment "read-only on the drive (auditioning per-stop is the drive-detail
mini-preview)". ⚠ That was a comment's judgement call, **not** the written doctrine, and three facts
say the doctrine permits it:

1. DESIGN.md §8 requires ≥48pt hit targets — and `STOP_ROW_HEIGHT = hit.min` (`StopRow.tsx:30`), i.e.
   the rows are already exactly the minimum tap target, and already tappable on the detail screen.
2. The player already carries a **draggable** `Scrubber` plus ±15 s seek — strictly harder in-car
   interactions than a 48pt row tap.
3. ⚠ **The mechanism already exists.** `replayLast` (`useDrive.ts:654`) IS this operation with a
   hardcoded seq: it pushes onto the same queue → pump → clip-load path, deliberately does NOT touch
   `firedSeqs` or the engine, and sets `replayingSeq` so **a live GPS trigger preempts it**. That last
   rule — *the road always beats rider-initiated playback* — generalizes for free.

**Scope: PASSED stops only.** Two reasons, one product and one mechanical:
- The category does not offer play-ahead. Shaka states tours run one direction and riders should
  follow the numbers **in chronological order**; its manual affordances are off / bypass / rejoin.
- ⚠ **Mechanical:** `replayLast` does not touch the fired set — deliberately — so a stop played EARLY
  would still fire again on approach and the rider would hear the identical clip twice. Making
  play-ahead safe would mean retiring the stop on tap, which spends the anticipate beat the planner
  manufactures ("I'll tell you all about it when we get there") on a rider who did not know that was
  the trade.

**Timing: match `replayLast` exactly** — a tap works in the between-stops quiet, never over a playing
clip. One mechanism, no new preemption semantics.

⚠ **And that guard is load-bearing for a reason easy to miss when generalizing.** `replayingSeq` is a
single `useRef<number | null>`, set at ENQUEUE time (`useDrive.ts:662`) even though its comment says
"while a REPLAY is the active clip". That is only sound because `replayLast` refuses unless the queue
is quiet, so the pushed seq becomes active immediately. **Drop the quiet guard — let a rider tap two
passed stops in a row — and one ref must mark two queued replays, so the second is silently
un-preemptible and the road stops winning.** Keep the guard, or make `replayingSeq` a Set. Do not do
the first half of that generalization without the second.

### §12.4 — Does §12.1 still need a runtime lag bound? Probably NOT, once §10 and §12.2 land

Worth stating so it is not built reflexively. The runtime deviations that could put a clip far behind
the car were: a network stall, a pause, a replay, and sim-fast. After the other decisions:
network stalls largely go (§10 — a local file does not buffer), and pause no longer queues anything at
all (§12.2 — GPS is released, so nothing fires while paused). What remains is **replay** and **tapped
passed stops**, both rider-CHOSEN, and **sim-fast**, a dev artifact. A rider who asks to hear a stop
again is not owed a "too late" refusal.

⚠ So: do not build a runtime lag drop unless a real drive shows one. Revisit only if §10 is descoped —
the streaming stall is what made this reachable, and its removal is what closes it.

### §12.5 — The stall ladder collapses under §10, and its threshold must shrink with it

The clip-load effect (`useDrive.ts:872`) runs a TWO-pass ladder: wait `PRE_START_STALL_MS` (12 s),
re-sign once, reload, wait 12 s again, then skip. ⚠ **So a dead clip costs 24 s of dead air, not 12.**

Under §10 the first pass is a NO-OP: `resignPlayback` returns the local map without touching the
network, so the "retry" re-resolves to the identical file and buys nothing but the second 12 s. §10
already lists that rung for deletion — the point worth recording is that **deleting it is a behaviour
improvement (24 s → 12 s), not merely a line-count win.**

**✅ DECIDED (founder, 2026-08-05): shrink the threshold to ~2–3 s once playback is local.** The 12 s
number is calibrated for a case §10 removes, and its own comment says so — the clips are "64k AAC-LC
over ~1h presigned URLs" and expo-audio surfacing `status.error` for an HTTP 403 on a REMOTE source is
"DEVICE-UNVERIFIED", so the timer had to outlast a stream that buffers forever. A local file either
decodes or it does not. For scale: 12 s is a tenth of `DRIVE_MIN_GAP_SEC`.

⚠ **PRECONDITION, not an assumption — verify on a device before shipping the shorter value.** The
whole reason the current number is generous is that expo-audio's status reporting was NOT trusted
here, and the `sawFresh` freshness check exists because `playing` flips true on the play() INTENT
while a stream stalls (a field-observed failure, "a sheet frozen at 0:00 on thin 5G"). If local decode
state also lags, a 2–3 s cut would skip clips that would have played — trading dead air for lost
stops, which is the worse currency. Pairs with Q4's device session; same afternoon.

⚠ **Single-threshold, not local-vs-remote.** §10 means drive audio has no remote path, so a
conditional here would re-create the branch §10 exists to delete.

### §12.6 — `clipRetried` is cleared WHOLESALE by `replayLast`

`replayLast` does `clipRetried.current.clear()` (`useDrive.ts:660`) — harmless with one hardcoded seq,
but once §12.3 makes the list tappable, one tap resets the retry state for **every** stop in the
drive. Make it a single-seq `delete` when generalizing. (Small, but it is the same "generalize half of
it" shape as the `replayingSeq` trap in §12.3.)

### §12.7 — Audio session + interruptions: SOUND. Recorded because the division of labour is invisible

Examined and found no defect. Written down because the correctness depends on a split across the
native/JS boundary that neither side states, so a future "simplification" would break it silently.

**The split:** on an interruption ending, `expo-audio`'s `handleInterruptionEnded`
(`ios/AudioModule.swift`) calls `AVAudioSession.setActive(true)` **unconditionally**, then resumes
players ONLY `if options.contains(.shouldResume)`. ⚠ iOS frequently WITHHOLDS `.shouldResume` after a
phone call — so the session comes back but the clip stays paused, and it is `decideStall`'s `'resume'`
rung (`useDrive.ts:1047`) that restores playback. **Native owns the SESSION; we own the PLAYBACK.**

⚠ Consequences a future change must not undo:
- Deleting or shortening the post-start stall rung would leave a live drive silent after any call
  where iOS withheld `.shouldResume`, and NOTHING would fail — no error, no skip reason, just quiet.
- `player.play()` in that rung looks like it assumes an active session, which `audio-session.ts`
  explicitly warns against ("every `apply*` turns it on FIRST rather than assuming it is on"). It is
  safe ONLY because the native handler already reactivated. That is worth a comment at the call site.
- A Bluetooth drop takes a DIFFERENT path — `handleAudioSessionRouteChange` → `.oldDeviceUnavailable`
  → `pauseAllPlayers()` — which is NOT an interruption, so `handleInterruptionEnded` never runs.
  Narration recovers via the same stall rung; the music bed recovers via its own `play()` re-assert on
  the next segment (`driveMusic.ts`, audit #287). ⚠ The stall watchdog is gated on
  `activeSeq !== null`, so BETWEEN stops only the music's re-assert is watching.

**Also checked and clear:** the preview-vs-drive session race (tap a stop, then tap Start). The detail
screen stops its preview on blur (`useFocusEffect` cleanup → `preview.stop()` → release) and every
`apply*` activates FIRST, so the realistic orderings are covered. The residual is a fragility the code
already names — the mode is process-wide, last-writer-wins, with no sequencing primitive — not a
reachable bug.

### §12.8 — GPS pipeline + end predicate: SOUND, and the best-defended code in the repo

Examined `fix-mapper.ts`, `trigger.ts`, `gps.ts`, `gps-fault.ts`. **No defects found.** Recorded
because two invariants here are load-bearing and would look like dead weight to a simplifier.

**⚠ The end predicate is THREE clauses and every one earns its place** (`fix-mapper.ts:123`):

```
alongM >= routeEndM - epsilonM                             // 1. the cursor arrived
|| (cursor >= polylineLen - 2 && rawToEndM <= maxEndDistM) // 2. cursor at the last vertex, raw nearby
|| (rawToEndM <= epsilonM && alongM >= routeEndM * 0.5)    // 3. RAW position at the end, past halfway
```

Clause 3 is the one that is not obvious and the one not to delete: it keys on the **raw** position, not
the cursor, so a drive still ENDS when off-route rejection has FROZEN the cursor near the finish.
Without it, a rider whose GPS goes bad in the last mile arrives and is never told — no outro, no
`drive_completed`, indistinguishable from an abandon in the funnel. ⚠ Its `alongM >= routeEndM * 0.5`
guard is equally load-bearing: a there-and-back's start IS near its end, so without it clause 3 fires
on the first fix and the drive ends before it begins.

⚠ Also note `reachedEnd` is driven by the SOURCE (`onEnd`), not by the pump — and for the live source
`onEnd` comes from this predicate via `createFixMapper`. A real GPS watch never "runs out of fixes",
so this predicate is the ONLY way a live drive finishes on its own.

**⚠ The `tSec` reporting-only invariant.** `gps-fault.ts` flags that an out-of-order fix pair can hand
a consumer a NEGATIVE `tSec`, "survivable only for as long as reporting-only stays true". Verified
2026-08-05: in the LIVE player nothing keys logic on it — `trigger.ts` only copies it into the event,
and the arithmetic sites (`simulate.ts`, `harness.ts`) are desk-analysis tools generating their own
monotonic clock. **Do not introduce a live consumer** without re-deriving the guarantee; the
`reorderTimestamps` fault exists to break exactly that assumption.

**Not re-examined and not needed:** the speed-aware accuracy gate, the iOS `-1` sentinels, the
monotonic cursor's off-route freeze. Each has a documented field-confirmed failure behind it (the
canyon zero-fire; the course `-1` read as due-north; the App-Review-in-Cupertino outro-in-seconds bug)
and a dedicated fault in `gps-fault.ts` asserting the *pipeline consequence* rather than the input.

### §12.9 — Music bed: correct code, ⚠ a comment that invites breaking it

`driveMusic.ts:177` pauses the playlist once the volume ramp reaches 0, with the stated reason: *"so we
don't keep exclusive doNotMix focus and the rider's own audio can resume."*

⚠ **The behaviour is right and the reason is wrong, in the one area where a misreading has already
caused bugs twice.** `playlist.pause()` does NOT release the audio session — `audio-session.ts` says so
in as many words ("pausing a player does not give it back — iOS resumes them only once the session is
deactivated"). So the rider's audio does not resume, and **it must not**: a drive holds its exclusive
session for its whole length, and the next narration clip needs it. Releasing here would silence the
rest of the drive.

The real reasons to pause at zero volume are ordinary — don't decode audio nobody can hear, don't hold
a running player for a whole narration. Fix the comment; do NOT "fix" the code to match it. ⚠ That
file's header already records that this rule "has already been softened once by someone reading only
half of it"; this comment is how it gets softened a second time.

**Drive-end accounting: SOUND.** `drive_completed` fires only from `finishDrive`, only reachable from
`decidePump`'s `'finish'`, which requires BOTH a drained queue and a finished road — so a "Pull over"
or back-out runs `resetForReady` and stays an ABANDON rather than a false arrival. Combined with
§12.8, note that a live drive's only self-completion path is the three-clause end predicate.

## §13 — Build reconciliation (2026-08-05): five things the plan got wrong

A six-area scout of the actual code, run before any line was written, found five items that CHANGE the
design rather than merely correct it. Recorded because each was invisible from the spec.

### §13.1 — ⚠ `missingClipCount` does not work on the path §2 depends on

§2's escape hatch (offline + partial still rolls) is only humane because the rider is TOLD what is
missing, on the ready card, while parked. **That disclosure is already broken.** `loadPlayback`'s
offline branch returns `m.detail` — a `SavedDriveManifest` whose clips have **no `url` key at all**
(stripped by TYPE: `Saved<T> = Omit<T,'url'>`, so persisting a presigned credential is a compile
error). But `useDrive` computes the count as `expectedAudioSeqs(manifest.clips)` filtered against the
url map, and `expectedAudioSeqs` needs the url it no longer has.

Today that is masked because most drives play the ONLINE branch. §10 makes every drive offline, so it
would have shipped a gate whose escape hatch was silent — the exact failure the whole document exists
to remove. **Fix: `Playback` gains `expectedSeqs`, sourced from `OfflineManifest.audioSeqs`, which
already stores precisely the right list.**

### §13.2 — §3a is not "a small, contained change"

Gating the CTA on "a download is running" needs progress state. Once the download SURVIVES navigation
(§3a's whole point) that state cannot live in the screen — and `offline.ts`'s in-flight map knows a
transfer exists but carries no progress and exposes nothing. §3a therefore requires a **progress
registry** in `offline.ts` (subscribe/read/cancel, with the `AbortController` moved out of the
component), not just relocating an abort.

⚠ And a cancelled download is today **indistinguishable from one that never started** — the
`AbortError` branch is deliberately silent. Without recording `canceled`, the auto-start re-fires the
instant the rider cancels.

### §13.3 — Auto-download must fire from the CREATE HANDLER, not from the push

N2 says auto-download fires at CREATE only. But the create push is **byte-identical to three OPEN
pushes**, one of which is a rider re-entering a drive they backed out of. Keying on the push — or on a
route param — makes "create only" false.

**Resolution: the create handler starts the download itself**, because it is the one place that knows
a drive was just created. The detail screen merely observes §13.2's registry. No param (which would
also have re-created exactly the `?mode` defect §11 retires), no re-entry trap.

### §13.4 — ✅ FOUNDER CALL: `simMode` defaults OFF everywhere; `__DEV__` does NOT seed it

§11 proposed moving `__DEV__` from the mode resolution into the setting's DEFAULT. ⚠ **That would have
silently simulated the RISK-1 real drive.** The founder runs it from a DEV BUILD on a real device, so
a `__DEV__` default means sim is on — and the admin `TraceRecorder` is gated on `mode === 'live'`, so
the one drive that matters would produce a simulated run and **no trace**, of a drive that cannot be
re-recorded.

Decision (founder, 2026-08-05): **default false everywhere, single-sourced.** ⚠ There were THREE
defaults for one boolean (the read's catch, the provider's parameter, the layout's `?? false`) — the
same one-value-two-copies failure §11 exists to delete, hiding one layer up in the provider wiring.

**This also dissolves the `fastReplay` flag §11 called for.** That flag was only needed because a
`__DEV__` default would have made `defaultFast: simMode` true on every dev drive and silently run
every trigger-timing pass at 8×. With no `__DEV__` default, the existing wiring is correct unchanged.

### §13.5 — The deletion set is bigger, and asymmetrically enforced

Beyond §10's table: `loadOwnedSelection` (the route's private loader) and **three** chained Zod schemas
(`signedDriveAudio` → `signedStopClip` → `signedClip`), plus `DriveStopProps.offline` riding three
funnel events.

⚠ **The two workspaces do not fail the same way.** `apps/api` sets `noUnusedLocals`, so every dead
symbol there breaks the build and cannot be missed. `apps/mobile` extends `expo/tsconfig.base` (no
such flag) and its lint is bare `eslint .` with unused-vars at severity 1 and no `--max-warnings 0` —
so a leftover dead import there **warns and passes**. The shared schemas leave via an `export *`
barrel, so nothing lints them at all. Discipline, not tooling, is the guard on the mobile side.

⚠ Also: `apps/mobile/src/lib/offline-util.test.ts` imports the deleted url-map helpers at the top of
the file. Deleting the functions without the imports fails **module resolution**, taking ~30 unrelated
store/migration/sweep/TTL tests down with it — a red suite that looks nothing like its cause.

## §14 — BUILT 2026-08-05, and what an adversarial review caught in it

Built by eight agents split on file ownership; then five review lenses over the diff, each finding
attacked by an independent skeptic. **16 findings claimed, 12 survived refutation, 5 distinct defects**
(the duplication is the signal: five separate lenses independently found §14.1, three found §14.2).
All five are fixed. ⚠ Every one was in code written that same hour, and none was caught by
`bun run check` — which was green throughout.

### §14.1 — ⚠ HIGH: the gate was LIVE, and regaining signal killed the player mid-drive

The player's gate was a render-time expression over a REACTIVE connectivity verdict. The failure is
the §2 rider exactly: park in a dead zone with 19 of 20 stops (offline+partial ⇒ `play`), start
driving, crest a ridge into coverage — the verdict flips to `needs-download` and **the player screen
replaces itself with the save-it-first wall while the car is moving.** The hook stays mounted, so the
clip keeps talking and the GPS keeps running; the rider loses the map, scrubber, pause and "Pull
over", and the only offered action asks them to END the drive. Coverage flapping repeats it.

**Fix: latch the verdict at load.** ⚠ The gate is an ENTRY guard — it answers *should this screen have
opened at all*, a question about how the player was REACHED. `urls` and `missingClipCount` were
already frozen at load, so connectivity was the only thing that could move; an imperative
`isOfflineNow()` read is the whole fix.

⚠ **`play.tsx` had already learned this one screen over** — it latches `offlineAtOpen` with the note
that "Tahoe coverage flaps — so reading the live verdict would re-lay-out the screen, mid-drive,
repeatedly, with the rider touching nothing." The lesson was written down and then not applied to the
next thing that read the same verdict.

### §14.2 — ⚠ HIGH: a partial copy's only CTA was a repair that cannot fetch a byte

`repairable = dirState !== 'none'` matched a PARTIAL copy, which is readable (`ok`) and playable. So
the gated CTA offered "Recover it without downloading again" — and `repairDownload` re-adopts bytes
already on disk and fetches none. The rider tapped it, the state re-derived identically, the button
re-rendered unchanged: **the gate was inescapable from the main path**, on a drive they had spent a
credit on. The branch that actually fixes a partial copy is Save (`downloadDrive` is a TOP-UP).

**Fix:** `dirState !== 'none' && !downloaded`. Repair is for *bytes with no readable index* and
*readable index, zero bytes resolve* — both have `downloaded === false`.

### §14.3 / §14.4 — MEDIUM: the cancel edge fired before the teardown

Cancel published "stopped" synchronously while `runDownload` was still unwinding. Two bugs shared that
root: a screen refreshing on the early edge read the drive dir mid-teardown (dir present, manifest not
yet written) and offered a Repair for a directory about to be removed; and `inFlight` still held the
aborting promise, so a rider taking the Save the UI had just offered got that promise handed
back — **no bytes, tombstone intact, a silent no-op.**

**Fix (one, for both):** `cancelDownload` marks the tombstone but stays SILENT; the single
not-running edge is published by the run's `.finally`, when the disk and `inFlight` agree with it.
`downloadDrive` additionally refuses to join a canceled run, chaining a fresh one after it unwinds.

### §14.5 — LOW: a replayed broken stop double-counted itself

Tapping a passed stop whose local clip is present but undecodable re-ran the watchdog and emitted a
second `stop_skipped`, inflating `drive_completed.stops_skipped`. **Fix:** `emitStopSkipped` is
idempotent per seq — a stop fires at most once per drive, so a second skip can only be a replay. This
mirrors `played`, which already exists to stop a replay landing a second `stop_fired`.

### What the review REFUTED

Four claims died under scrutiny, worth naming so they are not re-raised: that `topUpDrive`
re-downloads what a rider cancelled; that collapsing the stall ladder removed a second decode attempt
rather than a re-sign; that a simulated drive lost its SIM indicator; and that `DEFAULT_SIM_MODE` was
not actually single-sourced.

## §15 — ⚠ THE BUG THIS FEATURE UNCOVERED: no drive could EVER be saved

Found on the simulator 2026-08-05, while trying to test something else. **Pre-existing — the transfer
code is byte-identical to before this work** — and it meant the offline download had a 0% success
rate. It was invisible because nothing forced anyone to notice: an unsaved drive simply streamed.
⚠ **The gate is what turns this from a quiet bug into a total outage**, because a rider who cannot
download now cannot drive at all.

### The cause: `moveSync` MUTATES the File, and the cleanup deleted the clip

```ts
const tmp = new File(store, `${p.name}.part`)
await downloadFileWithRetry(p.url, tmp, ...)   // bytes land in the temp ✓
tmp.moveSync(new File(store, p.name))          // move succeeds ✓ — and RE-POINTS `tmp`
if (!hasStoredClip(p.name)) throw …            // passes: the clip IS there ✓
} finally {
  deleteQuietly(tmp)   // ⚠ "a no-op after a clean move" — it deletes the CLIP
}
```

`expo-file-system`'s move ends with `url = destinationUrl` (`ios/FileSystemPath.swift`). So the moment
the move succeeds, the `tmp` handle stops referring to the temp and starts referring to the finished
clip — and the `finally` deletes exactly the byte it just saved. **Fix: re-derive the temp from its
NAME in the `finally`, never reuse the moved handle.**

### ⚠ Why it took a filesystem poll to find, and what that says about the code

Every layer behaved *correctly* on an empty store, and each one subtracted information:
1. the move error was discarded by an **empty catch**;
2. no clip threw at all — the post-move check passed, because at that instant the file existed;
3. `fetchMissing` absorbs per-clip failures **by design** (partial-tolerance, right for the rider);
4. `runDownload` ended at `"no clips could be saved"` — a symptom three layers from its cause.

The observable that cracked it was polling `Documents/clips/` during a run: `.part` files appearing
with real bytes, then vanishing, with the final name never present.

**Two diagnosability fixes landed with it, and they are the durable half:** the move error is now
carried into the thrown message, and `fetchMissing` returns the FIRST clip failure so `runDownload`
can name a cause instead of a symptom. ⚠ Rider-facing copy is unchanged — the screen still speaks the
persona line; only the Error carries the reason.

**Verified after the fix:** 20 clips / 12 MB on disk, zero leftover `.part`, manifest committed, and
the CTA correctly flipped to SAVED OFFLINE → "Start the drive".

⚠ **Unknown: whether this reproduces on a DEVICE.** It is a JS/native-contract bug, not a simulator
quirk, so it very likely does — but the shipped 1.1 build should be assumed to have it until someone
saves a drive on a real phone. That check now outranks §12.5's threshold check.

## Not worth doing

- **A region-level pre-fetch.** Cut, and for a reason that still holds: no bbox-level rule can
  guarantee coverage of a selection frozen under a different rule (`offline-region-packs.md`).
- **Gating on freshness.** See §5.
- **A background download queue across drives.** The shared store already makes the second drive down
  a corridor nearly free; build the queue when a rider has enough drives for it to matter, not before.
