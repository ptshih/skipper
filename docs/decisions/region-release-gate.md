# Region release gate — staged content + a one-way release latch

> **Status:** Release latch built; saved-review enforcement and exception-driven audio assessment deployed and verified 2026-09-09. Original gate BUILT 2026-06-20 (migration `0029`, applied to the shared DB). Founder-approved model:
> auto-release every clip in a region on release. **Preview gate UPDATED 2026-06-20:** the per-user
> preview flag moved from a bespoke `user.tester` boolean → the **Better Auth `admin` plugin role**
> (`role === 'admin'`), so "preview staged content" is now one facet of being an admin (migration `0030`
> adds `role`/`banned`/`ban_*` + `session.impersonated_by`; `0031` drops `tester`). Adds a *human* release gate
> downstream of the automated eval gate (`docs/decisions/automated-grounding-gate.md`): the eval gate
> decides "safe to persist," this gate decides "ready for the public." Schema (`regions.released_at`,
> `narrations.released_at`, `user.role`) + the backfill, the roam/drive read filters + the `isAdmin`
> plumbing, and the admin Release actions (region + per-clip) are all in. Build refinement vs. the
> original design: the drive read filter is applied at BUILD time only — see Read-path changes.
>
> ⚠ **Amended 2026-08-02 (1.1):** the GATE is unchanged and still doctrine — but the list of paths it
> guards shrank. Roam is removed, so **`GET /roam` no longer exists**; wherever the body enumerates
> "the roam/drive read filters" or `apps/api/src/index.ts` roam, read it as the DRIVE build path
> (`loadCorpusForRoute`) plus `GET /sample`. The anonymous preview clip 1.1 added comes off that same
> release-filtered build path, which is exactly why it can be served to a stranger. ⚠ Unchanged and
> easy to get wrong: `loadCorpusBySubjectIds` / `corpusForSelection` still apply NO release filter by
> design — they resolve a FROZEN selection a rider already paid for, and are safe only while every
> caller stays owner-scoped behind `requireAccount`.


## Saved review amendment — 2026-09-09

Future staged publication, including one clip, requires an explicitly approved saved Listening
Review. The staged set includes individual narrations and combined narrations with any member
inside any region box. Display, fingerprints, and release writes share one SQL resolver. A short
locked transaction revalidates the exact set and approval before stamping anything; existing
released audio and live regeneration retain their monotonic behavior. Completed reviews carry
publication receipts for idempotent retries. The review tables are additive; deploy their migrations
before the admin code. See [Yosemite launch](../designs/yosemite-region-launch.md) for workflow,
limitations, and outstanding operator approvals. The historical direct-release instructions below
are superseded by this workflow.

## Automated editorial acceptance amendment — 2026-09-09

The founder replaced mandatory human listening with audio-and-script model judgments. Creating a
review automatically assesses its full staged set; clear passes become Good without a listening
checkbox. Low, uncertain, incomplete and human-flagged clips remain exceptions. Human verdicts win,
and hard technical failures remain nonwaivable. Exact clip/context/model/policy results are cached;
changed inputs require a current judgment. Both approval and release revalidate current model-policy
acceptance, including for an individual clip. Explicit release approval/publication remain separate
from model verdicts. Historical references below to the founder's ear are superseded by this policy.

## The problem

Today a narration is **binary**: a `narrations` row *exists with `audio_url NOT NULL`* ⇒ it is live and
public. There is no in-between. The moment you discover + enrich + generate a region's corpus, every
clip is immediately served by `GET /roam` and eligible for every `buildDrive` — the public read paths
filter on **geometry only** (bbox + `innerJoin narrations`; `apps/api/src/index.ts` roam,
`apps/api/src/drives.ts` `loadCorpusForRoute`). There is nowhere to *stage* a region while its POIs are
still being tuned, and no way for a handful of testers to dogfx it in the real app before the world hears it.

The founder wants to **roll regions out slowly** — build a region, tweak its POIs until it's ready, let
the founder + a few testers hear it in the app, then open it to everyone.

## The decision

Add a **release latch** at two levels, and make release **monotonic — strictly `staged → released`, never
back.** Once a clip or region is public it *stays* public. That single rule is what buys safety for free:
nothing public ever disappears, so a saved drive never orphans and an offline download is never
invalidated by a server-side change. (The founder explicitly accepted "I can't take it back" precisely to
avoid breaking app downloads + creating drive orphans — irreversibility is a feature here, not a gap.)

Two write-once timestamps carry the whole thing:

- **`regions.released_at`** (`timestamptz`, nullable) — the rollout control you flip, one region at a
  time. `NULL` = **draft**: the region is still being discovered / enriched / generated / tweaked, and
  *none of it is public*.
