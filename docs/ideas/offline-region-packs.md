# Offline as REGION PACKS, not per-drive downloads

> **Status:** DESIGN SETTLED, **build NOT greenlit** (founder, 2026-07-31: *"log it but don't build
> yet"*). Direction + the three open questions were resolved the same day — see *Decisions* at the
> foot. Stays in `ideas/` rather than `specs/` precisely because it is not greenlit; promote it on an
> explicit build call. Supersedes nothing yet: the per-drive download in
> `apps/mobile/src/lib/offline.ts` is what ships today, and its build truth is
> [../decisions/offline-connectivity-and-roam-pack.md](../decisions/offline-connectivity-and-roam-pack.md).

## The idea

> "Rather than only downloading content for the POIs used in one or more specific drives, preparing
> for offline always just downloads the entire region's pack and keeps checking whenever it can to
> make sure that pack is up to date (in case new POIs are added or modified)." — founder, 2026-07-31

One artifact per region. Drives don't own audio; they reference it. "Prepare for offline" is a single
region-level action, kept fresh opportunistically rather than re-pulled by hand.

## Why it's the right shape

**It matches the content model the architecture already states.** CLAUDE.md principle 1: *"Fetch
FACTS once per place; the NARRATION is the shared atom; ASSEMBLE per drive."* Roam plays narrations
by proximity; a drive reuses the same narrations pre-ordered along a route. Per-drive download is the
one place storage contradicts that — it re-privatises a shared thing, per drive, per copy.

**It removes duplication that exists today.** A rider holding a roam pack AND a saved drive stores the
same clips twice, under two filing systems: `drives/<driveId>/<seq>.m4a` and
`roam-pack/<poiId>.m4a`. Same R2 objects, different names.

**It dissolves most of the machinery this subsystem has accumulated.** Versioned per-drive manifests,
`MANIFEST_MIGRATIONS`, `repairDownload`, `downloadDirState`, the orphan classes, the ownership
question, partial-download state, per-drive stale/expired nudges, the "this drive isn't saved yet"
warning — nearly all of it exists to manage *a per-drive download*. Region-shaped storage makes most
of those states unrepresentable rather than handled.

**Sizing already says yes.** Measured: the entire rider-reachable corpus is 238 clips / 293 min /
~138 MB — about 0.47 MB per minute of audio, so a typical ~10-stop drive is ~10 MB and the region is
roughly 14× one drive. Real, but the founder's own note called it "a checkbox, not an architecture
project": a few podcast episodes, against streaming apps whose downloads live in GB.

## ⚠ Roam POIs and drive POIs are NOT the same set — in either direction

Same audio. Same `narrations` rows, same R2 keys. What differs is **selection policy** and
**addressing**, and only the first is a problem.

**Roam selects at presentation time, and its policy moves.** `GET /roam` applies, live, per request:
`released_at NOT NULL` (unless admin), `excluded_reason IS NULL` (unconditionally — even for an
admin), `notSupersededByServedCluster(...)`, and a radius bbox + haversine trim
(`apps/api/src/index.ts:203-249`).

**A drive resolves a FROZEN selection with essentially no eligibility filtering.**
`loadCorpusBySubjectIds` (`drives.ts:884-902`) is `inArray(narrations.poiId, subjectIds)` plus
`loadClusterTellings({ includeStaged: true, areaCapable: true, clusterIds })` — no release filter, no
`excluded_reason`, no suppression. Deliberate, and the comment says why: this path "resolves a frozen
set's CONTENT and must not re-adjudicate eligibility", because re-adjudicating would silently shrink
a drive the rider paid a non-refundable credit for. The BUILD path (`drives.ts:300-315`) *does* filter
like roam — so **a drive's stop list is a snapshot of roam's policy at build time**, resolved forever
after by id.

Concretely, how they drift: a drive is built with a Vikingsholm stop; later `classify-treatments`
groups Vikingsholm into the Emerald Bay cluster and a fused telling is released. Roam now suppresses
Vikingsholm (the cluster speaks for it); the drive still names Vikingsholm's own narration, correctly.
A roam-built pack has the fused clip and NOT the solo one, and the saved drive goes silent at that
stop. Same shape for a POI that later gains an `excluded_reason` via `prune-corpus.ts`.

⚠ **The case that bites first, today:** `getRoamManifest` is called `{ anonymous: true }` on purpose
(roam carries live coordinates and must never link them to a signed-in identity — `api.ts:194-205`),
so even an admin gets released-only content from roam. But an admin's drives can be built on STAGED
narrations. A roam-built pack would therefore systematically miss exactly the staged clips the
founder's own drives use.

**And the reverse:** roam serves DISTRICT/area tellings that `buildDrive` refuses outright (it won't
snap an enclosing-circle centre to a route — `drives.ts:335-337`). So a roam pack also carries clips
no drive will ever reference. Harmless, but neither set contains the other.

**This aims the idea rather than sinking it.** The conclusion is: *don't build the pack's contents
from a presentation-time selection policy.* Key the store by NARRATION SUBJECT ID — poi or cluster,
which is what both paths already use (roam even overloads `poiId` to carry cluster uuids, documented
as opaque to the client) — and fill it from an eligibility question that doesn't move: "every
released narration in this bbox". The ADDRESSING stays separate and that is fine: roam indexes by
proximity (`radiusM`/`area`), a drive by route order (`seq`/`alongSec`). Same bytes, two indexes —
precisely the shape that makes one shared store correct.

How the fill is scoped — a purpose-built pack endpoint vs. region-pack-plus-per-drive-top-up — is
settled in **D1** below. Short version: they were never alternatives, because the top-up is required
either way.

## Keeping it up to date

**Blocker: `roamPin` carries no revision token.** `driveClip` has `revisedAt` and the drive path
already uses it (`contentSignature` / `isDownloadStale`), but the roam wire has nothing, so today a
client cannot tell a re-cut clip from an unchanged one — only "re-download everything" is available.
Adding `revisedAt` to `roamPin` is additive and back-compatible (Zod strips unknown keys), and it is
the prerequisite for any of this. It is also cheaper than it sounds: the drive corpus already selects
`revisedAt: narrations.updatedAt` (`drives.ts:193`), so it is the SAME column on the SAME table —
roam simply doesn't project it.

With it, sync is a small diff: fetch the manifest (~a few hundred KB), compare `poiId → revisedAt`
against the pack, pull only what's new or changed, drop what's gone.

**"Whenever it can"** — half of this already happens: `cacheRoamPins` runs on every successful roam
manifest fetch, so the PIN set is already refreshed opportunistically. Extending the same moment to
reconcile audio is the natural hook, plus a check on app foreground when online. iOS background fetch
(BGTaskScheduler) is probably over-engineering for now — the moment that matters is the rider opening
the app in town before driving.

**⚠ Do not assume deltas are small.** A corpus regen re-cuts everything — the Tahoe corpus was fully
regenerated as recently as 2026-07-30 — which makes the "delta" the entire ~138 MB. Auto-pulling that
on cellular would be a genuine harm. Sync should auto-apply below a size threshold and otherwise
nudge, the same soft posture the rest of this subsystem uses.

## What it costs

- A real refactor, not a tweak: `offline.ts`, `useDrive`'s url resolution, the drive-detail download
  UI, and the roam pack all move. It obsoletes work landed 2026-07-30/31 (`repairDownload`,
  `downloadDirState`, the migration seam, the per-drive manifest version) — cheap to have built, and
  the reasoning behind them is what led here, but worth naming rather than quietly deleting.
- Eviction gets a new question: with shared audio, no drive owns a clip, so deleting a drive can't
  delete clips. At 138 MB the honest answer is never evict + one "remove the region" control, not
  refcounting.
- A rider who wants ONE drive pulls the whole region. Mitigated by the top-up model above: the pack
  is the default, a drive-only fill stays possible into the same store.
- Multi-region (Yosemite → Moab, M4) turns "the region" into a per-region choice, and the region
  identity gap above (`/roam` has no region param, `/regions` no bbox) becomes load-bearing rather
  than cosmetic.

## Decisions (founder, 2026-07-31) — design settled, build NOT greenlit

### D1 — Region pack + per-drive top-up. No new endpoint.

The two options were never alternatives: **a per-drive top-up is structurally required either way.**
No bbox-level eligibility rule can guarantee coverage of a FROZEN selection, because the selection
was frozen under a different rule — even a clean "every released narration in this bbox" endpoint
misses a clip excluded or unreleased after the freeze, and misses staged clips entirely unless
authenticated. The only authority on what a given drive needs is that drive's own manifest.

And the top-up is nearly free: `createDrive` and `getDrive` both already return a full `DriveManifest`
with presigned clip urls, a drive can only be CREATED online (account + credit), and a drive opened on
a second device fetches its manifest to render. So every moment the app holds a drive manifest it can
fill the store with what's missing — **zero extra requests, usually zero clips** — and it is invisible
to the rider, whose model stays "I saved the region".

A purpose-built pack endpoint stays worthwhile LATER, for reasons that aren't urgent at one region:
real region identity (`/roam` is point+radius with no region param, and `GET /regions` doesn't expose
`regions.bbox`, so "the region" is currently a 100 km circle around wherever you last rode);
authenticated bulk fill, which would fix the staged-content gap above at the pack level instead of
per-drive; and not carrying district clips drives never reference.

### D2 — Region is the only rider-facing action. Keep the fill scoped; don't ship the button.

Offline is ONE control: save the region. The per-drive fill capability stays in code (it IS the
top-up, called with one manifest), so exposing it later is a button, not a build — but it is not
shown. Sizing for the record: ~0.47 MB per minute of audio, so a typical ~10-stop / ~2-min-a-stop
drive is **~10 MB against the region's 138 MB, about 14×**.

Note what this does and does not delete. The per-drive MACHINERY — its own manifest, version gate,
migrations, repair, orphan classes, partial state — dies regardless, because that is a property of
per-drive STORAGE, not of a per-drive FILL. And the per-drive UI collapses: today's `downloaded` /
`partial` / `expired` / `updatable` / `dirState` become ONE derived question against the store — are
all my clips present and current — with three states (covered / partly covered / not covered).

Revisit only if riders appear who create drives and never roam; for them the 14× is a real tax on the
primary flow and the button should ship.

### D3 — Sync: metadata always; audio only when it's a good moment AND small enough.

The manifest fetch is always safe (a few hundred KB), so metadata syncs whenever we are online and
idle. Audio bytes auto-apply only when ALL of:

1. **No active session.** A bulk download mid-roam or mid-drive competes with the clip stream and the
   GPS. Absolute.
2. **The connection reports wifi.** Matches when people actually prepare — in town, not in the canyon.
3. **The delta is under a cap** — start ~25 MB: above a normal few-clip delta, below a full regen.

Otherwise it NUDGES rather than failing silently: Settings shows "N stories have a fresh cut — X MB"
with a Refresh button. Never blocks, never surprises.

⚠ **The cap is not redundant with the wifi check, and the reason is a real gap.** expo-network exposes
neither `isExpensive` nor `isConstrained` from NWPath, so a **personal hotspot reports as WIFI** and
iOS Low Data Mode is invisible to us. We cannot tell tethering from real wifi. The cap is what stops a
wholesale corpus regen — where the "delta" IS the entire 138 MB — from being re-downloaded unasked
over someone's phone plan.

⚠ **Unknown connection type counts as METERED** — deliberately the opposite default from the
connectivity verdict, where unknown reads as ONLINE. Not an inconsistency: the rule is fail in the
SAFE direction, and the harms differ. There, being wrong bricks the app; here, being wrong spends the
rider's data.

Deliberately NOT built: treating new POIs (a coverage hole — real silence at a place) more eagerly
than re-cuts (polish on a clip already held). Defensible, but a third knob for a second-order gain.

Implementation note: `connectivity.ts` keeps only `isConnected`/`isInternetReachable` today and drops
`type`. Retaining `type` is trivial but touches the module carrying the native landmines — do it
deliberately, not incidentally.
