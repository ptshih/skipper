# Upstream source errors: poi_overrides + the veracity eval + the durable eval record

**Status (2026-06-09):** built, reviewed (4-lens adversarial diff review; majors fixed), and
live-validated end-to-end: `poi_overrides` / `eval_runs` / `eval_scores` tables migrated +
seeded; corrections confirmed applying on live Wikipedia fetches; `--veracity` confirmed
catching both known errors PLUS five previously unknown ones on the emerald-bay artifact.

**Addendum (2026-06-19):** the eval-tables design below (§"The durable eval record") was SUPERSEDED
by `docs/decisions/automated-grounding-gate.md`. `eval_runs`/`eval_scores` were redesigned for V2:
`eval_runs` keyed by `region` with total/shipped/withheld tallies (no artifact/scorecard blob);
`eval_scores` keyed by poiId + qid with a `withheld` flag (dropping the `(poi_source, poi_source_id)`/
seq/stop_type triple) — see `schema.ts` + migration `0021`. Also, the "no automated groundedness gate —
the human ear instead" doctrine quoted below was REVERSED for GROUNDING (now an automated fail-closed
gate, same doc); VERACITY stays advisory by doctrine, so this doc's veracity loop (catch → adjudicate →
`poi_overrides`) is unchanged. The `poi_overrides` `(source, source_id)` keying remains CORRECT
(fetch-time, before the QID-keyed poi exists).

## The failure class

The grounding gate verifies **script ↔ sheet** — it is structurally blind to a sheet whose
SOURCE is wrong. A pre-regen adversarial review (2026-06-09) found confidently-spoken
falsehoods that scored *grounded 1.0*, because the narration faithfully rendered Wikipedia
errors: Vikingsholm's architect spoken as "Leonard Palme" (correct: **Lennart**; already in
the live canonical demo) and the Pope Estate "built by Lloyd Tevis (Wells Fargo) in the
1880s" (correct: **George Tallant, Crocker Bank, 1894**; Tevis family bought it 1899). A
related miss: Sugar Pine Point's side-of-road computed from its inland pin pointed riders
away from the lakeside content the script describes.

## The loop: catch → adjudicate → fix → contribute back

- **Catch — `eval/veracity.ts`** (`--veracity` on the eval CLI): an Opus judge with the
  `web_search` server tool checks the riskiest claims each STORY stop actually *speaks*
  (names, attributions, dates, superlatives) against the world and reports contradictions
  with a correction + authoritative source. **Advisory by doctrine** ("no automated
  groundedness gate — the human ear instead"). Validated on the emerald-bay dry artifact:
  caught Lennart Palme (incl. the nephew-*by-marriage* nuance) plus five unknown errors
  (Tahoe Keys construction decade, a false "highest US lighthouse" superlative on two
  stops, Chambers Lodge 1863-not-1854, Tahoe Maritime Museum 1987-not-1988, and a
  Mesozoic-vs-Cretaceous phrasing slip in a geology line).
- **Adjudicate** — a human confirms each finding; confirmed errors become `poi_overrides`
  rows. The judge can be wrong (the lighthouse superlative is definitional) — that's why
  this is never automated.
- **Fix — the `poi_overrides` TABLE** (founder-decided: the registry resides in the DB;
  rows are curated through the admin console — the seed-bootstrap CLI was removed 2026-06-19 — without
  clobbering workflow state). Each row is ONE documented correction, keyed by the source
  identity `(source, source_id)` — poiId can't work, the row may predate the place. (The
  override key is `(source, source_id)` because it applies at FETCH time, when only the
  source identity exists; `pois` itself now dedups on the Wikidata QID, with
  `(source, source_id)` a secondary guard — see `geometry-first-regions.md`/schema.)
  `poi_overrides` is now **fact-corrections ONLY** — a literal find→replace on fetched
  extract text, applied in `pipeline/wikipedia.ts` (both fetch paths — leads feed
  `mergedFeatures`, deeps feed the story sheet) after a once-per-process load
  (`pipeline/poi-overrides.ts`). Scope honesty: this seam carries **Wikipedia prose only** —
  geology (Macrostrat) and Wikidata lines enter the well through their own fetchers and are
  not editable here today. (The table no longer has a `kind` discriminator.)

  The corrected COORDINATE for a place's speakable content — once the lone `side_anchor`
  override row — **relocated off `poi_overrides` onto `pois.speakable_lat/lng`** (the seed
  defaults live in `pipeline/speakable.ts`, applied by `discover-pois.ts` when it sweeps a
  place; the DB column is authoritative thereafter, an admin edit wins on a re-sweep). It is
  **deliberately not a stored left/right** (review-caught: side flips with travel direction,
  and S→N / N→S are peer tours): the per-segment side is recomputed from
  `approach_heading_deg` × the anchor through the same heading-aware geometry as the pin, so
  it stays correct per drive — validated: Sugar Pine Point's lighthouse anchor → `right`
  northbound, `left` southbound.
