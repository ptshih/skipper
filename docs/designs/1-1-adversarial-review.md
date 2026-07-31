# 1.1 adversarial review — what an outside pass found in the spec

> **Status:** REVIEW FINDINGS, 2026-07-31. **Not decisions and not greenlit** — this is an outside
> pass over [drives-first-1-1.md](drives-first-1-1.md) and the code it describes, produced while 1.1
> was mid-build (step 1 landed, step 2 not started). Read it as a punch-list to triage, not as truth
> that overrides the spec: **where this doc and the spec disagree, the spec is still the build truth
> until the founder rules.** Line numbers were correct at `bd8f368` and drift — **code wins.**
> Post-1.1 material (1.2 candidates, charm, cuts, refusals) lives in
> [post-1-1-slate.md](post-1-1-slate.md).

## How this was produced, and how much to trust it

Ten independent read-only lenses over the spec + repo (spec red-team, forgotten work, cuts, refactors,
the planner, mobile UX, charm, corpus, business, ops), then an **adversarial verifier per lens** that
re-read the source and returned CONFIRMED / PARTIAL / REFUTED on every factual claim, then one
synthesis pass. 92 raw findings → **11 dropped** (2 on refuted premises, 9 restating a settled `D`),
21 merged into 8, **12 corrected** by a verifier.

Confidence rules used below:
- Every claim about the code was checked by a verifier that had to quote `file:line`.
- **Five load-bearing claims were then re-verified by hand** for this write-up: `via` is unguarded
  (`schemas.ts:206` → `drives.ts:427`,`:539`), `loadRegionAnchors` has no `ORDER BY`/`LIMIT`
  (`drives.ts:97-116`), `drives.route_sig` has no reader outside the table D25 deletes, `FREE_DRIVE_CAP`
  is **10**, and the App Store state (below).
- ⚠ **The one thing that decays fastest:** ASC state. Probed read-only 2026-07-31 —
  **exactly one version: 1.0.0, `WAITING_FOR_REVIEW`, release type MANUAL, created 2026-06-10.**
  A reviewer picking it up changes §3.1 silently.

⚠ **Two findings were already overtaken by the founder while this ran** and are corrected in place:
the brief `FREE_DRIVE_CAP` 10→100 was reverted (`3f1d284`), and "should the conversation be metered?"
was answered — **planning is never metered, only the artifact is**
([../decisions/free-allotment-through-1-1.md](../decisions/free-allotment-through-1-1.md), `bd8f368`).

---

## 1. Raise with the builder NOW

These change what is being built this week, or are expensive to retrofit once a step lands. Each names
the build step it touches.

### 1.1 — INV-1 stops at start/end; `via` still carries whatever the caller sends ⟶ step 4

`via` is `z.array(resolvedEndpoint).max(8).optional()` (`packages/shared/src/schemas.ts:206`) and flows
straight into `routeWaypoints` → `materializeRoute` at **both** call sites (`apps/api/src/drives.ts:427`
propose, `:539` create). The spec's acceptance line reads *"rejects a non-anchor **endpoint**"* — an
implementer can satisfy it exactly and still ship an unauthenticated endpoint that bills Google Routes
for **8 arbitrary points on Earth**. Hydrate `via` through the same by-id + `endpoint_eligible`
re-assert, and change the acceptance line to "a non-anchor endpoint **or via waypoint**".

`effort S · downside: round trips can then only turn around at a curated place, and widening that set is a paid curate-places run (INV-2)`

### 1.2 — The `/drives/plan` mount trap is ORDER-dependent, and nobody wrote the order down ⟶ step 6

Tested against installed hono 4.12.30: a parent-registered `app.post('/drives/plan', h)` **above**
`app.route('/drives', driveRoutes)` runs zero middleware and returns 200; **below** it, `requireAccount`
fires and every anonymous plan 401s. `index.ts:143` already registers the propose limiter above the
mount — register the plan route next to its limiter and it is safe by construction. Then pin it with a
request-level test asserting 200-without-session, so a later file reshuffle cannot silently re-wall the
whole anonymous funnel.

`effort S · downside: a comment plus one test is all that holds an ordering invariant`

### 1.3 — INV-15's mitigation is the wrong control ⟶ step 8 pre-work

