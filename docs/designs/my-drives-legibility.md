# My Drives legibility — making a 50-drive library findable

> **Status:** **§3 + §4 BUILT 2026-08-05** — the date on the card (`DriveList.tsx` + `labels.ts`) and the
> DERIVED region filter (`apps/api/src/region-geo.ts`, `apps/mobile/src/lib/drive-filter.ts`). §5–§6
> remain idea. ⚠ §4 records a stored `drives.region_id` that was adopted and then REVERSED the same day —
> read it before re-proposing one. Captured 2026-08-05 from a
> founder ask ("drives should be pinned 1:1 to a region"), which this doc ANSWERS rather than adopts: the
> filter is granted, the pin is refused, and the reason the pin looked necessary turns out to be a much
> larger legibility gap that region scoping alone cannot close. NOT scheduled. Supersedes nothing;
> constrained by `docs/decisions/geometry-first-regions.md` and colliding (later) with
> `docs/designs/passport-logbook.md` — see §7.

## 1 · The problem, and why it is bigger than regions

`FREE_DRIVE_CAP = 50` (`apps/api/src/credits.ts`). One free account can accumulate **fifty saved drives**,
and the list that holds them is flat, reverse-chronological, and virtualized precisely because it is
unbounded (`apps/mobile/app/drives/index.tsx` — "⚠ This list is UNBOUNDED … the one list in the app that
virtualizes").

The founder framing was region-shaped: with two regions live, a mixed list gets messy, and since a rider
always has a primary region selected, filter on it. That instinct is right about the symptom. It is
incomplete about the cause — **a rider with fifty Lake Tahoe drives has an unusable list at ONE region**,
and no region filter can help them. Region scoping is one rung of a ladder, not the fix.

## 2 · What the list actually is today (grounded)

Five facts, each verified rather than assumed:

1. **The query is owner-scoped and nothing else.** `driveRoutes.get('/')` (`apps/api/src/drives.ts`)
   filters `eq(drives.userId, …)` + `isNull(drives.deletedAt)`, ordered `desc(createdAt)`. No region, no
   bbox, no join.
2. **The wire carries no geometry.** `driveSummary` (`packages/shared/src/schemas.ts`) is
   `driveId, label, startName, endName, distanceMeters, durationSeconds, clipCount, createdAt`.
3. **The card renders three things.** `DriveCard` (`apps/mobile/src/ui/DriveList.tsx`) shows the label, the
   stop count, and a duration badge. ⚠ **`createdAt` is fetched and thrown away** — see §3.
4. **Every label is machine-made.** At create, `driveLabel()` joins the route's waypoint labels with
   `→`. On read, `storedDriveLabel()` is `d.label ?? "${startName} → ${endName}"`. Nothing anywhere lets a
   rider name a drive, so **two drives of the same route are indistinguishable on screen.**
5. **Delete lives only on the detail screen.** The list refetches on focus so a deletion falls out of it,
   but pruning fifty drives means fifty round trips through a child screen.

The failure mode this composes to: a rider who drove Tahoe City → Emerald Bay four times has four
byte-identical cards and no way to tell which is which, delete the duplicates in bulk, or name the good one.

## 3 · Tier 0 — render the date (free, and it is already paid for) — ✅ BUILT 2026-08-05

`createdAt` is in the DTO, in the query, and in the client's hands. Rendering it is a card change and a
label helper. It costs one wire byte more than nothing, and it **immediately** solves the identical-twin
problem that makes the list feel broken.

⚠ The app has **no date formatting anywhere** — no `toLocaleDateString`, no `Intl.DateTimeFormat`. So this
adds a `driveDate` + `spokenDriveDate` pair to `apps/mobile/src/lib/labels.ts`, matching that file's
existing display/spoken convention (`driveLength`/`spokenDriveLength`, `clipLength`/`spokenLength`) so the
card's VoiceOver label and its visible text cannot drift — the drift this card's own file exists to end.

Do this one first regardless of what else is agreed. It is the highest ratio of legibility-per-line in the
whole ladder, and every rung below assumes it.

**Built 2026-08-05.** Verified on the simulator against a real 7-drive library, which turned out to argue
the case better than this section did: two drives were `Zephyr Cove → …` on the same day, and three more
shared `Aug 3`. The date is what separates them.

⚠ **It also exposed a latent layout bug in the card, now fixed.** The meta `<Text>` carried `flex: 1`,
which reserved the duration badge its share of the line — so the text wrapped INSIDE a half-width column.
Lengthening the string to `3 STOPS · YESTERDAY` broke it mid-word at the AX Dynamic Type sizes
(`YESTERD` / `AY`). `3 STOPS` alone had never reached the edge, so the bug had always been there and
nothing could see it. The fix is `justifyContent: 'space-between'` on the row with the `flex: 1` removed:
the row's own `flexWrap` now moves the BADGE down when the text needs the width. ⚠ Whoever adds a region
chip (§4) or a rename (§5) lengthens this same line again — re-check it at AX5, it is one `simctl ui
<udid> content_size accessibility-extra-extra-extra-large` away.

## 4 · Tier 1 — region scoping, DERIVED at read time — ✅ BUILT 2026-08-05

**A drive's region is computed on `GET /drives` from its frozen start point, and never stored.** The list
filters on it client-side. `drives` gains no column, so `docs/decisions/geometry-first-regions.md` needed
no amendment — this is the read it already prescribed ("A drive's region(s) CAN be derived by
intersecting its bbox with `regions` where a label is wanted").

⚠ **THE 1:1 STORED PIN WAS CONSIDERED SERIOUSLY AND REVERSED ON COST — do not re-propose it without
reading this.** A founder pass asked for `drives.region_id` three times; a decision record adopting it
was written and then deleted the same day when the build estimate came in. What settled it:

- **Derived is strictly LESS work.** No drizzle migration against the shared prod DB, no backfill, no
  `createDriveRequest` wire change, no client change at create, and no CLAUDE.md invariant to amend
  (that file is at its line ceiling). ~50 lines against a schema change touching five layers.
- **Both give the SAME answer for every drive that can exist.** The planner's roster is one region's
  curated places — *"the planner's ENTIRE world"* (`apps/api/src/planner.ts`) — so it cannot draw a
  cross-region drive at all. There was no ambiguity for a stored value to resolve.
- **It is the reversible direction.** If derivation ever disappoints, the column can be added later and
  backfilled from this very geometry. The reverse is not true.

⚠ Two real properties the stored pin would have had, accepted knowingly: a bbox edit (TODO #70) **moves**
a derived drive between groups, and a drive outside every released bbox derives to `null`. §4.2 is what
keeps both from reading as data loss.

⚠ The refuted argument worth keeping refuted: *"which region does Reno → Tahoe City belong to?"* is a
**false premise**, not a point in favour of either side. Reno is a curated place *in the Tahoe roster*;
that drive is single-region and always was.

### 4.1 · How it resolves — the START point, not the bbox

`apps/api/src/region-geo.ts`. The point tested is the drive's frozen `start_lat`/`start_lng`, against
each RELEASED region's bbox.

- **Start point, not a bbox intersect** — and this is precision, not laziness. The planner's roster is
  itself bbox-selected (`loadRegionAnchors(region.bbox)`), so a drive's start anchor is inside its
  region's box **by construction**; testing that one point recovers exactly the region the planner was
  working in. A route's rectangle, by contrast, can clip a neighbouring region the drive never entered.
- **Most specific wins** when boxes nest — a rider in Tahoe means Tahoe, not "Sierra Nevada". This also
  makes the answer deterministic; without it the label would be whatever order Postgres returned.
- **Released regions only.** ⚠ A leak guard, not tidiness: naming a DRAFT region to a rider through
  their own drive list would publish it early, by the back door, on a route unrelated to the release
  gate. Verified live — Yosemite exists as a region row today and is correctly excluded.
- **Memoized** (`REGION_GEO_MEMO_TTL_MS`) and folded into the handler's existing `Promise.all`, because
  `GET /drives` is hit on every app focus and its parallelism was deliberate.

Verified against production data before shipping: **8/8 real drives labelled**, which is the one thing
the unit tests structurally cannot prove — a rule that returns `null` for everything passes them all.

### 4.2 · The filter must never be the only view — the NON-NEGOTIABLE, and how it was met

Scoping to one region means a drive is invisible from every region but one. A rider who has forgotten
where a drive lives must still have a path back to it, so **a chip tap must never silently empty a
library.** ⚠ `regions.released_at` is monotonic *specifically* because un-releasing "would orphan saved
drives" (`packages/db/src/schema.ts`); a filter invents a second way to orphan them — by chip position
rather than release state — and this is what stops that being real.

Three rules in `apps/mobile/src/lib/drive-filter.ts` deliver it, and each is unit-pinned:

1. **The control appears only when it can DO something** (`shouldOfferRegionFilter`: two or more regions
   present). This is why the rung needed no "wait for Yosemite" flag — *the condition is the gate*. At
   one region the screen is byte-identical to before, which was confirmed on the simulator.
2. **Every region present gets a chip, plus ALL.** Nothing is hidden without a visible way back.
3. **⚠ The opening view can never be empty while drives exist** (`initialRegionFilter`). A rider whose
   chip says Yosemite but whose drives are all Tahoe falls back to ALL rather than honouring a chip that
   would show them nothing. This is the single rule the whole section exists for, and it has a test
   asserting the property directly across every chip state.

A drive with no region (outside every released bbox, or an offline summary saved before the field
existed) gets no chip of its own — a category a rider cannot have chosen would be noise — and stays
reachable under ALL. The dead-zone branch reconciles the same way, which matters more there: those
summaries usually carry no region at all, so they must land on ALL, never on a stale region that hides
every one of them.

⚠ Tier 1 is the one rung **useless until a second region ships** — with one region it filters nothing. It
is not blocked on Yosemite to *build*, but it is blocked on Yosemite to *matter*, like TODO #73 and #75.
The migration and the write path can land early and harmlessly; the filter UI is what waits.

## 5 · Tier 2 — rename, the highest-charm rung and nearly free

**The storage and the read path already exist.** `drives.label` is nullable, and `storedDriveLabel()` already
prefers a stored label over the derived `start → end` fallback. Today nothing ever writes a rider's label —
`driveLabel()` only auto-joins waypoints at create. So a rename is **a PATCH endpoint and a text field, not a
migration.**

This is the rung that actually scales. It is the only fix that works at fifty drives in a single region,
which is the case region filtering structurally cannot touch. And under the project's own doctrine —
optimize for charm, the persona is the product — a rider naming a drive *"The one where we got lost"* beats
any chip this doc could add.

Open: whether a renamed drive keeps its derived label as a subtitle (probably yes — the route is still the
fact, the name is the memory).

## 6 · Tier 3 — pruning and search

- **Delete from the list row** (swipe, or an edit mode). Fifty drives with delete only on the detail screen
  is a fifty-round-trip cleanup. Possibly the cheapest *real* messiness fix after Tier 0, because the
  fastest way to a legible list is fewer rows in it.
- **Search** over label + start/end names. Last, and only if the first three prove insufficient — it is the
  rung most likely to be unnecessary once drives have dates and names.

## 7 · ⚠ The collision to design around: passport/logbook

`docs/designs/passport-logbook.md` (idea, post-MVP) is a **souvenir** layer for *completed* drives —
NPS-passport stamps, memory-keeping, explicitly never achievement/conquest. Different job from this doc's
*library utility*, but **the same surface**: a logbook eventually wants to BE the My Drives screen, or to sit
one tab from it.

Whoever builds this ladder should not design a list the logbook then has to tear up. The cheap insurance is
to keep the row a single shared atom (it already is — `DriveList.tsx` exists precisely because that card was
once written twice and the copies drifted) and to treat grouping/filtering as list-level chrome, not as
something baked into the card.

## 8 · Recommended order

1. ✅ **§3 date on the card** — done 2026-08-05.
2. ✅ **§4 derived region filter** — done 2026-08-05. Dormant until a second region is released, by its
   own condition rather than by a flag.
3. **§5 rename** — next, and the highest-value rung remaining: near-zero schema cost, and the only one
   that helps at fifty drives in ONE region, which region scoping structurally cannot.
4. **§6 delete-from-list** — fewer rows beats better chrome.

Search stays unscheduled.

## 9 · Open decisions

- **Rename in or out?** It is the highest-charm rung and the cheapest per unit of value, but it changes what
  a drive *is* very slightly: a machine-titled artifact becomes a user-authored one. That is a product call,
  not an engineering one.
- **What the "All regions" escape hatch actually looks like** (§4.2) — a chip option, a segmented control,
  or a hidden-count line. Required, shape undecided.
- ~~Filter vs. grouping headers~~ — SETTLED: filter, per the founder call. §4.2's escape hatch is what
  recovers the property grouping would have given for free.
- **The chip's meaning is now WIDER, and that is deliberate.** It used to scope only the *conversation*
  (which curated endpoints the planner may offer). It now also scopes the *library*, so one control means
  both "where I'm going next" and "what I've already made". Named here as an accepted widening rather
  than an open question — but it is the reason §4.2 is non-negotiable: the more a control governs, the
  worse a silent empty list reads.