- **No silent misses** (review-caught): an unmatched find-string is "source healed" OR
  "source reworded, still wrong" — indistinguishable without a human look, so the studio pipeline
  **warns** per unmatched edit per fetch context, never no-ops silently.
- **Retire, never delete** (the staleness stamp is max-over-EXISTING-rows, so a DELETE can't
  bust caches holding a withdrawn correction). Two cases: when the source text is still there
  but the correction is no longer needed, set `replace = find` (a no-op that still matches +
  bumps `updated_at`); when the source REMOVED the text so `find` matches nothing (it would
  warn forever), set **`active = false`** (added 2026-06-10) — the row is skipped at load (no
  apply, no warn, no cache-suspect) but still stamps freshness so the retirement busts adopted
  caches, and stays on the books for provenance. First retired: the Tahoe Keys construction-decade
  edit, after Wikipedia removed the dated sentence entirely.
- **Contribute back** — `upstream_status` (`not_filed → filed → merged/reverted`;
  `not_applicable` for our-judgment rows like side anchors) + `upstream_url` track fixing
  the source itself. Posture: **agent drafts, human submits** — Wikipedia's bot policy
  (WP:BOT) and COI norms rule out autonomous editing; the drafting agent reads `not_filed`
  rows (each already carries the correction + authoritative source) and a human files it.

### Propagation (stated precisely; the review caught an overstatement)

Corrections apply at fetch time, so on the next generation they reach the narration sheet
and — for a place that is itself a STOP — `pois.facts` and `facts_hash`, making that poi's
old narration rows detectably stale (`narration.facts_hash IS DISTINCT FROM
pois.facts_hash`). A page that appears only as a **mergedFeature** corrects the spoken text
but does NOT touch any `facts_hash` (merged features aren't pois rows) — re-telling is what
refreshes those clips. `resynth-narration.ts` (the `resynth_narration` job) stays the
surgical single-narration refresh tool. (The old `patch-clip` script was removed with the
authored-tour pipeline in V1→V2; its `patch_clip` jobKind enum member survives in
`@skipper/shared` but has no dispatchable script.)

### CC BY-SA note

Applying corrections to Wikipedia-derived text means clips derive from *modified* CC BY-SA
material; CC BY-SA permits modification with change indication. The override row (reason +
source) IS the documented change record; if attribution snapshots ever need an explicit
"modified" marker, the rows carry everything needed to generate one.

## The durable eval record: `eval_runs` + `eval_scores`

Founder-directed ("the eval loop should be less dependent on local files") and confirmed by
a best-practices survey: every eval platform (Braintrust, LangSmith, Weave, Langfuse,
promptfoo) treats the **run as a DB record keyed to a pinned artifact**; local files are
dev transport. Two tables, Langfuse-style:

- **`eval_runs`** — one row per eval (`generation` in-pipeline panel, live AND dry, or
  `offline_audit` CLI): slug/tour, git sha, narration + judge models, gate verdict, one
  trend column per dimension, and the **full artifact + scorecard as jsonb** (~100KB —
  in-DB per the BLOB-vs-DB literature; the R2 audio stays out).
- **`eval_scores`** — one row per (run × stop × dimension), keyed by the **stable place
  identity** `(poi_source, poi_source_id)` (stop ids regenerate; places don't), with
  `source: judge | human` so adjudications are rows on the same case — judge↔human
  calibration is a GROUP BY, regression is a join across runs.

What stays file-based, on purpose: judge prompts/rubrics/golden fixtures (git), and the
`--json` artifact/scorecard files as *exports*. Deliberately not built (solo-founder
traps): a self-hosted eval platform, dataset-versioning/annotation-queue machinery.
Dry runs write `eval_runs` only — observability, never tour state.

## Discipline (the line this must never cross)

An override is a **repair of a verifiable error**, never an editorial rewrite — `reason` is
mandatory, fact edits carry the authoritative `source_url`, and the seed tests enforce the
shape. "Persona lives in DELIVERY, never in FACTS" cuts both ways: facts get *corrected*
here, not punched up.