The hazard is real: `GET /drives` 401s only on `!userId`, then `ensureFreeGrant(userId)` writes an
append-only ledger row against a user better-auth will hard-delete with no cascade. But **"deploy 8a
before the mobile mint" is backwards** — today, and after a *correct* 8a, `GET /drives` sits behind
`requireAccount` and the mint is harmless. The hazard is **intra-8a**, opened only if 8a drops the gate
from `GET /`. Deploy ordering cannot detect that; a test can.

The real control is a request-level test asserting all five owner routes 401 for `user.isAnonymous`.
It is blocked by `auth.ts:52-59` throwing at module load — and the fix is already blessed twice in this
repo: wrap `betterAuth({…})` in a **memoized** `buildAuth()` behind `createLazyProxy`
(`packages/db/src/client.ts:49-57`, already used at `auth-db.ts:36`), plus an explicit `assertAuthEnv()`
at `index.ts` top level. Verified safe: `auth` has exactly two value uses (`index.ts:136` `auth.handler`,
`entitlements.ts:34` `auth.api.getSession`), both survive the proxy's bind, and `typeof auth.$Infer.Session`
is type-level. ⚠ **`buildAuth` must memoize** — the naive proxy calls the factory on every property read.

`effort M · downside: fail-fast moves from import time to an explicit assert; a future entrypoint that forgets it degrades to a first-request 500`

### 1.4 — Four planner-call parameters have no home in code, and three fail SILENTLY ⟶ step 6/7

- **(a) Effort has no constant.** `limits.ts:91-101` owns `PLANNER_MAX_TOKENS = 2048`; effort lives only
  as prose in D33. The API default is `high` — high-effort thinking against a 2048 ceiling returns
  **HTTP 200** with `stop_reason: 'max_tokens'` and **no tool_use**. Put `PLANNER_EFFORT` beside the
  token cap with the pairing rationale in the same comment; that is INV-12's whole thesis.
- **(b) `thinking.display` defaults to `omitted`** on Opus 5, so thinking blocks stream with empty text
  and the wire is silent for the entire thinking phase — D33a's streaming build buys nothing on the
  slowest part of the turn. Set `display: 'summarized'` and use the *arrival* of `thinking_delta` as a
  liveness heartbeat, never rendering the content (INV-13: drop it at the parse boundary).
- **(c) `stop_reason` must be a total switch.** `refusal` also returns 200 with empty/partial `content`,
  so `content[0]` throws. Every branch resolves to a Skipper line. ⚠ Do **not** reach for the
  server-side `fallbacks` param — a second billed model on a rider-triggered path is a founder decision
  (INV-11), not a resilience tweak.
- **(d) Cancellation.** `apps/mobile/src/lib/api.ts` has an internal `AbortController` (`:129-130`,
  `:153`) but no caller-supplied seam — and because `signal:` is written **after** `...init` is spread,
  a caller's signal is silently clobbered. Thread one through to `c.req.raw.signal`, or a rider who
  backgrounds the app bills Opus to completion.

`effort M · downside: (a)-(c) are constants and branches; (d) is three integration points that can each silently no-op`

### 1.5 — Make `say` a plain TEXT block; let the tool carry only the route ⟶ steps 6+7

