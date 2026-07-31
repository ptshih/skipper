# Offline as REGION PACKS, not per-drive downloads

> **Status:** PRE-SPEC — founder direction 2026-07-31, grounded against the code the same day. NOT
> greenlit for build. Supersedes nothing yet; the per-drive download in `apps/mobile/src/lib/offline.ts`
> is what ships today. Build truth for the current offline subsystem:
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
~138 MB. A single drive is tens of MB. So the whole region is single-digit multiples of one drive,
and the founder's own note called it "a checkbox, not an architecture project."

## ⚠ The thing that has to be designed in, not discovered

**A region pack built from `GET /roam` would NOT reliably cover every clip a stored drive needs.**

The drive BUILD path filters exactly as roam does — released only, `excluded_reason IS NULL`,
`notSupersededByServedCluster` (`apps/api/src/drives.ts:300-315`). But the drive REPLAY path
deliberately does **not** re-adjudicate: `corpusForSelection` → `loadCorpusBySubjectIds` resolves a
FROZEN selection by subject id, and the comments say so explicitly ("BUILD path only … deliberately
does not re-adjudicate a frozen drive's stops"). So a saved drive can legitimately reference a
narration the current roam manifest omits:

- a POI that gained an `excluded_reason` after the drive was built (`prune-corpus.ts` runs later);
- a POI whose cluster later gained a served fused telling, so roam now suppresses the member;
- geographically, a route whose stops fall outside the radius the pack was anchored at.

Two ways out:

1. **A purpose-built pack endpoint** — "every released narration in this bbox", without roam's
   presentation-time suppression. Cleanest, and it also fixes that `GET /roam` is point+radius with
   no region parameter and that `GET /regions` doesn't expose `regions.bbox` today.
2. **Region pack + per-drive top-up** — the pack carries the bulk; saving a drive additionally pulls
   only the clips it needs that the pack lacks (normally zero). Preserves one store and one filing
   system, guarantees correctness, and degrades gracefully for a drive that leaves the region.

(2) is the cheaper first step and doesn't need an API change; (1) is the better end state.

## Keeping it up to date

**Blocker: `roamPin` carries no revision token.** `driveClip` has `revisedAt` and the drive path
already uses it (`contentSignature` / `isDownloadStale`), but the roam wire has nothing, so today a
client cannot tell a re-cut clip from an unchanged one — only "re-download everything" is available.
Adding `revisedAt` to `roamPin` is additive and back-compatible (Zod strips unknown keys), and it is
the prerequisite for any of this.

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

## Open questions for the founder

1. Pack endpoint (1) or region-pack-plus-top-up (2)? (2) ships without touching the API.
2. Is "prepare for offline" a region-level action ONLY, or does per-drive saving survive as a
   convenience for someone who doesn't want 138 MB?
3. Auto-apply threshold for sync deltas — and does it differ on cellular vs wifi?
