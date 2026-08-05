# Onboarding — a taste, then where

> **Status:** ✅ **BUILT 2026-08-04.** Two screens in front of the cold open: hear the skipper
> (`apps/mobile/app/sample.tsx`), then say which roads (`apps/mobile/app/region-setup.tsx`), gated by
> `onboarded` in `src/lib/client-flags.ts` and entered from the redirect at the top of `app/index.tsx`.
> **The location permission is NOT part of it** — asked and settled the other way twice (§2), which
> reverses one third of the original brief.
>
> ⚠ **TWO THINGS IN THE TEXT BELOW WERE REVERSED BY THE FOUNDER DURING THE BUILD, and §8 is the list.**
> Read §8 before §4 — it deletes §4 outright, including the region-`center` wire field that section
> recommends. The rest of this document shipped as written.

## What it is

A first-run flow, shown once per install, between launch and home:

1. **The taste.** The sample postcard — Emerald Bay, one line of invitation, a play disc. **Nothing
   plays until the rider touches it.**
2. **The where.** "Which roads?" — a region picker, defaulted to the nearest region when the rider
   offers their location and to Lake Tahoe when they don't.

Then it hands off to the cold open, unchanged.

## §1 · The moment

A stranger opens Skipper on a couch, not in a car. There is a postcard of Emerald Bay and a play
disc. They tap it, and a voice starts telling them about a lake they have not been to yet — the
whole product, in sixty-four seconds, before they have typed anything or made an account.

⚠ **It does not autoplay, and that was a decision** (founder, 2026-08-04). Autoplay is the bolder
read of "the persona is the product", and it is wrong here for a mechanical reason: the sample takes
**exclusive `doNotMix` audio focus** (`src/lib/audio-session.ts`), so it does not merely make noise —
it *stops whatever the rider was already listening to*, unasked, as its first act. On a bus or at a
desk that is a wince. One tap is the price of not hijacking a stranger's podcast to introduce
ourselves.

## §2 · The location permission is NOT in onboarding

The brief asked for a permission explainer here. It was interrogated and dropped, and the reason is
not taste:

- **iOS gives exactly ONE prompt, ever.** A denial is sticky and recovers only through Settings
  (`docs/decisions/location-permission-priming.md`). The founder's proposed safety net — *"if a user
  doesn't grant at onboarding we will ask again before starting their first drive"* — **does not
  exist**: the second request returns the denial immediately and shows nothing. Riders who tap
  through and deny would be locked out of GPS drives permanently, and that is precisely the group the
  fallback assumed it could recover.
- **1.1 made it an acceptance criterion** that no location permission is asked until "Let's roll".
  Onboarding is the far end of the app from there.
- **A pre-permission screen may not offer an escape** under a strict reading of 5.1.1(iv), so
  onboarding would have to march every first-timer into a system prompt they have no reason to accept
  yet — spending the one shot at its least motivated moment.

⚠ **On the "no Not Now" rule, our own decision doc is stricter than the evidence.** Apple's written
5.1.1(iv) forbids *manipulating, tricking or forcing* consent — which cuts against forcing everyone
into the prompt, not for it. The "must not carry a Not Now" line traces to a single forum rejection,
and the pattern Apple documents objecting to is a priming **button labelled like the system action**
("Configure Location Access"; they want a neutral "Continue"). Most shipped priming screens do offer
a bypass. Recorded because a future reader will otherwise inherit a hard rule built on one data point.

**What replaced it.** The region screen asks *"which roads?"* and offers **"Use my location"** as one
of the answers. That is the same permission request wearing an honest motive: it is in service of a
question the rider can see on screen, and choosing a region by hand is an *answer*, not a dismissal —
so there is no bare "Not Now" for a reviewer to object to, and the one shot is only ever spent by a
rider who chose to spend it. The prompt at "Let's roll" stays exactly where 1.1 put it, for everyone
who didn't.

## §3 · The region picker, not a label

The screen's region control is a **real picker from day one** (`useRegionPicker`, which already
exists), even though exactly one region is live.

⚠ **An affordance that only becomes interactive when region 2 ships is a known kill switch here.**
`home-cold-open-declutter.md` §18 records the chip shipping as a plain label until "region 2", which
combined with "auto-select only when there is exactly one region" to produce an unrecoverable dead
screen on installed builds. Same shape, same trap. A one-row sheet is not embarrassing: it tells a
newcomer the truth about coverage, which is the very thing the postcard exists to soften.

## §4 · Nearest region needs a wire change — the client has no coordinates

