# Places console — UX overhaul

**Status:** ✅ **BUILT 2026-08-04** — B (split workspace) and C (review queue) are both shipped, on the
founder's call to do both rather than pick one. A was never built: everything in it is in B. Research +
the three directions are kept below because they are the argument for what was built, and because the
next person to touch this screen should know which parts were evidence and which were taste.
Prompted by a founder observation ("the places screen ux could use an overhaul")
after a session that removed the Curate "How many" field. Extends
[admin-ux-review.md](admin-ux-review.md), whose 2026-06-19 pass covered Runs/Regions/POIs/Reference but
**not** Places. The machinery this is about is [places-endpoints-spec.md](places-endpoints-spec.md);
what a row is *for* is [what-is-a-drive-endpoint.md](what-is-a-drive-endpoint.md). Code wins — line
anchors were true at capture and will drift.

## Why this screen is worth the attention

`places` is the planner's **wire-level endpoint allowlist**: every row is a destination a rider can be
offered, and every name missing from it is an in-persona "don't know that one". The console is the only
surface that curates it, and the Tahoe set is already 172 rows against a 200-row planner serve cap. So
the cost of this screen being hard to work in is paid in the rider's experience, not just the operator's
patience.

## What the research says

Three literatures apply, because this screen is really *a searchable, rankable record set with a
geographic dimension, reviewed in bulk after an AI drafting pass*.

