# The sample "postcard" — a curated taste for everyone outside Tahoe

> **Status:** DECIDED + BUILT 2026-07-16. The corpus is Lake Tahoe only, so a first-timer (or an Apple
> reviewer in Cupertino) who taps the primary "Ride Along" CTA gets 0 pins and a terminal
> "I don't know these roads yet" dead-end. This adds a **`/sample` postcard**: ONE curated, iconic clip
> (`SAMPLE_NARRATION_QID`, default Emerald Bay State Park `Q1335376`) that autoplays instantly,
> account-free and permission-free, then offers "Ride along for real". Reached from three entry points;
> served by a new anonymous `GET /roam/sample`. Verified E2E against the live corpus (Emerald Bay, 64s,
> CC BY-SA, presigned audio serves 206) and the soft-404 + rate-limit paths.

## Why a curated single clip, not the sim drive

The existing `?mode=sim` roam replay was the obvious reuse, and it's wrong for this. A design panel +
three adversarial judges converged on the postcard because the sim ride is **non-deterministic**: its
first encounter fires on proximity as the fake GPS crosses a pin, so it can open on a silent idle
vista, and it ends in ~1.8 min of dead air (`onEnd` undefined). A reviewer might hear nothing. A
curated clip lands the Skipper in the first breath, every time, and closes with a real forward CTA the
sim ride lacks. It also presigns an **existing** R2 narration — zero GCP spend, no paid run, no founder
"go" needed to ship.

## The diagnostics trap (fixed at the root, separately)

`?mode=sim` didn't just replay GPS — `roam.tsx` had `diagEnabled = __DEV__ || roamMode === 'sim' || showDiag`,
so entering sim also unhid a raw dev telemetry footer (`N pins · GPS Xs · nearest Y m`). Any user on the
sim deep link or the Settings sim toggle saw it. The postcard never imports `useRoam` so it's immune by
construction — but this change also decouples the root: **`diagEnabled = __DEV__ || showDiag`**. Sim is a
GPS *source*; telemetry visibility is owned by `__DEV__` + the purpose-built `showDiag` toggle, exactly
as `sim-mode.tsx` documents.

## Three entry points, one screen

A no-coverage button alone wouldn't clear App Review: a reviewer who **denies** location never reaches
`noCoverage` (the live path stops at the permission gate), and one who just browses home sees nothing.
So the **home ghost link** ("Not near Tahoe? Hear a quick sample") is the primary, permission-free path;
the **noCoverage StateView action** rescues the grant-then-empty rider (passing `?from=roam` so the end
CTA returns to the existing roam instead of stacking a second); and the **play.tsx account-gate
secondary** ("Just take the sample ride") is repointed off its old `?mode=preview` self-loop — which
re-hit the same 401 forever — onto `/sample`, killing that dead-end and collapsing the two half-built
"sample" ideas into one.

## Gotchas baked into the build

- **`didJustFinish` can be dropped** by an OS audio interruption (useRoam/useDrive defend the same way).
  The end card would otherwise never appear, stranding the rider with no CTA — the exact funnel this
  screen closes. `sample.tsx` also flips to `ended` when playback stops at/near `duration`.
- **Rate limit:** `app.use('/roam', …)` matches the exact path only in Hono — NOT `/roam/sample` — so
  the endpoint needs its own `app.use('/roam/sample', rateLimit(...))` or it's an uncapped anonymous
  DB+presign. Added (30/min).
- **Go-live gate:** if `SAMPLE_NARRATION_QID` is unset or its clip gets pruned/withheld, the endpoint
  404s and the screen shows a retry (never a crash) — but the reviewer's path won't play. Setting it to
  a stable, iconic, released clip is on the submission checklist.

## Competitor lesson applied

Copy the category's play-before-commit onboarding (Autio's few-seconds-of-any-story, GuideAlong's free
sample tour) — a region-honest playable taste before asking for anything. Do NOT copy the answer that
actually removes Autio's empty state: national ~25k-pin coverage (doctrine-forbidden, and it bought a
niche plateau). The badge stays place-honest ("a taste of Tahoe"), never a national-coverage fiction.

See [region-corpus-discovery.md](region-corpus-discovery.md) (why one region), and the App Review notes
in [../guides/app-store-submission.md](../guides/app-store-submission.md).