With `say` inside the tool input you must force `tool_choice` every turn to guarantee a reply — which
forces a route object onto turns where D11 says no route should exist. As a text block it streams
natively as `text_delta`, which **deletes the `input_json_delta` partial-JSON accumulator on both
sides** (most of D33a's budget); tool_use then appears only when there *is* a route; and on Opus 5 with
thinking on the block order is thinking → text → tool_use, so `say` streams first.

⚠ **This also corrects a safety claim in the spec.** D9/§planner say tool-use output "is what makes D9
structural". It isn't — `say` is free text either way. **D9's guarantee comes from withholding the
corpus and the fact sheets**, not from the output shape. Worth fixing in the spec's prose so nobody
later relaxes the withholding on the belief that the envelope is doing the work.

Render at **sentence** granularity, not character-by-character (`NowCard.tsx:56-59` already records the
live-region flooding lesson), with a ~600 ms max-hold.

`effort M — net NEGATIVE vs the planned build · downside: a turn can return an empty text block, so the handler needs an explicit fallback; `strict: true` no longer covers `say`'s presence`

### 1.6 — The cached prefix is one unordered query from a ~10× input-cost regression ⟶ step 6

`loadRegionAnchors` (`drives.ts:97-116`) has **no `ORDER BY` and no `LIMIT`** — hand-verified. The spec
defers this to step 6; do it there, plus build the serialized anchor block **once per process** rather
than per request. Measured on the live DB: lake-tahoe's 26 endpoint-eligible rows serialize to 2,918
chars ≈ **1,007 input tokens**, which clears the cacheable minimum — ⚠ but note the model constant in
code is `claude-opus-4-8` (`packages/shared/src/models.ts:12`, 1024-token minimum), **not** the
`claude-opus-5` the spec names; only Opus 5 halves that to 512. Then *assert* it: log
`cache_read_input_tokens` and treat a run of zeros as a bug — **a broken cache looks identical to a
working one from the response body.**

`effort S · downside: per-process memoization means a curate-places run doesn't take effect until instances recycle — write that down or someone loses an afternoon`

### 1.7 — RISK-4 is accepted, but it is currently both undetectable and unstoppable ⟶ step 6 + deploy config

Four cheap controls, in order:

- **(a) `--max-instances` in `cloudbuild.yaml`.** The deploy step passes only
  `--image/--region/--no-invoker-iam-check/--set-secrets`; verified live, `maxScale` is the platform
  default **100**. That is the multiplicand in "the effective limit is limit × live instances". Nobody
  has to build a shared-store limiter; someone has to set a flag.
- **(b) One structured cost line per plan call** — `{evt:'plan_spend', model, in, out, cache_read, usd,
  stop_reason}`, counts only, never a body — plus a log-based metric and a budget alert.
  `recordModelUsage` writes to a process-global `Map` built for a CLI that exits (`spend.ts:44-56`); it
  is read and persisted on the *studio* side (`job-progress.ts:110` → `studio_jobs.costUsd`), but there
  is no readout on the API side and cannot be one under autoscale. Also emit `plan_degraded` when
  `stop_reason !== 'tool_use'` — **that paid-call-produced-nothing case returns 200**, so every 5xx
  alert stays green while the product is broken.
- **(c) An Anthropic Console workspace spend limit on a separate api-only key** — the only true hard
  ceiling available. ⚠ **The Google half does not exist**: Routes documents adjustable *per-minute*
  quotas (3,000 QPM) and no per-day cap. Don't budget time for it.
- **(d) A `PLANNER_DISABLED` env flag** returning the RISK-2 in-persona outage state with no model call.
  Verified `dotenvx run` without `--overload` lets a Cloud Run `--update-env-vars` win, so it is a
  30-second flip with no build.

`effort S each · downside: a hit vendor cap is an outage, not a throttle — set it 10-20× expected and pair with the alert; max-instances becomes an availability ceiling the day traffic is real`

### 1.8 — Step 2's district re-anchor is not free, and the offsite snapshot still gates it ⟶ step 2

`drive-select.ts:169`'s `if (cand.area) continue` is **not scaffolding** — its comment records that a
district's point is an un-snapped enclosing-circle centre with a radius capped at 600 m against a true
914 m extent. D40 deletes the guard so it "has nothing left to guard"; after that `clusters.ts:230-233`
passes `radiusM` **uncapped** and `drive-select.ts:170-176` admits anything at or below
`CLUSTER_MAX_TRIGGER_RADIUS_M` — i.e. a de-`area`'d district becomes admissible to a **frozen selection
a rider paid a non-refundable credit for**.

⚠ **Correction to D22's "verified free":** re-anchoring does *not* yield a road-adjacent point. A
cluster stores no coordinate at all (`schema.ts:393-424`); the lat/lng is `clusterTrigger()`'s
minimal-enclosing-circle centre, and `cluster.ts:150-156` says outright that it "can sit away from any
road" and that snapping to a member anchor "is deliberately not done". The only road-snapped case is a
**single-member** cluster. So D22's freeness covers the **scripts**, not the **geometry**: either give
each of the five a hand-checked anchor, or keep districts out of drives and lose five clips.

⚠ And **step 0's offsite copy is still owed** and gates step 2's destructive work — 488 MB sits in
`packages/studio/.scratch/snapshot-2026-07-31`, one `git clean -xdf` from gone.

`effort M · downside: five hand-checked anchors is work D22 claims it doesn't need; the cheap alternative loses content`

### 1.9 — The subject-keyed store collapses N copies to 1, and `dir.delete()` doesn't know that ⟶ step 9

Today every byte path is reconstructed from the drive's own id (`offline.ts:73-82`, `:435`) with
seq-scoped filenames, and delete is `dir.delete()` on the whole per-drive directory (`:598`) — nothing
can be shared, so nothing breaks. INV-6's re-key creates two consequences it does not name: the second
drive's `File.moveSync` targets a path the first already occupies (**resolve collisions deliberately**,
don't discover expo-file-system's overwrite/throw behaviour mid-upgrade), and after the collapse
**deleting drive A can silently break drive B**. `dir.delete()` must become a refcount or an orphan
sweep in the same step. Both failures land on a rider offline at a trailhead, and both are silent — the
drive still lists as downloaded.