**This is the finding that costs the most and is easiest to miss.** The `Region` DTO the client
receives is `id`, `slug`, `displayName`, `ready`, `exampleAnchors` — and that last field is
documented as *"names only, no ids, no coordinates"* (`packages/shared/src/schemas.ts`). **There is
no geometry on the client**, so "pick the region closest to the rider" cannot be computed on-device
as things stand.

⚠ **AND THE OMISSION IS DEFENDED, not incidental** — this doc said "has no geometry" first and that
undersells it. `GET /regions` already SELECTS `regions.bbox` (it needs it to bucket example anchors by
point-in-bbox) and then builds the response field-by-field under an explicit guard: *"never
`{ ...r, exampleAnchors }` — a spread suppresses TypeScript's excess-property check, so `regions.bbox`
would ride out onto an anonymous wire with tsc perfectly green. The DTO says a region has no bbox;
keep it true."* So adding geometry is amending a boundary somebody drew on purpose, and the
distinction that makes it defensible is CENTRE vs BBOX: a centre says "Lake Tahoe is roughly here",
which the planner already says aloud to anonymous riders; a bbox says "our corpus sweep covers exactly
this rectangle", which is operator information about where we have built.

Two ways, and they are not equivalent:

- **Add a coarse region CENTRE to the DTO** (recommended). ⚠ Ship it `.catch`-guarded and optional,
  for the deploy-order reason `ready` documents: a client that knows the field talking to a server
  that does not yet send it must degrade to the Tahoe default, never throw — any throw here is
  mobile's blocking "please update the app" wall on the critical path. The pick happens on the phone, which means
  **the rider's coordinates never leave the device** — a strictly better privacy story than the
  alternative, and cheap server-side since a region already *is* a bbox
  (`geometry-first-regions.md`). A region centre is a public fact about a public place; INV-1 governs
  endpoint anchor ids and coordinates, which this is not.
- **Send the rider's position to the server** and let it answer. This puts rider coordinates on the
  wire and into a request body — new personal data in flight, on a path where CLAUDE.md already
  forbids logging bodies. Avoid.

Founder decision (2026-08-04): build the pick as a **pure, unit-tested function now** and wire it,
accepting that it is a **no-op that cannot be observed on device until region 2 exists** — with one
region, nearest always returns Tahoe, which is also the default. The tests are the only thing holding
it upright until then; that is the known cost.

## §5 · Where the "seen it" flag lives

`src/lib/client-flags.ts`, as an added FIELD — that file is explicitly written so a second flag is a
field rather than a new file, and it already carries the three traps this flag would otherwise
rediscover: the **document dir, never the cache dir** (an eviction would resurrect onboarding for
someone who finished it), **never keyed on the user id** (the anonymous user row is hard-deleted at
signup, so a user-keyed flag would re-show onboarding the moment a rider makes an account), and **not
purged on sign-out**.

## §6 · Alternatives

**A. Two screens: taste → where.** (Chosen.) Fixes the two things the cold open genuinely does not
do: the sample is a ghost text link today, so the most persuasive asset in the product is the least
visible thing on screen; and the region is auto-picked in silence, so no rider ever chooses it. Hands
off to the cold open unchanged.

**B. One screen — postcard and picker together.** Less ceremony, one fewer tap, and the region
question rides along with the audio instead of following it. Rejected for now because it crowds the
one moment that has to land: the rider should be listening, not deciding. Worth revisiting if the
two-screen version tests as a slog.

**C. Don't build it — fix both problems in place.** Promote the listen row on the cold open from a
ghost link to a real card, and make the region chip an explicit first-run question there. No new
flow, no persistence flag, no new screens, no wire change. **The honest case for this is strong**:
the cold open was redesigned on 2026-08-03 for exactly this job, after founder notes and outside
research, and putting a flow in front of it means the product has two front doors — the second of
which was designed to be the first. If onboarding ever starts feeling like ceremony, this is the
version to fall back to.

**Which I'd pick:** A, because the two gaps it closes are real and neither is closable by moving a
component around. **What would change my mind:** if the taste screen measures as a step riders skip
past — if `sample_played` on first run comes in low — then the audio was never the blocker and C is
the cheaper truth.

## §7 · Spend

**No new paid call.** `GET /sample` already exists and is anonymous and free (a presigned clip, no
model call); `GET /regions` is free. Onboarding adds no rider-triggered spend, so the caps in
`apps/api/src/limits.ts` are untouched and this needs no founder go on that axis. ⚠ And per §8 there is
now **no wire change at all** — the region centre §4 proposed was cut, so this shipped as a pure client
change against two endpoints that already existed.

