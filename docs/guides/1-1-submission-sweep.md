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

- [ ] **Production build → TestFlight.** `eas build --profile production --platform ios`.
      `app.json` `version` is **`1.1.0`** (bumped 2026-08-03; was `1.0.1`). `appVersionSource` is
      `remote` with `autoIncrement`, so the build number takes care of itself → build 17.
      ⚠ `ios/` is gitignored prebuild output, so EAS prebuilds fresh in the cloud — **the "native
      rebuild owed" item from the SDK-57 patch bumps (`44642c6`) is discharged automatically here**, not
      by anything you run locally.
- [ ] **Dev build on a physical phone.** `npx expo prebuild --clean` then
      `npx expo run:ios --device`. The `--clean` is not optional: the checked-out `ios/` predates
      `44642c6`, so its pods still match the old patch versions.
      ⚠ **Both desk passes need this build, not TestFlight** — Pass A's entry point is `__DEV__`-gated
      (`app/drives/[id]/index.tsx:334`) and Pass B needs the app running under Xcode for
      Debug ▸ Simulate Location. TestFlight can do neither.
      ⚠ Release builds enforce ATS; if you point at a `ts.net` host you need `NSExceptionDomains`
      ([eas-setup.md](eas-setup.md)). Pointing at `https://api.skipper.fm` avoids the question.

## 2. Pass A — the in-app simulator (real speeds, real trigger timing)

Sign in on the dev build with the demo account, open **MY DRIVES → "Tahoe City → South Lake Tahoe"**.

- [ ] **Get the expected schedule first**, so you are checking against a number rather than a vibe:
      ```sh
      dotenvx run -f .env.development -- bun packages/sim/src/run.ts \
        b6388400-0df4-4edc-a2e0-f4ca65072279 --mph=45
      ```
      Measured 2026-08-03: **8/8 stops fire, 12 s lead on every one, no audio overlaps**, 29.7 mi /
      39:33 at 45 mph.
- [ ] `⋯` → **"Simulate the drive (dev)"**. Use the time-scale toggle to compress.
      **Expect:** all 8 stops fire in `seq` order, each with ~12 s of lead before the anchor.
      **Watch for:** two stops firing on one fix (the `[drive]` console warning at `useDrive.ts:577`),
      a clip cut off by the next one, and the drive completing rather than hanging after stop 7.
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

## 4. Offline

- [ ] **"Save for offline"** on the detail screen, then Airplane Mode.
      **Expect:** saved drives still open and play; the placard's `Not saved` chip is gone.
- [ ] **Home while offline.** Expect the in-persona "Parked till the signal's back" card, MY DRIVES
      moved ABOVE it, and no crash.
- [ ] **Start an unsaved drive.** Expect the one-time "This drive isn't saved yet" alert
      (Save it first / Start anyway / Cancel) — a warning, never a block.

## 5. Walk the App Review path exactly as written

⚠ §10 of [app-store-submission.md](app-store-submission.md) describes a build **nobody has walked**.
A note that sends a reviewer to a screen that moved is the precise failure the 2026-07-30 rewrite was
cleaning up. Do this on the **production/TestFlight** build, signed out, on cellular.

- [ ] Cold launch. Expect "Well now — where are we headed?" and a composer reading **"Tell me where to"**.
- [ ] Type exactly `Tahoe City down to South Lake Tahoe`. Expect a route under **YOUR DRIVE** and a
      player under **A TASTE OF THIS ONE** that plays a real clip. **No sign-in, no location prompt
      anywhere on this path** — that claim is the strongest thing in the notes and it must be literally true.
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
- [ ] **Paste the 1.1 metadata** — §§3, 4 and 10's replacement blocks. Re-read the LIVE values back
      from ASC first; this file has drifted before.
- [ ] **Set the ASC version string to `1.1.0`.** The `1.0.0` record is `DEVELOPER_REJECTED` (verified
      2026-08-03), so it is editable and reusable — no second version record needed. ⚠ Apple only
      offers builds whose short version MATCHES the record, so if the build picker looks empty, this is
      why.
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