`effort M · downside: refcounting in the one module that must never lose a download, added in the same step as the re-key`

### 1.10 — `/drives/propose` has no zero-stop guard, and D14 routes the whole funnel through it ⟶ step 4 / 8a

`POST /drives` 422s `no_stories` on an empty selection (`drives.ts:549-569`, with a loud diagnostic).
`/propose` shares the selector and has **no length check anywhere** (`:413-448`) — it returns 200 with
`estStopCount: 0`. Under D14 the anonymous rider's entire experience *is* the proposal, and INV-5's one
preview clip comes from that same selection: a 0-stop proposal renders a preview card with no clip and
no explanation, the rider crosses the wall, creates an account, **then** gets the 422. Free text makes
degenerate pairs far more reachable than two pickers did. Set a floor (~3 stops), return it as a typed
reason, have the planner re-ask in persona.

`effort M · downside: the floor is a product judgement with no right answer, and it adds a second in-persona refusal the prompt must carry without drifting into place discussion`

### 1.11 — Three surfaces need anchor NAMES on the client; the removal table deletes the only source ⟶ step 4 + 6

RISK-2's sole degradation path is "the anchor list inline", D18 wants the same offline, D17's example
asks must name real places, and INV-1's off-list deflection wants *"here's what I do know"* — but the
removal table deletes `GET /drives/anchors` as a public route and D7 deletes its consumer. (Correction:
`/drives/propose` is public and its `resolvedEndpoint` carries `name`, so names aren't absolutely
absent — there is no public source for **the list**.) Cheapest fix inside step 4's already-batched
`schemas.ts` visit: `region` gains `exampleAnchors: string[]` (3-6 featured names); `GET /regions` is
already public and already fetched.

⚠ **Decide alongside it: the planner is implicitly single-region.** The region selector lives in
`create.tsx`, which D6 deletes, and nothing in the plan path supplies a bbox. Either send all released
regions' anchors labelled by region and let the rider's words pick (with an explicit in-persona
cross-region refusal), or state single-region as a decision. Deciding *after* the prompt and the cached
prefix are written is a rewrite of both.

⚠ Note for D17's copy: `voice.ts` **already violates** its own DESIGN.md §7 invariant with 10
hard-coded "Tahoe" strings (`:187`, `:201`, `:206`, `:280`, `:385`) — so "keep delivery in `voice.ts`,
interpolate names from the served list" is a repair, not a new rule.

`effort S · downside: publishes a slice of the curated allowlist (names only) — a deliberate call, not a silent fix`

### 1.12 — Step 7 has three landmines that only appear on a device ⟶ step 7