## §8 · What changed during the build (2026-08-04) — READ THIS BEFORE §2 AND §4

Two founder calls landed after the sections above were written. Both narrow the flow; neither was a
preference.

**1. No location affordance anywhere in onboarding — §4 IS DELETED.** §2 dropped the dedicated
permission *screen* but kept a "Use my location" button on the region screen, and §4 built a whole
mechanism behind it: a region `center` on the `Region` DTO, derived from the bbox, plus a
`nearestRegionId` pure function on the phone. The founder cut the button — *"we should not ask for
location but just show the region picker so they can choose a default region"*, and separately:
*"location is still only asked right when they click 'start a drive' (and we don't already have
permission)"*.

That deletes §4 rather than deferring it, and the reason is worth keeping because §4's own recommendation
now reads as a trap. With no location ask there is **no rider coordinate on any onboarding screen**, so
nothing could ever consume either half: `nearestRegionId` would have had no caller and `center` no
reader. This repo has been bitten specifically by *"a constant or function with no production reader and
green tests around its definition"* — and §4 had even pre-authorised that state ("a no-op that cannot be
observed on device until region 2 exists... the tests are the only thing holding it upright"). Both were
written, tested green, and then backed out the same day; the wire is unchanged and `Region` still carries
no geometry. The tombstone that stops the next reader rebuilding it is in
`apps/mobile/src/lib/region-select.ts`, beside the `pickRegionId` it would have joined.

⚠ **Reopening "land them on their nearest roads" means reopening the PERMISSION question first**, not
the geometry question. The geometry was the easy half.

**2. The listen row is gone from home, not merely duplicated.** The brief said "move the sample screen
to this flow" and the founder confirmed the second half of that: *"we no longer need the sample chip on
the home screen since it was moved to onboarding."* So `ListenRow`, `voice.sample.row*` and the two
client flags that governed the row (`listenRowSeen`, `samplePlayed`) were all deleted, and
`home-cold-open-declutter.md` §14.2 is now history. `/sample` has exactly one entrance — the redirect —
and exactly one exit, forward to `/region-setup`.

⚠ **That is what makes the postcard's SKIP control load-bearing rather than polite.** With home no
longer pushing it, `canGoBack` is false on the first screen a fresh install shows; without the skip a
rider unwilling to stand still for a minute of audio would have no way out of onboarding at all. For the
same reason neither exit may be a `router.back()` — back lands on a home that immediately redirects
here, which is a loop.

**3. "Show the region screen only once there are two regions" was proposed and REFUSED (founder,
2026-08-04).** Post-build, I argued the region step was ceremonial while one region ships — it asks a
question with one possible answer, `pickRegionId` was already landing everyone there silently, and home's
chip shows and changes it anyway — and proposed rendering it only when `/regions` returns more than one,
on the grounds that it would self-activate on a `released_at` flip with no submission.

The founder refused: *"i will be adding more regions without releasing new versions of the app, so the
app has to anticipate multiple regions."* Right, and the proposal was worse than that objection states.
`onboarded` is per-INSTALL and set once, so a rider who installs under one region has their flag written
without ever seeing the question — and the conditional screen would then never appear for them, not when
region 2 ships, not ever. It would activate only for installs created AFTER the second region, leaving
the entire existing base pinned to whichever region sorted first, with no build able to reach them. That
is §18's kill switch again in a different costume: behaviour that varies by region count, landing on
installed apps.

**So the region step is unconditional, permanently.** ⚠ And the copy has to be count-agnostic with it —
`voice.region.setupBody` shipped reading "*this* is where I know every turn", which assumes exactly one
region and would have gone stale on installed apps the day Yosemite released. Fixed to "these". The
block's own header already carried that rule ("it has to stay true the day there are six") and the first
string written under it broke it anyway, which is worth more than the fix.

⚠ The residual gap is now filed as TODO **#73**: riders who onboarded before region 2 are never re-asked
and can only discover it via home's chip. **Do not solve that by re-running onboarding.**

**Also worth recording: the sample no longer autoplays** (§1 called this, and it survived the build).
The 450 ms anti-jump-scare beat was defensible behind a deliberate tap on home's listen row; as the
first screen of a fresh install it is not, because this surface takes exclusive `doNotMix` focus and
would stop a stranger's podcast as the app's opening move. One consequence rippled into telemetry:
`sample_played` lost its `autoplay` property, since every play is now deliberate and a field with one
possible value reads like a signal while carrying none.
