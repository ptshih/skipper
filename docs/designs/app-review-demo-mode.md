# A reviewer-reachable simulated drive

> **Status:** 💡 **BUILD-READY, SCHEDULED FOR THE NEXT VERSION (founder, 2026-08-14).** Not now:
> 1.1.0 is `WAITING_FOR_REVIEW` and a new build must not be attached
> ([../guides/app-store-submission.md](../guides/app-store-submission.md) §14). Prompted by Apple's
> Guideline 2.1 round, where the one thing a reviewer at a desk cannot reach is the product itself —
> a stop firing on the road.
>
> ⚠ **This is deliberately NOT a rider-facing feature.** The couch "simulated drive" for riders was
> BUILT and then CUT (`../decisions/detail-page-mini-preview.md`, 2026-07-16). That decision stands.

## §1 · The job, and why the July cut does not settle it

The cut killed a linear run-through as the answer to **"did I get a good drive?"** — the founder's
words: *"a separate 'Take the simulated drive' mode is the wrong surface"*, because the natural
instinct is to poke at stop 3 and stop 7. Tap-a-stop replaced it and is better at that job.

**This is a different job: "show someone who cannot drive the road what the app DOES."** Nothing in
the July reasoning reaches it, so the ground is open — but the bar stays high, because `preview.ts`
and the preview clock were deleted rather than shelved, and reopening a deleted surface is how a
codebase grows a second copy of something.

Apple's own guidance is what makes this worth the build at all: *"If reviewing the app requires being
in a specific physical location, include a screen recording of the app in action with your
submission"* ([developer.apple.com/distribute/app-review](https://developer.apple.com/distribute/app-review/)).
A location-locked app owes a demonstration on **every** submission, forever. Today that costs a
capture session per update; this makes it a thing the reviewer can simply do.

## §2 · What already exists — the build is smaller than it looks

The preview CLOCK was deleted; **the simulated fix source was not**. `useDrive`'s mode union is still
`'sim' | 'live'`, and `simulatedSource` (`apps/mobile/src/lib/gps.ts`) walks a drive's real polyline
at a steady speed and fires stops through the **real trigger engine**, at 1× or 8×
(`app/drives/[id]/play.tsx`, `defaultFast: simMode`). A working couch drive ships today. Two things
stand between it and a reviewer:

1. It is gated on **`isAdmin`** — the wrong key, see §3.
2. It renders `SIMULATED DRIVE` + the `SIM` tag. **KEEP BOTH** — labelling is the practice other
   condition-locked apps follow (Bluetooth/NFC/AR apps ship a demo mode and disclose it in the review
   notes), and an unexplained badge in a video *we* sent is a worse question than the one it avoids.

## §3 · ⚠ The unlock must NOT be `isAdmin`, and this is the whole design risk

`isAdmin` is not "shows developer tools". It is:

| call site | what admin grants |
|---|---|
| `apps/api/src/drives.ts:1093` | the **SOLE** staged bypass (INV-5) — unreleased narrations enter a drive |
| `apps/api/src/index.ts:238,258` | `/regions` returns **staged** regions |
| `apps/api/src/auth.ts:454` | the region-release-gate preview |
| `apps/mobile/src/lib/useDrive.ts:842` | `TraceRecorder` on a live drive |

Granting the demo account `admin` would hand **App Review unreleased content to judge the app on**.
That is the opposite of the goal.

**So: a separate, narrower capability.** A server-set role (`'reviewer'`) with an `isReviewer()`
helper beside `isAdmin()` in `@skipper/shared`, unlocking exactly one thing: the sim-mode toggle.

⚠ **`isReviewer` must never be accepted where `isAdmin` is checked.** Widening `isAdmin` to
`isAdmin || isReviewer` at any of the four rows above re-creates the exact leak this section exists to
prevent — and it is this repo's most-repeated bug class (two copies of "the same" set drifting apart;
see CLAUDE.md). **Pin it with a test that asserts a reviewer session gets NO staged bypass**, in the
same commit.

## §4 · The change, end to end

- `@skipper/shared`: `isReviewer(session)` — `role === 'reviewer'`, nothing else. Additive.
- `apps/mobile`: the Settings ▸ Developer entry row and `/developer` gate on `isAdmin || isReviewer`;
  a reviewer sees **only** the sim toggle (drive traces stay admin-only — they are noise to a
  reviewer and name a capability nobody asked about). The section copy must read true for both
  audiences, so `voice.settings.developer*` needs a pass — "Admin-only tools" becomes false the day a
  reviewer can see it.
- Server: nothing, beyond allowing the role value. ⚠ Confirm Better Auth's admin plugin does not
  coerce or reject an unknown `role` string, and that `isAdmin` compares `=== 'admin'` rather than
  truthiness.
- Ops: set the role on `review@skipper.fm`; add "is the reviewer role still set?" to the per-update
  pass.

## §5 · What it costs, stated plainly

- **Review notes characters.** Telling a reviewer how to turn it on is ~300 of a 4000-char field that
  is already at 3935 and already owes §14's app description. The notes need a real re-cut at version
  prep either way; this makes that non-optional.
- **A capability that only Apple ever uses.** Accepted: the alternative is a capture session per
  submission, forever.
- **A role a rider must never reach.** Server-set and revocable, so the exposure is an ops mistake,
  not a client bug — but it is a new thing that can be set wrong.

## §6 · What this does NOT do

It does not prove the app works on a real road. `simulatedSource` emits finished fixes — it never
touches CoreLocation, the accuracy gate, or the iOS `-1` sentinels
(`../designs/desk-drive-harness.md`). **RISK-1 is untouched by this**, and a reviewer watching a
simulated drive is not evidence the product works. The honest framing in the notes is "this is how
the drive behaves"; the real drive remains owed.

## §7 · Open, for the build

- **Does a reviewer need to download the drive first?** Yes — audio is disk-only since 2026-08-05
  (`download-before-start.md`). The notes already sequence this; keep the order.
- **1× or 8× default?** `defaultFast: simMode` gives 8×, which turns a 49-minute drive into ~6
  minutes. Right for a reviewer; confirm the copy names the speed so nothing looks broken.
- **Does the reviewer role belong in the App Review notes at all, or in the Attachment field?**
  See §10's next-version block in the submission guide — the video may be the cheaper answer, in
  which case this feature competes with it rather than complementing it. **Decide which before
  building both.**