- **(a) `Screen.tsx:84-95` is a bare ScrollView** — no `KeyboardAvoidingView`, no
  `keyboardShouldPersistTaps` (defaults to `'never'`, so **every D17 chip tap and every "yes, draw it
  up" costs two taps**), no `keyboardDismissMode`, no scroll-to-end ref. There are zero
  `KeyboardAvoidingView` uses in the app; the one keyboard-aware list is `create.tsx:365-366`, which D6
  deletes. Build a `ConversationScreen` (or a `keyboard` flag) and leave the other ten screens alone.
- **(b) The preview clip scrolls away while playing.** Roam already paid for this lesson:
  `voice.ts:170-174` documents the peek bar as *"the couldn't-get-the-player-back fix"*. Pin one mini
  transport above the composer whenever the clip plays, plus pause-on-blur.
- **(c) D35 is a REVERSAL of two shipped surfaces, not a new setting.** `useStopPreview.ts:57-62` and
  `sample.tsx:57-63` both set `interruptionMode: 'mixWithOthers'`, both with comments arguing *for*
  politeness, and `useStopPreview.ts:107` re-asserts it specifically to undo a drive's leftover
  `doNotMix`. `setAudioModeAsync` is process-wide — flip it **and rewrite both comments**, or the next
  agent "fixes" it back.
- **(d) Cheap and worth it:** when `useIsOffline()` is true (already wired at `index.tsx:28`), invert
  home — MY DRIVES on top, conversation collapsed to a non-interactive card, composer autofocus
  suppressed.

`effort M · downside: (a) is a second Screen shell in a design system whose point is one shell; (d) softens D6 in exactly the state where D6 matters least`

### 1.13 — The wall: pick the shape before 8c, and never auto-spend on return ⟶ step 8c

⚠ The obvious implementation is a trap. The RN `Modal` at `AttributionButton.tsx:45` is the only sheet
precedent in the app, and an RN `Modal` renders **above the whole navigation stack** — so
`router.push('/sign-in')` from inside it (which *is* the wall's primary action, `AccountGate.tsx:41`)
renders sign-in **underneath**. Two viable shapes: a modal **route** (`presentation: 'formSheet'` +
detents — verified supported on the installed expo-router 57.0.8 / react-native-screens 4.26, and no
screen sets `presentation` today), or the wall as **the skipper's next turn** in the stream (cheaper
and more in character, but auth fields fight the keyboard and any OAuth path punts to a browser
mid-turn).

Either way: **on return, do not re-fire `POST /drives`.** The fresh account's grant only exists after
signup, so the number D29 requires you to disclose does not exist at wall time, and the pre-signup
idempotency key belonged to a user row better-auth just hard-deleted (INV-4). `sign-in.tsx:75-76`
already `router.back()`s and home stays mounted with the transcript — so: return, re-read credits,
re-render the card with the disclosure filled, **one more explicit tap.**

Copy that fits the persona: *"You're in, friend. First one's on the house."* / CTA
`Make this drive · 1 credit`. On the D29-vs-hint tension, name **ownership** always ("you'll need a free
account to keep this drive") and name the **credit** per the freshly-decided allotment posture
([../decisions/free-allotment-through-1-1.md](../decisions/free-allotment-through-1-1.md)).

`effort M · downside: one extra tap at the highest-intent moment`

### 1.14 — Three things that are free ONLY if they land inside step 4 / step 6

- **(a) The skipper NAMES the drive.** Add `title` (≤60 chars) to the tool output; write to
  `drives.label`. The column is already nullable (`schema.ts:683`) and both read paths already fall back
  to `${start} → ${end}` (`drives.ts:721`, `:832`), so a null title degrades to exactly today. MY DRIVES
  stops being a list of arrow-separated place pairs. ⚠ `index.tsx:258` renders the label through
  `cleanPlaceName()` — built for place strings, it will mangle prose; that call must become conditional.
- **(b) Stop NAMES on the preview card.** `/propose` already runs the real selection (`drives.ts:434`)
  and discards everything but `.length`; the engine's stop already carries `name` (`drive-select.ts:73`,
  `:261`). *"Cave Rock · Vikingsholm · Emerald Bay — and five more"* instead of "7 stops" is the
  **anticipate beat**, for one array on a DTO step 4 is already opening.
- **(c) Backfill `selection.poiId` first.** The legacy coalesce (`schema.ts:149-157`) is the only reader
  of `item.poiId`, and live: **3 drives, 18 items, 100% legacy-shaped, all resolving to `pois`, zero
  ambiguity** — including the newest drive (2026-07-28), so this is not a stale minority. Do it before
  step 4 and `subjectId`/`subjectKind` are required by construction instead of inheriting nullability
  into the offline store key. The write path at `drives.ts:582` still emits `poiId`, so the code half is
  a two-line removal.

`effort S each · downside: (a) model-authored text on a row needs a cap and a fallback; (b) makes /propose a cheap anonymous corpus enumerator, so cap the array; (c) is a destructive jsonb UPDATE on the one shared prod DB — preview-then-apply with a row count`

### 1.15 — Prompt/wire hardening the spec's one clause test doesn't cover ⟶ step 6 (+7 for d)

- **(a) Reject `role: 'system'` inbound.** D10 makes the transcript client-held and re-sent whole; on
  Opus 5 a `system` message inside `messages[]` is a supported **operator-authority** channel with no
  beta header, so an unvalidated passthrough hands any caller the operator voice. Constrain the wire
  transcript to `z.enum(['user','assistant'])` with plain text only (no tool_use, no thinking blocks —
  which also keeps INV-13 true and makes `MAX_PLAN_TOTAL_CHARS` actually bound tokens). The server
  becomes the sole writer of `system` turns, appended **after** the cached prefix so it can carry the
  draft route and turns-remaining without invalidating the prefix.
- **(b) A second deflection clause: "start from where I am."** D9 covers place *questions*; the first
  thing a real rider types is *"somewhere near me"*. INV-1 forbids coordinates and acceptance demands no
  location prompt anywhere pre-drive, so without an explicit clause the model invents a plausible nearby
  anchor, or the client grows a location request "to help". *"I don't do 'here', friend — I go by
  landmarks. Closest ones I know: {A}, {B}, {C}."* Add it to the step-6 clause test.
- **(c) Turn 1 costs zero dollars.** If D17's asks are literal buttons with known strings, hand-author
  their first replies and serve them with **no model call**, seeding the exchange into the transcript.
  Same for empty or over-cap input. Highest-traffic turn, founder-quality prose, and it removes the top
  tap-loop amplification path under RISK-4.
- **(d) At the turn cap, replace the composer** with the skipper's wrap-up + "Draw it up" / "Start
  fresh". A greyed-out field reads as broken, and the server's INV-3 bound must land on the same surface.

`effort S each · downside: (a) is model-gated — a future Sonnet returns 400 on system-in-messages; (c) keys on exact string equality, so it rots the moment the copy is edited`

---

## 2. Before submission (not blocking the build)

### 2.1 — The published privacy policy affirmatively DENIES what 1.1 does

`apps/site/src/pages/privacy.astro:209-212` says: *"Nothing about you or your drive is sent to the AI
services that write and voice it. There is no AI in the app listening to you or reacting to where you
are."* The sub-processor list (`:188-207`) has six entries — Neon, Google, Cloudflare R2, Resend,
PostHog, Apple — and a case-insensitive grep for `anthropic|claude` over that file returns **zero**.
**That page is the Privacy Policy URL on the live App Store record.**

The same pass fixes `privacy.astro:90-94` ("you pick your start and end from a list of real, curated
places"), and the roam prose in `terms.astro:122`, `support.astro:62`, and `about.astro:60` (the GEO
page written to be model-cited). Separately re-derive `../guides/app-store-submission.md` §8: it
justifies "User Content: Not Collected" with *"the FROM/TO pickers choose from a curated anchor list —
no free text and no geocode"* (`:311-315`), which D7 makes false. Write the transient-processing
reasoning down explicitly — **INV-13's no-persistence is what earns the exemption.**

`effort M · downside: legal prose the founder must own; the page is already marked NOT LEGALLY REVIEWED, and it deploys on its own path filter`

### 2.2 — Three of six screenshots and the reviewer notes show screens 1.1 deletes

ASC holds exactly 6 `APP_IPHONE_67` assets (`01-home`, `02-encounter`, `05-plan`, `07-player`,
`03-map`, `04-player`) and 1 preview. Home is replaced (D6), the roam encounter screen is gone (D1),
and `05-plan` is the START/END picker (D7) — including the hero shot. (Correction: the 28s preview
shows the **sample** flow, not roam, so it survives content-wise, but it bakes the `/roam/sample` m4a
that D2 re-paths.) Recapture is a signed Release build, dark mode, `simctl status_bar`, the branded-frame
compositor, plus `recordVideo` + ffmpeg audio mux — budget it as its own step alongside 12. Also rewrite
§10's reviewer notes (they walk a reviewer through "Ride along", the intro card, and the greyed-out
picker) and fix §12's checkbox, which probes `GET https://api.skipper.fm/roam/sample` — **that 404s on a
healthy 1.1 deploy and reads as a broken sample.**

