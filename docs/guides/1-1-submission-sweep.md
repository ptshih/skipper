# The 1.1 submission sweep — from a clean tree to "Submit for Review"

> **Status:** guide (written 2026-08-03) — the executable pass that clears the last gates between
> today's `main` and an App Store submission. It REPLACES, for 1.1, both
> [device-verification-runbook.md](device-verification-runbook.md) (written against the M1 player, before
> the conversation was the home screen) and
> [create-a-drive-verification-runbook.md](create-a-drive-verification-runbook.md) (marked SUPERSEDED —
> its FROM/TO pickers no longer exist). Those two keep their own history; **execute this one.**
> Companion to [app-store-submission.md](app-store-submission.md), which owns every ASC *field* — this
> owns the *order* and the on-device proof. Code-anchored to `main` as of 2026-08-03; re-verify anchors
> before trusting a line number.
>
> **Founder call 2026-08-03: RISK-1's real Tahoe drive is OFF the critical path.** The desk passes below
> stand in for it. §0 states precisely what that trades away, because the trade is real and it should be
> made with open eyes, not inherited from a checkbox.
>
> ⚠ **Updated 2026-08-05 for the download-before-start gate**
> ([../designs/download-before-start.md](../designs/download-before-start.md)). Three things change
> what you execute: **(1)** a drive's audio is only ever played from DISK — every drive in every pass
> below must be SAVED before it will start, and the streaming/re-sign path is deleted; **(2)** the
> unsaved-drive alert (*Save it first / Start anyway / Cancel*) is GONE, replaced by a gated CTA that
> turns itself on — §4 is rewritten around it; **(3)** `?mode` is retired and the `__DEV__` "Simulated
> drive" ⋯ item with it — Pass A's entry point moved to an **admin-gated setting**, which changes which
> BUILD it needs. ⚠ **None of that touches the App Review path in §5**: the planner, the route-preview
> clip and `GET /sample` all play before a drive exists and deliberately still STREAM. "Offline for
> everything" must never be read as "delete all streaming" — it would take the front door with it.

---

## 0. What the desk passes can and cannot prove — read this first

RISK-1 (`../designs/drives-first-1-1.md`) says no created drive has ever been driven end to end. Two
desk passes replace that, and they are **complementary, not redundant** — each covers what the other
structurally cannot.

| | Pass A — in-app simulator | Pass B — Xcode GPX on a phone |
|---|---|---|
| Fix source | `simulatedSource` (`apps/mobile/src/lib/gps.ts`) | real `expo-location` watch → `liveSource` |
| Reports real speed? | **Yes** — `generateDrive` stamps `speedMps` | ⚠ **Probably not** (see below) |
| Exercises speed-adaptive lead | **Yes** | no — radius falls to the `trigger_radius_m` floor |
| Exercises CoreLocation, permission, accuracy gate, watch teardown | no (the seam is above expo-location) | **Yes** |
| Exercises audio session, lock screen, Now Playing, offline store | Yes | Yes |