**Map + list — the "list and details" pattern.** The canonical layout puts the list **side by side** with
the map, not stacked; selection brushes both ways (pick a row → map zooms to its extent; going back
restores the prior extent); the panel gets a collapse control at its vertical centre; lists stay simple,
only essential columns. Recommended precisely for "situational awareness, operations, or asset
management" — which is what this is.
([mapuipatterns.com/list-details](https://mapuipatterns.com/list-details/))

**Dense operator tables.** Row density has real numbers (condensed 40px / regular 48px / relaxed 56px).
Numeric columns are right-aligned and **monospace**, so digits line up. Bulk selection appears on row
hover and the bulk actions only appear *once something is selected*. Search and filter at volume are
"a UX necessity, not a nice-to-have". Avoid centre alignment and zebra striping (it fights hover and
selected states). Inline editing is the lowest-friction option for low-stakes edits; a side panel is the
most scalable when there's more to show.
([pencilandpaper.io](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables),
[NN/g on data tables](https://www.nngroup.com/articles/data-tables/))

**Human-in-the-loop review.** Two findings land directly on our Curate flow. First: *"if your reject
button is harder to reach than approve, you have designed a system that produces approvals"* — the
reject path must be as prominent as approve. Second: *let the reviewer **edit** before approving; a
binary approve/reject forces too many rejections* and throws away the 90% that was right. Also: route by
confidence so the reviewer's attention goes where judgement actually changes the outcome, and show the
model's reasoning plus the source data next to each candidate.
([aiuxdesign.guide](https://www.aiuxdesign.guide/patterns/human-in-the-loop),
[velt.dev](https://velt.dev/blog/designing-human-in-the-loop-workflows-ai-products))

## What is actually wrong today

Ordered by how much it costs. The first two are structural; the rest are gaps.

1. **The map is stacked above the table and always on**, eating ~40% of the viewport before the first
   row. Its job is on-demand ("click a row to find it here"), so it is charging rent for an answer you
   are usually not asking. The pattern literature's answer is side-by-side + collapsible.
2. **The Curate prune step is keep-all-by-default** — every candidate arrives pre-checked and the
   operator unchecks (`PlacesView.tsx`, "keep all by default; the operator prunes down"). That is the
   rubber-stamp shape by construction: the cheap path is "resolve everything".
3. **The prune step is keep-or-drop with no edit, and hides the `query`.** `PlaceDraft` carries both
   `name` and `query`, but only `name` is rendered — and `query` is the string actually sent to Google.
   So when a draft resolves to "Serene Lakes Realty", the operator could never have corrected it; only
   discarded it. This is the exact failure the `isBusinessLike` guard was added for, approached from the
   other end: the guard catches it *after* the billed resolve, an editable query would prevent it.
4. **No search or filter at 172 rows.** Every other list in the console (Jobs, Evals, POIs, Drives) has
   a filter toolbar; Places — the longest list — has none, so finding a row means paging.
5. **172 inline rank inputs.** Every row carries an editable number field: a lot of tab stops and visual
   noise for a value most rows never change. Rank is also not monospace, so the column doesn't line up.
6. **"Kind" is mostly "—"** (Carson City, South Lake Tahoe, Stateline all blank) — a column that is
   mostly dashes at the default sort.
7. **No bulk selection**, so "remove these six" is six confirm dialogs. `CorpusTab` already has the
   `SelectionBar` pattern to copy.

✅ **Resolved 2026-08-04 — not a defect.** The map rendered as an empty block in two early passes,
which is why it was recorded as unverified rather than asserted as a bug. Once B was on screen the map
drew normally (satellite tiles, the region bbox in green): it was tile-load timing against the
screenshot, not a missing key. Nothing to fix, and the map earns the space B gives it.

## Three directions

Rendered as a static variant page (Skipper dark palette, real Tahoe rows, real density) and reviewed in
the browser. The file is a throwaway in the session scratch dir, not committed.

- **A · Table-first.** Keeps today's structure; adds the filter bar, demotes the map to a right rail that
  opens on demand, 40px rows, monospace rank, hover-select + selection bar. Cheapest; fixes gaps 4–7 and
  softens 1.
- **B · Split workspace.** The canonical list-and-details: list left (~44%), map right (~56%), both
  persistent, brushing both ways, filter header over the list, map sticky. The map earns its space
  because it is continuously answering "where is this" as you move down the list.
- **C · Review queue.** Reframes Curate as the real job: confidence bands (rank), an **editable query**
  per candidate, equally-weighted keep/drop, keyboard triage, and a running "nothing billed yet" meter.
  Addresses 2 and 3, which A and B do not touch at all.

**Recommendation: B for the steady-state screen, C for the Curate flow — they are different screens
solving different jobs, and doing only one leaves half the problem.** A is what you build if only one
afternoon exists; it is strictly a subset of B.

### What shipped (2026-08-04)

**B.** Map and list side by side, map sticky so it keeps answering as you move down a long list, and it
collapses to a stacked layout below `lg`. Filter toolbar (search over name + kind, plus rank / unranked /
has-access-point). Bulk select with a `SelectionBar` and one bulk remove. `Kind` folded into the name's
sub-line because it is null for most rows. Rank right-aligned and tabular. Problems 1, 4, 5, 6, 7.

⚠ One thing B does that the mockup did not: the selection is derived from the FULL set, not the filtered
one, and the bar says so out loud when a selection reaches past the current filter
("including N hidden by the filter"). Otherwise "Remove 6" could quietly include rows the operator can no
longer see — the count and the act would be two different sets, which is the failure this repo keeps
paying for.

**C.** A draft is now **undecided** until the operator says otherwise — the pre-checked `Set` is gone.
Candidates are banded by rank; the confident bands offer an explicit "Keep all N" button, the deep tail
never does. The Places `query` is rendered and **editable in place**, and the edited value is what gets
posted — `queryOf(i)` is the single expression behind what is displayed, what is counted, and what is
sent. A running line says what the resolve will cost and that nothing has been billed yet. Problems 2
and 3.

⚠ No server change was needed for the editable query: the curate route already resolves on `d.query`,
so the client posting a corrected one Just Works. That is worth knowing before anyone "adds an endpoint
for it".

## Not proposed here

- Any change to what a row *means* or to the curation guards — that is
  [what-is-a-drive-endpoint.md](what-is-a-drive-endpoint.md).
- Rank semantics. C bands *by* rank but does not change what rank is or how it is set.
- The dead `role` field on the client `PlaceDraft` (`'endpoint' | 'break' | 'both'`, required in the
  type, never emitted by the server since roles were removed 2026-08-04) — a separate cleanup, noted
  here only because it surfaced while reading this screen.