`effort L · downside: can't start until step 7's UI is visually settled, so it serializes behind the riskiest client work`

### 2.3 — Name the analytics event set, and write down why `identify()` is forbidden

Verified: `track()` has exactly **one** call site in the app — `_layout.tsx:68`, `font_load_failed` —
and `identify` appears nowhere. D25 drops `drive_demand` on the grounds that "PostHog is the demand
instrument", so 1.1 removes the only mode with field data **and** makes an uninstrumented conversation
the whole product. Proposed funnel: `plan_opened → plan_turn_sent{turn_index} → proposal_shown{stop_count,
duration_min, round_trip} → preview_clip_played{completed} → wall_shown → signup_completed →
drive_created → drive_started`.

⚠ **The load-bearing rule:** INV-4 hard-deletes the anonymous row and mints a fresh id, so PostHog's
device `distinct_id` is the **only** spine that survives the wall — adding `identify(userId)` would both
break the funnel and falsify the privacy label's Linked=No rows. Type `AnalyticsEvent` now, while there
is one call site (a five-line diff), rather than at sixteen.

`effort M — names decided before step 7 · downside: every property is a step closer to logging rider prose; `char_count` is safe, the message is not`

### 2.4 — A planner fixture set: adversarial transcripts + two cheap judges

RISK-5 accepts that the deflection is prompt-held with a single substring assertion in front of it. Two
free-to-cheap instruments: **(a)** a deterministic check that every capitalized token run in `say`
appears in the anchor names / region name / a stoplist — anything else means the planner named a place
it was never given (a **signal**, not a gate: making it fail-closed swaps charm for canned copy on a
false positive); **(b)** a voice-consistency read — 1.1 is the first time a rider hears the skipper in
**two media ~90 seconds apart** (live text, then a baked clip), and nothing covers that seam. Honestly:
a 20-minute founder read-through of 20 captured `say` lines gets most of the value for $0; the
`eval/charm.ts`-shaped judge only earns its keep if the planner prompt iterates a lot.