- **`narrations.released_at`** (`timestamptz`, nullable) — the actual "this clip is public" bit. `NULL`
  = **staged**; non-null = **released**. **The public read paths check only this one column**
  (`released_at IS NOT NULL`) — so the geometry-first region model (`docs/decisions/geometry-first-regions.md`)
  stays untouched: no `region_id`, no region-bbox intersection at read time.

Plus one role for who gets to preview:

- **`user.role === 'admin'`** (Better Auth `admin` plugin; `role` is server-set `input:false` like
  `tier`) — orthogonal to the payment tier (anonymous/free/paid). An admin (founder + a small allowlist)
  skips the `released_at` filter and hears staged content **in the real app**. (Originally a bespoke
  `user.tester` boolean; folded into the admin role 2026-06-20 — preview is now an admin capability.)

`regions.released_at` is the *control surface*; `narrations.released_at` is the *enforced bit*. They
connect through one action: **releasing a region stamps `regions.released_at` AND bulk-stamps
`released_at` on every still-staged clip in its bbox** (auto-release-all — founder's call). The invariant
that keeps the read path to a single column: a narration's `released_at` is set *only* through a region
release (or a deliberate per-clip release within an already-released region) — generation always writes
`NULL`. So "narration is public" ⟺ `narrations.released_at IS NOT NULL`, with no region join needed.

## The lifecycle

1. **Draft region.** Create the region (`released_at` NULL), discover/enrich/generate, tweak POIs. Every
   clip is staged → invisible to the public. The founder + admin (`role==='admin'`) users hear *all* of it in the app.
2. **Release the region.** One admin action latches `regions.released_at` and bulk-stamps every staged
   clip's `released_at` — the whole ear-checked corpus goes public at once.
3. **After release** — two sub-cases, and the split is the orphan guard:
   - **A newly-discovered POI** (a clip that was never public) generates **staged** (`released_at` NULL).
     Safe to stage because nothing references it yet. It goes public on the next region release (re-running
     the release action is idempotent and stamps any newly-staged clips) or via a per-clip release.
   - **Regenerating an already-public clip** updates the audio **in place and stays live** — we do *not*
     yank it back to staged, because that is exactly what would orphan a saved drive / break a download.
     The fail-closed auto eval-gate is the safety net (it won't persist a clip that fails grounding/tts);
     if a regen is weak you regenerate again, but it never leaves the public set.

So **"staged by default" holds until a clip is first released; thereafter regeneration stays live.** The
alternative — regen into a hidden shadow slot, audition, then promote — is a bigger build, deferred unless
post-release quality control turns out to bite (see Deferred).

## Read-path changes

The release filter is applied **everywhere a narration is resolved for playback**, and previewers bypass
it uniformly:

- **`GET /roam`** (`apps/api/src/index.ts`) — add `isNotNull(narrations.releasedAt)` to the WHERE. Roam
  is currently open/anonymous, so add an *optional* session read: a logged-in admin skips the filter;
  anonymous + non-admin users get released-only.
- **`buildDrive` corpus load** (`loadCorpusForRoute`, `apps/api/src/drives.ts`) — same
  `isNotNull(narrations.releasedAt)` unless the caller is an admin (threaded as `includeStaged`).
  Applied to BOTH `/drives/propose` (so the estimate matches) and `POST /drives`. **The build-time filter
  is sufficient — the drive-load resolve path is left unfiltered.** Why that's safe: a non-admin can
  never get a staged clip into a drive (the corpus excludes them), drives are owner-only, and release is
  monotonic (a built drive's clips only ever move forward to public, never vanish). So nothing the load
  path resolves is ever a leaked/orphaned staged clip. The one edge — *demoting* an admin (clearing the
  role) who saved a staged-clip drive — is acceptable and admin-only.
- **Admin** (`apps/admin`, behind IAP) — no change; the console always sees staged content (it's the
  audition surface today via `GET /admin/pois/:poiId/narration`).

## Generation change

`generate-narrations.ts` writes new `narrations` rows with `released_at = NULL` (staged). On a regen
(the `narrations_poi_uq` upsert's UPDATE path) it **must not touch `released_at`** — a public clip stays
public, a staged clip stays staged. (`audio_url`, `script`, `facts_hash`, `attribution` update as today.)

## Admin changes

- **Region Release** — `POST /admin/regions/:slug/release`: `db.batch` of
  `UPDATE regions SET released_at = now() WHERE released_at IS NULL` (idempotent) +
  `UPDATE narrations SET released_at = now() WHERE released_at IS NULL AND <poi in region bbox>`. ⚠ Since
  2026-08-06 a region may be SEVERAL boxes and that predicate spans ALL of them (`inAnyBbox`); the parse is
  all-or-nothing, so a region whose bbox is malformed 400s rather than releasing part of itself — release is
  irreversible, and half a region published is not recoverable. See [multi-bbox-regions.md](multi-bbox-regions.md).
  Re-running
  it is the "push newly-staged clips public" bulk action. Gate behind an **irreversible** confirm
  (`useConfirm({ tone: 'destructive' })`, "this can't be undone").
- **Per-clip release** — a release toggle on the POI detail drawer's narration tab (`PoisView.tsx`
  `NarrationTab`) for the trickle case (open region, release one new clip). Release-only; no un-release.
- **Status surfacing** — show region `Draft / Released` and a per-POI `staged / released` badge alongside
  the existing `narrationStatus` (`fresh/stale`). "X of Y clips released" per region is a nice-to-have.

## Migration note (preserve the current live alpha)

`released_at` defaults `NULL`, so a naive add would instantly un-publish the currently-live Tahoe corpus
(~459 clips, live on TestFlight). The migration **must backfill**: stamp `regions.released_at = now()` for
`lake-tahoe` and `narrations.released_at = now()` for every existing row, so nothing the public/admins
already have gets yanked (the monotonic invariant, applied to the migration itself). New regions created
after this ship begin in draft. ("No users yet — break storage freely" still applies to the *shape*; the
backfill is about not regressing what's already shipped, not back-compat.)

## How it composes with the eval gate

Two gates, in series, with clean responsibilities:

1. **Auto eval-gate** (`generate-narrations.ts`, fail-closed) — *"safe to persist?"* Grounding/tts must
   pass or the clip is **withheld** (no row at all; `eval_scores.withheld = true`).
2. **Release gate** (this doc) — *"ready for the public?"* A persisted clip is **staged** until a human
   releases it (or its region is released).

Pipeline: **auto-gate → staged → automated editorial assessment → exception resolution → explicit release.**
The model accepts clear passes by default; an operator resolves remaining concerns and controls publication.

## Deferred (not in v1)

- **Un-release / take-back** — deliberately omitted; the monotonic latch is the safety model.
- **Shadow-slot regen** — regenerating a public clip into a hidden slot, auditioning, then promoting
  (so a post-release regen gets a second ear-pass). Revisit only if live regens prove a quality problem.
- **Per-clip hand-pick at region release** — release is auto-release-all; finer trickle-out uses the
  per-clip release after the region is open.

## ⚠ Addendum 2026-08-06 — the bypass is only as good as the call that carries the session

The gate itself never broke, and neither did `isAdmin`. But **the admin staged-region preview was dead
in the app for two days** (2026-08-04 → 08-06) and nobody could see it, so the failure mode is recorded
here rather than only in the code.

**What happened.** `5d842738` moved the cold open's region list from `listRegions()` to
`getBootstrap()`, and the new call was marked `{ anonymous: true }` — a client flag that omits the
session cookie. The server then saw every launch as anonymous, applied the release filter correctly,
and returned released regions only. `isAdmin` is the SOLE bypass, and it cannot fire on a request that
carries no session. The app showed one region instead of two; nothing threw, nothing logged, and
`bun run check` stayed green.

**Why it went unnoticed.** One region is a completely plausible screen — the corpus really is Tahoe
only. There is no state that looks *wrong*, so the only detector was a human remembering that a second
region used to be listed.

**The durable rule this leaves.** *The release-gate bypass depends on a client decision that lives
nowhere near the gate.* An endpoint can be perfectly correct and still answer as though the caller were
a stranger, because anonymity is chosen at the call site. So:

- A call that merely reads public config must NOT be marked anonymous. That flag is for a request
  carrying something the rider TYPED (the planner) — and the planner is better served by being
  anonymous *by construction* (it does not import the auth client at all) than by a flag.
- Anything that grants an operator a different answer needs a test on BOTH sides. Both halves now
  exist: `apps/api/test/regions-cache.test.ts` (the server honours `isAdmin` on `/regions` AND
  `/bootstrap`) and `apps/mobile/src/lib/api-source.test.ts` (the client actually sends the session).

⚠ This is the SECOND time this exact preview has been silently disabled by the client, which is why it
is written down as a pattern rather than a one-off: `ecc30f7d` reverted an earlier `?includeStaged=1`
opt-in whose stated failure was *"the mobile client never learned to send the param — an admin simply
stopped seeing staged regions in the app."* Same outcome, different mechanism, both invisible.