⚠ **iOS may not simulate SPEED, and it changes what Pass B proves.** Apple's own
[Simulating location in tests](https://developer.apple.com/documentation/xcode/simulating-location-in-tests)
says Xcode replays a GPX "updating the simulated location, elevation, **and velocity**"; the field
consensus ([Apple Forums 95388](https://developer.apple.com/forums/thread/95388) and others) is that
`CLLocation.speed`/`course` arrive as the **-1 sentinel**. They cannot both be right, so the generator
emits BOTH `<time>` and `<speed>` and you find out on the device. If speed is -1:

- `saneNonNeg` maps it to **0** (`apps/mobile/src/lib/gps-util.ts`), so the speed-adaptive lead
  contributes nothing and every stop fires off its bare floor radius. **Stops still fire** — plumbing is
  what Pass B is for — but the lead timing you read in the terminal is not what the phone is doing.
- ⚠ **At speed 0 the accuracy ceiling also collapses to its 50 m floor** (`accuracyCeilingM`). If
  Xcode's simulated `horizontalAccuracy` is poor or negative, **every fix is rejected and NOTHING
  fires.** That is a simulation artifact. Do not "fix" the trigger engine over it — go run Pass A, which
  has no accuracy gate in the way, and confirm the engine is fine.
- Course arrives -1 too, which the engine reads as "unknown" and **skips the heading gate** — the safe
  branch, and the one the field-confirmed zero-fire bug was about
  (see the RAW-course comment in `gps.ts`). So the heading gate itself stays untested at a desk.

**What NEITHER pass covers, and what you are accepting:** real GPS multipath in a granite canyon, true
motion, and cellular dead zones. The zero-fire bug that produced that RAW-course comment came from
exactly there — a real drive, not a reasoned-about one. The residual is one review cycle plus a bad
first drive for whoever drives first. Drive it when you can; just don't let it hold the submission.

✅ **And when you do drive it, it now BANKS.** Any live drive taken while signed in as an admin records
its raw fix stream to the phone (Settings ▸ Developer ▸ DRIVE TRACES → Share). That trace replays
forever through the same pipeline, and `packages/sim/src/sweep.ts --trace` reads the whole
floor × lead curve off it — which is what finally answers
[trigger-precision-spec.md](../designs/trigger-precision-spec.md) step 2. It is gated on **admin, not
`__DEV__`**, precisely so a TestFlight drive counts. See
[desk-drive-harness.md](../designs/desk-drive-harness.md).

---

## 1. Two builds, and they are not the same artifact

Fire these in this order — the cloud build runs unattended while you do the local one.

- [x] ✅ **Production build → TestFlight — DONE 2026-08-03: build `1.1.0 (20)` is uploaded and in
      Apple's processing queue.** Run as
      `eas build --profile production --platform ios --auto-submit --non-interactive`; the auto-submit
      is worth it, since it hands the artifact straight to ASC with no second command.
      ⚠ **It is 19, not the 17 this line used to predict**, and the reason is a trap worth knowing:
      `autoIncrement` assigns the number when the build is QUEUED, not when it succeeds, so a failed
      or cancelled attempt consumes one forever. 17 failed (see below) and 18 was cancelled once that
      failure was diagnosed as deterministic. **Never assume the number — read it back from the build.**
      ⚠ **17 failed on something that was not the app**: the PostHog dSYM upload phase hit
      `content_hash_mismatch` (a symbol UUID already in PostHog with different bytes), posthog-cli
      exited non-zero, and that took the whole archive down under the useless banner
      `EAS_BUILD_UNKNOWN_FASTLANE_ERROR`. Fixed in `e529dd3` with the plugin's `skipOnConflict: true`.
      If a build ever dies at "Run fastlane" with no error, read the **Xcode logs**, not the EAS
      summary — and note they are brotli-encoded, so `curl --compressed` fails and you need
      `brotli -dc`.
      ⚠ `ios/` is gitignored prebuild output, so EAS prebuilds fresh in the cloud — **the "native
      rebuild owed" item from the SDK-57 patch bumps (`44642c6`) is discharged automatically here**, not
      by anything you run locally.
- [ ] **Dev build on a physical phone.** `npx expo prebuild --clean` then
      `npx expo run:ios --device`. The `--clean` is not optional: the checked-out `ios/` predates
      `44642c6`, so its pods still match the old patch versions.
      ⚠ **Pass B needs this build, not TestFlight** — it needs the app running under Xcode for
      Debug ▸ Simulate Location, which TestFlight cannot do.
      ⚠ **Pass A's entry point MOVED on 2026-08-05 and is no longer `__DEV__`-gated.** The `⋯` →
      "Simulated drive" item is deleted; the sim clock is now **Settings ▸ Developer ▸ SIMULATED GPS**,
      gated on **admin** (server-set `role`, self-guarded against a `skipper://developer` deep link).
      So Pass A can be run from a TestFlight build too, signed in as the founder — same as the trace
      recorder, and for the same reason: a TestFlight drive should count. Do it on the dev build anyway
      if you want the `[drive]` console warnings §2 tells you to watch for.
      ⚠ Release builds enforce ATS; if you point at a `ts.net` host you need `NSExceptionDomains`
      ([eas-setup.md](eas-setup.md)). Pointing at `https://api.skipper.fm` avoids the question.

## 2. Pass A — the in-app simulator (real speeds, real trigger timing)

Sign in on the dev build and open **MY DRIVES → "Tahoe City → South Lake Tahoe"**. ⚠ **Sign in as the
ADMIN account, not the demo one (2026-08-05):** the sim clock lives behind Settings ▸ Developer, whose
row is shown only to admins and which self-guards a deep link too, so a demo-account session cannot
reach it at all.

- [ ] **Get the expected schedule first**, so you are checking against a number rather than a vibe:
      ```sh
      dotenvx run -f .env.development -- bun packages/sim/src/run.ts \
        b6388400-0df4-4edc-a2e0-f4ca65072279 --mph=45
      ```
      Measured 2026-08-03: **8/8 stops fire, 12 s lead on every one, no audio overlaps**, 29.7 mi /
      39:33 at 45 mph.
- [ ] **Save the drive first — there is no other way in (2026-08-05).** The CTA reads "Save for
      offline" until a complete copy is on the phone, then turns itself into Start. Sim behaves
      EXACTLY as live here, deliberately: gating the drive rather than the mode is what makes our own
      QA run the same guard riders run. **Watch for:** a `Not saved` chip that never moves; a
      **"Start anyway"** button (deleted — its return means the gate grew a bypass).
- [ ] **Turn the sim clock on:** **Settings ▸ Developer ▸ SIMULATED GPS → "Simulated"** (admin only).
      ⚠ **Turn it back to "Real GPS" when you are done.** It is persisted and defaults false in every
      build, `__DEV__` included — precisely so RISK-1's real drive is never silently simulated and
      never loses its trace (the recorder is gated on a `live` drive).
- [ ] **Start the drive.** Use the time-scale toggle on the ready card to compress.
      **Expect:** all 8 stops fire in `seq` order, each with ~12 s of lead before the anchor.
      **Watch for:** two stops firing on one fix (the `[drive]` console warning in `useDrive.ts`),
      a clip cut off by the next one, and the drive completing rather than hanging after stop 7.
- [ ] **Tap a PASSED stop in the player's itinerary** (2026-08-05 — the list is no longer read-only).
      **Expect:** it re-hears that stop, in the quiet between clips only, and a live trigger preempts
      it. **Watch for:** an UPCOMING row responding at all — it would fire again on approach and the
      rider hears the same clip twice.
- [ ] **Audio focus.** Start music in another app, then run the sim.
      **Expect:** the skipper takes EXCLUSIVE focus (`doNotMix`) and the music is *paused*, not ducked,
      then handed back when the drive ends (`../decisions/drive-audio-exclusive-focus.md`).
- [ ] **Lock the phone mid-clip.** Expect lock-screen Now Playing with title/artwork, and the ±15 s and
      pause controls working from there.
- [ ] **Scrubber.** Drag it, use ±15 s, pause/resume. ⚠ The `PanResponder` is the one remaining
      mechanical `eslint-suppressions.json` entry and it "cannot be typechecked into confidence" —
      this is the pass where it gets looked at.

## 3. Pass B — the Xcode GPX desk drive (real CoreLocation)

- [ ] **Generate the route file.** The `--gpx` flag walks the same polyline, from the same
      `generateDrive` call, as the schedule printed above it — so the terminal and the phone are the
      same drive:
      ```sh
      dotenvx run -f .env.development -- bun packages/sim/src/run.ts \
        b6388400-0df4-4edc-a2e0-f4ca65072279 --mph=45 --gpx=/tmp/tahoe.gpx
      ```
      Measured 2026-08-03: 2373 waypoints @ 1 Hz, replays in **39:32 of real time**, valid XML.
      ⚠ It emits `<wpt>` only — **Xcode ignores `<trk>`/`<trkseg>`**, and a track-shaped GPX replays as
      one stationary point, i.e. a pass that silently tests nothing.
- [ ] **Load it.** Xcode ▸ Debug ▸ Simulate Location ▸ Add GPX File to Workspace, phone attached.
- [ ] **"Start the drive"** — the real, GPS-triggered player. This is also the ONLY screen in the app
      that asks for location, so you are testing the permission priming here too.
      **Expect:** the location prompt appears (When-In-Use), then stops fire in order as the replay
      walks the route.
      **Watch for:** the first thing to check is whether stops fire *at all* — if none do, re-read §0
      before touching anything, then confirm with Pass A.
- [ ] **Reduced accuracy.** Turn Precise Location OFF in Settings for the app and start a drive.
      **Expect:** the app detects `reduced` and sends you to Settings rather than starting a drive that
      can never trigger (`isReducedAccuracy`, `gps.ts`).
- [ ] **GPS actually stops.** Pull over / leave the screen, then confirm the location arrow clears.
      ⚠ `watchPositionAsync`'s `.remove()` can fail to stop updates (expo/expo #35925/#35926); the
      `stopped` guard makes a leak harmless to the engine but it still drains battery. `gps.ts:191`
      explicitly asks for this to be verified on-device — this is that check.
- [ ] **Background it mid-drive.** Expect audio to continue and the next stop to still fire.

## 4. Offline — ⚠ not a side-quest any more: it is the ONLY way a drive plays

- [ ] **"Save for offline"** on the detail screen, then Airplane Mode.
      **Expect:** saved drives still open and play; the placard's `Not saved` chip is gone; the drive
      runs end to end with **zero network**. There is no "Playing from download" chip to look for — it
      was deleted, because a chip asserting what is now always true asserts nothing.
- [ ] **Home while offline.** Expect the in-persona "Parked till the signal's back" card, MY DRIVES
      moved ABOVE it, and no crash.
- [ ] **⚠ THE GATE, in its three states** (replaces the deleted *"This drive isn't saved yet"* alert).
      On an UNSAVED drive, online: there is **no Start at all** — the CTA is "Save for offline" with a
      courtesy "About N MB." line (a LABEL, never a prompt). While it runs: Start is present but
      **disabled**, reading "Saving for the road…" with "Start opens up the moment the last stop
      lands." under it and `Saving k/total` on the placard chip. When it lands: Start enables itself
      with no tap from you. **Watch for:** a **"Start anyway"** button anywhere — that string was
      deleted, not relocated, and a live one is how a gate quietly grows a bypass.
- [ ] **⚠ The escape hatch: OFFLINE with a PARTIAL copy still rolls.** Interrupt a download (Airplane
      Mode mid-save, or `⋯` → Cancel download), stay offline, open the drive. **Expect:** Start is
      **enabled** — blocking a rider we cannot help is pure loss — and the player's ready card replaces
      its usual body with the count: *"N stops didn't finish saving, so I'll be quiet when we pass
      them. The rest of the drive is all here."* **Watch for:** the ordinary ready body while stops are
      genuinely missing; that disclosure is the only reason this row is allowed to roll.
- [ ] **Offline with NOTHING saved blocks, honestly.** Airplane Mode, open a never-saved drive.
      **Expect:** a LINE, not a dead button — *"No signal out here, and this one isn't saved yet. We'll
      roll when the bars are back."*
- [ ] **A created drive saves ITSELF.** Signed in, make a new drive from the home conversation and
      watch the detail screen you land on without touching anything: the download starts from the
      create handler, survives you backing out and re-entering, and Start enables when it finishes.
      **Watch for:** an OLD drive opened from MY DRIVES also starting a download — it must not; that
      would spend tens of MB on a glance.
- [ ] **★ The one device check the build OWES:** `LOCAL_CLIP_STALL_MS` is **2.5 s** and is a **desk
      estimate**. Drive a saved drive end to end on a cold, busy phone and confirm **every** clip
      starts. **Watch for:** `stop_skipped` / `load_timeout` on a clip that is provably on disk (tap
      that passed row to replay — if it plays fine, the watchdog fired early). If local decode
      reporting lags, the short value skips clips that would have played, **trading dead air for LOST
      STOPS, which is the worse currency.** Report the value rather than quietly raising it.
      (`packages/engine/src/player.ts`; the device runbook's §8 carries the long form.)

## 5. Walk the App Review path exactly as written

⚠ §10 of [app-store-submission.md](app-store-submission.md) describes a build **nobody has walked**.
A note that sends a reviewer to a screen that moved is the precise failure the 2026-07-30 rewrite was
cleaning up. Do this on the **production/TestFlight** build, signed out, on cellular.

- [ ] Cold launch. Expect **"Where are we headed?"** ⚠ *not* "Well now — where are we headed?": that
      kicker was CUT with the tic (founder, 2026-08-03 — see the note at `voice.ts`'s `openingQuestion`),
      and this line went stale the same day. The composer reads a ROTATING example
      ("somewhere pretty, back by 5", "{a} to {b}", …); the bare **"Tell me where to"** is the fallback
      shown only when the region has no curated names, so do not treat a rotating placeholder as wrong.
      ⚠ There are exactly **two** example rows — "Drive somewhere" and "Let the skipper pick". The third
      ("Take a loop") was removed 2026-08-03 with the loop default
      ([../decisions/no-same-road-loops.md](../decisions/no-same-road-loops.md) §8).
- [ ] Type exactly `Tahoe City down to South Lake Tahoe`. Expect a route under **YOUR DRIVE** and a
      player under **A TASTE OF THIS ONE** that plays a real clip. **No sign-in, no location prompt
      anywhere on this path** — that claim is the strongest thing in the notes and it must be literally true.
      ⚠ **And no download, either: this clip STREAMS, deliberately.** It plays before a drive exists,
      with nothing on disk to play from, so the disk-only rule that governs a DRIVE stops at this
      boundary and the generous 12 s remote stall budget still applies here. A reviewer on cellular
      must hear it with one tap and no wait bar. If it ever goes quiet, suspect that someone read
      "force offline for everything" as "delete all streaming" and took the front door with it.
- [ ] Tap **"Make this drive"** while signed out. Expect *"You'll need a free account to keep this drive."*
- [ ] Back on the opening screen, tap **"Not near Tahoe? Hear a quick sample."** Expect audio to start
      on its own, no account, no permission.
- [ ] Ask for a route the corpus does not run (e.g. Cupertino → Santa Cruz). Expect the in-persona
      refusal, and judge it as a reviewer would: **does it read as honest, or as broken?** This is the
      one live failure mode §10 exists to route around.
- [ ] **Account deletion, verbatim from §10:** Settings (gear) → "Delete account" → password →
      "Permanently delete" → "Delete forever". Use a throwaway account, not the demo one. Expect the
      account, its drives and its remaining credits to be gone immediately. ⚠ This is the one guideline
      a reviewer can check in 30 seconds (5.1.1(v)).
- [ ] Sign in as the demo account and confirm **MY DRIVES** shows the saved drive and it still opens.

## 6. Then, and only then: the listing

Everything here is owned by [app-store-submission.md](app-store-submission.md) — this is the ordering.

- [ ] **Screenshots.** They serialize behind §§2–5 because they cannot be shot until the UI is settled
      and confirmed. §9 there: three of the six live assets show deleted product, the hero is now the
      conversation mid-proposal (needs no GPS — far easier to stage than the old roam shot), and
      ✅ the branded-frame compositor now EXISTS (`bun run shot:compose` —
      `scripts/compose-screenshot.ts`, rebuilt 2026-08-03; it had never been committed), so this is a
      recapture again rather than a build. Dark mode + `simctl status_bar` override, and capture on an
      **iPhone 17 Pro Max** simulator — it is natively 1320×2868, so nothing is resampled.
- [x] ✅ **The 1.1 metadata is entered** — done 2026-08-03 with
      `bun run asc:metadata -- --apply --version=1.1.0`, verified by an independent read-back. The
      record is now `1.1.0` / `PREPARE_FOR_SUBMISSION`. Re-check any time with a no-flag
      `bun run asc:metadata`; it prints "already matches" for all three fields.
- [ ] **Attach the NEWEST 1.1.0 build** — `20` as of 2026-08-03, but read the number back from EAS
      rather than trusting this line; every rebuild supersedes it (19 was superseded within hours).
      Wait for Apple's processing to finish before it can be attached.
      ⚠ The record has NO build right now, on purpose: renaming it to 1.1.0 left
      build 15 (short version `1.0.0`, the pre-1.1 roam client) attached, because Apple neither
      detaches nor warns. It was detached; `asc:metadata` now checks this every run. Apple only offers
      builds whose short version MATCHES, so 19 is the only one that will appear (17 failed, 18 was
      cancelled — see the build step above).
- [ ] **Decide the App Privacy free-text question** (§8's 1.1 note). The rider types prose to
      `POST /drives/plan`, which reaches our server and Anthropic; nothing persists it. Transmitted vs
      *collected* is a judgement on Apple's definition and it is **founder's, not a docs edit** —
      deciding it wrong is rejection-class.
- [ ] **Re-run §12's pre-flight.** Server side was green on 2026-08-03: `/health`, `/sample`,
      `/regions`, site `/privacy` `/terms` `/support` all 200; `/roam/sample` 404 (correct);
      `delete-user` **400**, not 404. Still owed: one anonymous `POST /drives/plan` against prod — it
      spends model tokens, so it is a deliberate act, and it is the only proof `ANTHROPIC_API_KEY` is
      set on the deployed service.
- [ ] **Availability = United States ONLY.** One click, cheapest legal decision on the list.
- [ ] Submit. Release type stays **MANUAL**, so approval lands in *Pending Developer Release* — the real
      Tahoe drive can still happen between approval and launch. That asymmetry is what made §0's trade
      affordable.