`effort M · downside: fixtures are captured output checked into studio (apps/api can't depend on @skipper/studio), so they go stale silently`

### 2.5 — Point the uptime check at `/regions`, add a 5xx alert, smoke the deploy, split the key

`/health` is `c.json({ok:true})` with zero deps (`index.ts:69`) — it stays green through a rotated
`DATABASE_URL`, a Neon failure, an undecryptable `.env.production`, and a missing `ANTHROPIC_API_KEY`.
The deploy guide already treats `/regions` as the real smoke test
([../guides/gcp-cloud-run-deploy.md](../guides/gcp-cloud-run-deploy.md):105) — make the alerting agree
with the runbook, plus a zero-code alert policy on `run.googleapis.com/request_count` filtered to 5xx.
Add a fourth `cloudbuild.yaml` step curling `/health`, `/regions` (non-empty), and one minimal plan
turn — that catches "the image has no working key", "the model id is wrong", and "the plan mount
inherited requireAccount", none of which any test can see. ⚠ Traffic already shifts to the new revision
at 100% (verified `latestRevision: true`), so a smoke step **detects, it does not prevent**. And mint a
**second** Anthropic key for `apps/api` so a rider-path revocation doesn't kill the narration pipeline
— with the rotation path written down, because `.env.production` sits outside every trigger's
`includedFiles` (verified), so `dotenvx set` + commit does **not** deploy.

`effort S-M · downside: a DB-touching uptime check every 5 min keeps Neon awake (cost unverified — the autosuspend setting lives nowhere in git); the smoke turn spends real money from CI and needs one recorded founder OK`

### 2.6 — Sweep the marketing site the removal table never mentions

`apps/site`'s `Modes.astro` is a whole section built on "Guided Drive + Free Roam" (its own header calls
Roam *"honest and differentiating"*), linked from `Nav.astro:18` and `SiteFooter.astro:23`. The natural
replacement is what 1.1 finally makes possible: a **scripted, non-live typing replay of a conversation**
— pure CSS/JS, no backend, no CORS, and no anonymous paid endpoint exposed to the open web. This is the
first release where the landing page can demo the product without a car.

`effort M — claim the path, it collides with step 10 · downside: a scripted replay is a fake that always goes well; only the legal half (2.1) is actually load-bearing`

---

## 3. The three decisions

### 3.1 — Hold 1.0.0 out of the public store; make 1.1 the first public version

**Recommendation: take the approval, hold the release (release type is already MANUAL), and if the hold
window won't stretch to 1.1, remove from review before step 3 lands.**

Probed read-only 2026-07-31: **1.0.0, `WAITING_FOR_REVIEW`, MANUAL, created 2026-06-10.** The listing
sells "TWO WAYS TO RIDE / Ride Along: free, no account" — the one headline 1.1 deletes — and step 3
breaks the exact endpoint §12 tells the reviewer to check (`api.skipper.fm/roam/sample`), against a
Cloud Build trigger that deploys push-to-`main` at 100% traffic. The cost is real and worth naming:
every store-side instrument slips (the branded-search baseline, `APP_STORE_URL`, the site's download
button, the JSON-LD `sameAs`), and the 1.0 review effort produces zero user-facing result.

⚠ **This expires silently the day a reviewer picks it up** — it is today's decision, not this week's.

### 3.2 — Move `say` out of the tool input and make it a plain text block

**Recommendation: yes, and decide before step 6 writes the tool schema.** It deletes the partial-JSON
accumulator on both sides (most of D33a's budget), removes the forced-tool-call-vs-D11 collision, gets
`say` streaming first under Opus 5's block order, and stops the spec asserting a safety property the
mechanism does not deliver (§1.5). It is a genuine re-decision of a settled D33a, and the price is an
explicit fallback for an empty text block. **Bundle the four planner-call parameters (§1.4) into the
same decision** so step 6 starts with all of them settled.

### 3.3 — Keep the anonymous mint (D16), but replace INV-15's mitigation

The case for dropping D16 is strong on paper: INV-12 already says the session key is "a convenience,
not a control — the IP key is the real bound"; INV-4 says the row is hard-deleted at link anyway;
PostHog's device id already covers analytics; and dropping it evaporates RISK-3 (a server-side row the
rider cannot delete in-app, against 5.1.1(v)), all of INV-15, and step 8's deploy gate.

**Recommendation: keep it anyway.** Step 8 is already scoped into three commits, better-auth's link flow
is the trodden path, and hand-rolled post-signup continuity is new code on the highest-stakes path in
the release. What must change is the **control**: INV-15's "deploy 8a first" ordering is not a
mitigation, because the hazard is intra-8a (§1.3). Replace the ordering framing with the request-level
test — which is the actual work item, and which is blocked on making `auth.ts` side-effect-free.

⚠ **If the founder would rather buy the simplification, say so before step 8a starts.** After it, this
is a rewrite, not a decision.

---

## 4. What this review got WRONG (recorded so it isn't re-derived)

- **"Build a co-located-coordinate detector"** — already built (`f210bcb`), wired into
  `discover-pois.ts:155` and `prune-corpus.ts:170`, unit-tested, and already run: 13 pairs, 12 benign,
  1 real bug. The proposed second signal is also dead: the repo never fetches enwiki `prop=coordinates`;
  coordinates come solely from Wikidata P625.
- **"Scope Yosemite's paid enrich by road legibility"** — `speakable_road_class` has **0** non-null rows
  in the Yosemite bbox (Tahoe: 681/764). The filter does not exist there; the premise is absent until a
  free re-snap runs.
- **"The credit hint branch is dead at cap 100"** — the cap was briefly 100 on 2026-07-31 and was
  **reverted to 10** the same day (`3f1d284`), and the hint is now deliberately gated to a low balance.
  The finding's arithmetic was true for about an hour; its conclusion is void.
- **"Meter the conversation"** — answered by the founder while this ran: **planning is never metered,
  only the artifact is** (`bd8f368`). The cost asymmetry the finding identified is real and is now
  recorded in the decision itself, along with the corollary that no credit price can ever bound planner
  spend because an anonymous rider never reaches `POST /drives`.
- **`stopType` is not dead vocabulary** (an early pass claimed three dead enums; it is two — see
  [post-1-1-slate.md](post-1-1-slate.md) §3).
