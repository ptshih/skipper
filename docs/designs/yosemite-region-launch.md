# Yosemite launch and admin listening review

**Status:** Staged preparation and saved listening package complete 2026-09-09 PDT: 78 clips,
67 curated endpoints, 173 fact sheets, and 23 saved QA drives. California/Nevada local OSM extracts
are verified. All staged audio passes decode/duration checks; all 253 selected route occurrences
played with zero missing subjects. Follow-up operator fixes deployed successfully 2026-09-09 PDT; the final approval-button UI correction is also deployed and verified.
The existing app completed the five-stop Valley simulation. Automated audio assessment is being integrated; public
release remains pending; real GPS, device offline/audio behavior and a field drive remain follow-up checks.
Yosemite remains unpublished and unannounced; no mobile build or App Store submission is required.

The launch covers Yosemite's major driving corridors and the approaches from Groveland, Mariposa,
Oakhurst and Lee Vining, using the existing Skipper persona and voice. The installed mobile app stays
unchanged. Desk review, saved route simulations, audio checks and automated editorial acceptance establish
release readiness; a real drive remains follow-up validation. Documented silence is acceptable.

## Exception-driven acceptance (2026-09-09)

The founder superseded mandatory human listening: judge every staged recording and its script,
accept clear model passes automatically, and request attention only for low, uncertain or failed
assessments or human flags. The sampled reel remains optional browsing. Every clip now requires
acceptance, including legacy additional items. Human Good/Needs work takes precedence over automation.

`assess-listening-review --review=<id>` previews; `--apply` performs private audio decode/duration
checks and Gemini audio-input assessment. Review creation dispatches it automatically, with a $25
per-run cap. Cached exact clip/context/model/policy judgments are reused across sessions. Scores cover
supplied-source support, road context, writing, delivery and fidelity; source support is not a fresh
web fact-check. Hard technical findings cannot be waived. Unknown provider charges retain a conservative
budget reservation, and known usage includes reasoning tokens. No audio regeneration occurs here.

The UI defaults to exceptions and exposes scores, reasons, optional audio, human overrides and job
progress. Review approval and public publication remain explicit actions. No mobile change is needed.
Historical listening requirements below record earlier stages and are superseded by this section.

## Implemented operator workflow

Regions and admin navigation link to Listening Review. A saved session snapshots the exact staged
publication set, including individual and combined narrations. Region membership remains point-in-any
box; a combined narration belongs when any member is in a box, and its fingerprint includes every
member. The reel targets 12 complete clips, reserves representation for both available subject kinds,
then selects clips heard in saved corridor evidence before filling remaining slots across geographic buckets. It is not a statistically representative sample.
Additional automated flags require review. Every clip, including unsampled clips, requires a successful
full audio decode and duration check. Hard grounding/TTS failures cannot be waived; advisory findings
require a reason. Playback itself never records approval.

Verdicts (Unreviewed / Good / Needs work), notes, reviewer identity, timestamps, technical results and
version fingerprints persist in additive review tables. Unchanged verdicts can carry into replacement
sessions; release approval never carries. A changed region, staged set, audio version, member, endpoint,
evaluation record or route evidence invalidates approval. An individual release has an individual
session. Completed release receipts make retries harmless. Already-live regeneration stays live.

The publication resolver is shared by readiness, sessions, approval and release writes. Release takes
short database table locks before reading its snapshot in the next statement of a Neon HTTP batch;
this prevents new staged rows and membership edits racing the release. No transaction remains open
while listening. Review mutations whitelist editable fields and clear approval. Public API and mobile
contracts are unchanged.

The API and simulator share the combined-story loader in `@skipper/db/cluster-tellings`; API exports remain compatible. The simulator entrypoints share a resolver for individual and combined subjects. Frozen coordinates
and sequence survive anchor corrections, while content and the app's radius policy resolve live.
Legacy `poiId` selections remain readable. Missing subjects are printed; `--release-audit` rejects
missing/unplayable input. The normal report also rejects an audit where no clip triggers. The sim
package now has a test script, so root checks run its tests.

## Corridor and endpoint checklist

Saved QA evidence is operator-owned, uses frozen route geometry, and records selected/played stops,
queue conflicts, timing and quiet windows. The replay must intersect the region and play staged
region content. Corridor labels, legal direction, access and gap explanations remain explicit operator
attestations: a simulation cannot establish road legality or real-world seasonal access.

| Corridor | Candidate driving access points to verify | Required replay |
| --- | --- | --- |
| Valley roads | Valley Welcome Center parking, Curry Village parking, El Capitan Meadow pullouts | Legal one-way circuit |
| Wawona Road | Wawona, Tunnel View parking, South Entrance | Both directions |
| Glacier Point Road | Badger Pass junction, Sentinel Dome/Taft Point trailhead parking, Glacier Point parking | Outbound and return |
| Big Oak Flat Road | Big Oak Flat Entrance, Crane Flat, Valley connection | Both directions |
| Tioga Road | Crane Flat, Olmsted Point parking, Tenaya Lake parking, Tuolumne Meadows, Tioga Pass | Both directions |
| El Portal Road | El Portal, Arch Rock Entrance, Valley connection | Both directions |
| Evergreen/Hetch Hetchy | Evergreen Road junction, Hetch Hetchy visitor parking | Inbound and return during legal access hours |
| Groveland connection | Groveland vehicle access → Big Oak Flat → Valley | Both directions |
| Mariposa connection | Mariposa vehicle access → El Portal → Valley | Both directions |
| Oakhurst connection | Oakhurst vehicle access → Wawona → Valley | Both directions |
| Lee Vining connection | Lee Vining vehicle access → Tioga → Valley | Both directions while open |
| Cross-park journeys | Western gateway → Tioga → Lee Vining, and reverse | Representative east/west routes |

These are candidates, not verified endpoint coordinates. Do not pin a drive to a summit, waterfall or
trail destination that cars cannot reach. Contextual off-road members can still belong in combined
stories; road snapping is not a blanket enrichment filter.

## Seasonal desk evidence

Checked 2026-09-09: NPS lists Wawona, El Portal, Big Oak Flat, Valley, Tioga and Glacier Point roads
open; Hetch Hetchy access is sunrise to sunset. The page reports weekday delays on Big Oak Flat Road.
These are dated observations, not a promise of continued access. NPS says its web status covers
planned/long-term closures and directs visitors to its phone line for the latest status.
[Current conditions](https://www.nps.gov/yose/planyourvisit/conditions.htm).

Mariposa Grove's ordinary car endpoint is the Welcome Plaza parking/shuttle access, not the grove
road. NPS restricts that road to vehicles displaying disability placards when open. Tioga and Glacier
Point have seasonal closures; Hetch Hetchy and Glacier Point also have vehicle-size restrictions.
[Vehicle restrictions](https://www.nps.gov/yose/planyourvisit/restrictions.htm).

Before each paid route audit, check NPS again and compare actual route-provider results. Record
closed/restricted-route rejection and implausible-detour cases. No live closure service is being built.

## Preparation snapshot and approved free run

The read-only snapshot completed 2026-09-09 under
`packages/studio/.scratch/yosemite-preparation-2026-09-09/`: 16 tables, 9,116 rows,
1,094 R2 objects, all 767 referenced narration files present, zero missing references. It includes
private account data and remains gitignored. No database or R2 content was mutated by that backup.

The snapshot confirms Yosemite's starting 825 POIs, 30 groups, zero sheets, zero road anchors and zero
narrations. The region remains draft. The approved expansion preserves the original park rectangle and
adds four approach rectangles:

```text
-119.8861,37.4944,-119.1969,38.1858;
-120.25,37.70,-119.80,37.93;
-120.02,37.46,-119.73,37.74;
-119.72,37.30,-119.58,37.54;
-119.30,37.90,-119.10,38.00
```

The added boxes cover the Groveland/Evergreen approach, Mariposa/El Portal approach, Oakhurst/Wawona
approach and Lee Vining/Tioga approach, respectively. These are broad discovery bounds;
precise vehicle access points still need curation. Their northern extent is south of the other two
regions' southern boundary, so the proposed region boxes do not overlap Tahoe or Reno/Carson in the
snapshot. Store as one semicolon-separated value, without the presentation line breaks.

The founder approved deployment and the first free preparation batch on 2026-09-09: apply the geometry update;
refresh discovery with
`discover-pois --region yosemite-national-park --apply`; inspect resulting coordinates and groups;
preview `snap-speakable-anchors --region yosemite-national-park`, then apply only if the preview is
suitable, without `--force`. Discovery and OSM snapping make no model/TTS/Routes calls. No deletion,
classification, enrichment, narration generation, route-provider audit or release is included.
The geometry update and discovery refresh completed. All 175 discovery cells succeeded; 961 subjects
were upserted (316 story candidates, 645 scenic), with no full-article fallback reported. Yosemite now
contains 963 POIs and the same 30 groups, including 138 newly discovered POIs. Existing POI coordinates
and road anchors were unchanged. One additional new POI, Gibbs Canyon, falls just outside the boxes;
it remains outside the region's geometric publication set. No POIs were deleted.

The discovery report lists 12 exact coordinate collisions, including named climbing routes sharing
their landmark's pin. Desk triage also found Wawona Hotel overlapping the separate Wawona Hotel and
Studio subject, and mountain classifications on Parsons Memorial Lodge, Big Oak Flat Road and Hetch
Hetchy Road. Resolve these before generation; do not turn contextual off-road members into automatic
exclusions. The snapper's optional `--report <path>` saves all proposals and flagged pins as local JSON
for selective review without database writes.

The primary Overpass instance refused connections during the preview, which stopped without anchor
writes. A direct status request reproduced that failure; the OSM-listed Private.coffee instance
responded. The CLI now accepts `OVERPASS_URL` for an explicit alternative and fails closed on exhausted
server errors or HTTP-success runtime-error responses. Regression tests cover those cases, valid empty
tiles and recovery from a transient error. Public instance documentation was checked through Context7
and the [OSM instance list](https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances).
The alternative also exhausted its retries with a timeout on the second tile; a subsequent retry
exhausted HTTP 504 responses. No anchors were written from those incomplete results. The local OSM
path then removed this dependency: verified California/Nevada extracts from the same September 8
snapshot produced 3,655 Yosemite road ways and a complete preview (397 proposed anchors, 566 beyond
bounds). The preview is saved at `packages/studio/.scratch/osm/yosemite-anchor-preview.json` and includes
the source road file's fingerprint. See the [local OSM guide](../guides/local-osm-roads.md) for reusable
state caches, multi-state coverage checks and the Tahoe verification.

### First selective anchor application — 2026-09-09

Applied 24 reviewed proposals from the local extract. These are narration trigger coordinates on
roads, **not curated parking endpoints** or a certification of current access. OSM road tags were
inspected, including one-way and seasonal restrictions. NPS corroborates the roadside locations of
[Tunnel View, Olmsted Point and Washburn Point](https://www.nps.gov/yose/planyourvisit/viewpoints.htm).
Seasonal access still requires the checks above; no route-provider audit was run.

| Road / approach | Applied subjects |
| --- | --- |
| El Portal / CA 140 | Arch Rock; Arch Rock Entrance Station; El Portal; Midpines; Briceburg |
| Valley | El Capitan Meadow; Fern Spring; Stoneman Meadow |
| Groveland / CA 120 | Groveland Hotel; Buck Meadows |
| Wawona / CA 41 | Fish Camp; South Entrance Office; Wawona; Tunnel View |
| Glacier Point Road | Washburn Point; Peregoy Meadow; Pothole Meadows; Summit Meadow |
| Tioga / Lee Vining | Olmsted Point; Tenaya Lake Viewpoint; Tioga Lake Overlook; Tioga Pass Entrance Station; Siesta Lake; Lee Vining |

Offsets range from 4 to 211 metres. Briceburg's trigger lies on the highway bridge; it does not
instruct a stop. The remaining 373 proposed snaps are deferred, and 566 subjects were beyond bounds.
This first subset does not establish full corridor coverage: Big Oak Flat and Hetch Hetchy still
need further anchor review. Explicit holds include Medial Moraine (private Happy Isles Loop Road),
Inspiration Point (nearest match inside Wawona Tunnel), misleading kinds on roads/visitor centers,
and overlapping Wawona historic subjects. Off-road contextual members remain intact for enrichment
and combined stories. The road index filters highway classes, not legal access: retain manual road-tag
review when using local previews in other states.

The exact selected IDs, coordinates and matched OSM way tags are saved locally in
`packages/studio/.scratch/osm/yosemite-anchor-selected.json`; the complete desk evidence is
`yosemite-anchor-desk-review.json` in that directory. The dated application artifacts use prefix
`yosemite-anchor-apply-2026-09-09T23-23-17.031Z`, with `-before.json`, `-receipt.json` and `-after.json`.
A narrow scratch application used the frozen proposals, verified the road-file hash and region boxes,
and compared every selected POI against a fresh snapshot. A short transaction locked POIs/regions
and required the whole reviewed set to remain identical before writing any anchor. It changed only
`speakable_lat`, `speakable_lng` and `speakable_road_class`. An initial SQL column-name error rolled
back without writes; the corrected application returned all 24 IDs. Full before/after comparison
confirmed all other POI fields, all unselected POIs and every region were unchanged.

Yosemite now has 963 POIs, 30 groups and 24 anchors, with zero fact sheets or narrations. No Tahoe
anchors, source pins, cluster membership, endpoints or release flags were changed. The first free
preparation batch is complete at this conservative subset; broader preparation remains open.


## Tahoe comparison and next paid-run request — 2026-09-09

Fresh production reads establish the scale of the remaining work. Counts use point-in-any-box POIs
and places; a narration counts when its POI or any cluster member belongs. They describe inventory,
not verified driving quality or endpoint usability.

| Inventory | Tahoe | Yosemite |
| --- | ---: | ---: |
| Discovered POIs | 454 | 963 |
| Road anchors | 245 | 24 |
| Enriched sheets | 155 | 0 |
| Groups | 13 | 30 |
| Individual narrations | 261 | 0 |
| Combined narrations | 13 | 0 |
| Released narrations | 274 | 0 |
| Curated place rows | 132 | 0 |

The baseline is saved locally in `packages/studio/.scratch/osm/launch-baseline.json`. Yosemite's
region-wide free enrichment preview finds 319 eligible stories (typical estimate $12.76), but a
first targeted batch lets us inspect fact quality before scaling. This is an initial batch, not a
replacement for full corridor coverage or Tahoe-comparable completeness.

**Approved and started (founder authorized paid runs while away, 2026-09-09):**

1. Endpoint curation: `curate-places --region yosemite-national-park --target 150 --max-cost 2 --apply`.
   Free preview estimates $0.31 for the Opus draft, plus Google Places resolution charges. The target
   is guidance, not a strict result limit; the runner resolves the returned draft, ordinarily about
   150 Autocomplete/Details pairs. `--max-cost 2` checks the draft estimate only, **not total Places
   spend**. This writes ranked place rows, which require vehicle-access and corridor review before
   release. Check every corridor and all four gateways against the checklist, including actual
   parking access for trail destinations. No promise that all drafted rows become usable endpoints.
2. Initial enrichment: 37 exact POI IDs using Sonnet, typical estimate $1.48, with `--max-cost 10`.
   The running cost guard stops scheduling after the threshold; in-flight workers can overshoot.
   Selection is saved in `packages/studio/.scratch/osm/yosemite-enrichment-request.json`. Pass its
   `eligible[].id` as `--include-ids` **without `--region`**: this CLI's explicit-ID mode excludes
   filters, and combining them would silently select the region instead. The 50 considered subjects
   are the 24 anchored subjects plus members of eight groups; 37 qualify for story enrichment, while
   13 remain scenic candidates. The groups are El Portal and the Yosemite Railroad, Wawona and Its
   Pioneer History Center, Glacier Point Overlook, Hetch Hetchy and Its Dam, Tuolumne Meadows, Camp 4,
   Yosemite Valley and Bridalveil Fall, and Tioga Pass. Off-road context is deliberately retained.

Both free previews succeeded with no paid calls or corpus writes. This request includes no narration
synthesis, paid classification, route audits or public release. Before calibration generation, review
misclassified members such as Wawona Covered Bridge and Tioga Pass, then verify group geometry and
story membership. The separate Sentinel Dome/Separate Reality group and the Half Dome group containing
the whole Yosemite National Park subject are outside this initial enrichment selection and require
particular review before generation. Group existence alone is not editorial approval.

## Group and remaining-corridor desk audit — 2026-09-09

Fresh corpus reads still show no Yosemite fact sheets or narrations. All 30 groups currently have
zero tellable members under the shared runtime eligibility predicate. The scratch audit in
`packages/studio/.scratch/osm/yosemite-group-audit.json` also computes **prospective** geometry from
all current members, using existing anchors where present. Its radii are 250–323 m; none exceeds the
engine's wide-group threshold. This is not evidence that the groups are correct: nearby erroneous
source pins can produce a compact but misleading group. Recompute real geometry after enrichment;
only then does the eligible member set exist.

A complete tag pass over the 397 saved proposals found 21 with matched OSM ways tagged private/no
motor-vehicle access, private/no general access, or tunnel. They include Half Dome, Yosemite National
Park, Vernal Fall, Emerald Pool, Mirror Lake, Sierra Point and Inspiration Point. Keep these proposals
unapplied. A story may still use those subjects as context, but the restricted road is not an ordinary
rider route. Half Dome's proposed way `w292254779` explicitly limits private-vehicle access to disability
placards. The current raw pins of Sentinel Dome and Separate Reality are only a few hundred metres
apart, explaining their compact grouping; that does not verify the climb's true location. Preserve
the hold until a reliable location source settles it instead of trusting nearest-road distance.

| Remaining access review | Desk evidence and action |
| --- | --- |
| Hetch Hetchy | NPS identifies a parking area followed by a walk to the dam. Resolve the vehicle endpoint at parking, never on the dam. Existing subject proposals land about 592/610 m away on Hetch Hetchy Road (`w363422391`, sunrise–sunset). Check actual roadside vantage before applying these narration anchors. |
| Big Oak Flat / Crane Flat | NPS puts Merced Grove trailhead access on Big Oak Flat Road and Tuolumne Grove trailhead access on Tioga Road near Crane Flat. Curate those access points separately from the grove interiors. The Big Oak Flat Road POI itself has a near-zero-offset proposal but is incorrectly typed mountain; resolve the kind before generation. |
| Evergreen approach | Mather and Camp Mather have 48/196 m proposals on Evergreen Road. They can fill approach context after checking that scripts describe the settlement/camp, without directing riders into private camp facilities. |
| Grove stories | Mariposa Grove and Merced Grove groups have no within-bound proposals. Preserve their contextual members; investigate narration placement on the approach after actual parking endpoints are resolved. Do not force-snap trees to distant roads merely to populate counts. |
| High-country groups | Dana, Conness, Lyell and Maclure mountain/glacier groups also have no within-bound proposals. They are optional context, not substitutes for missing roadside content or mandatory parking stops. |

Sources checked for this audit: [NPS Hetch Hetchy parking and dam access](https://www.nps.gov/places/000/hetch-hetchy-reservoir-oshaughnessy-dam.htm),
[NPS Crane Flat area](https://www.nps.gov/yose/planyourvisit/cf.htm), and
[NPS trailhead parking](https://www.nps.gov/yose/planyourvisit/thparking.htm). These establish the
access pattern, not verified endpoint coordinates or a successful route-provider result. No paid
calls, corpus corrections or publication occurred during this audit; the two prepared paid runs
above were subsequently approved and started; inspect their live job handles/logs before retrying.

## Corpus preparation and approval sequence

1. Snapshot the corpus before preparation. Preserve the `yosemite-national-park` identity. Expand its
   multi-box geometry to include the checklist's corridors/gateways and inspect overlap with other
   regions. Preserve operator coordinate corrections; no blanket deletion or forced resnapping.
2. Refresh discovery, inspect coordinates and groups, snap suitable subjects to drivable roads, and
   curate verified vehicle endpoints. Record before/after counts, eligible subjects and rejected pins.
3. Present a concrete enrichment run (scope, selected IDs/count, model and budget) for founder go.
   Include useful contextual members even if off-road. The plan alone authorizes no paid run.
4. Present a small calibration generation batch with both subject kinds. Review it before scaling.
   Generate approved combined stories before remaining individual tellings to avoid duplicate spend.
5. Resolve failed gates and bad geography; keep every new telling staged. Save the operator QA drives
   and replay the checklist. Investigate unexplained gaps, document intentional silence, and reject any
   wholly unplayable promised drive. Paid planning/Routes calls each need a concrete founder go.
6. Create a Listening Review, run technical checks, hear every required full clip, save verdicts/notes,
   resolve Needs work, and explicitly approve. The founder supplies the listening judgment.
7. Obtain the separate public-release instruction. Publish through the approved review, then verify
   public discovery, planning, preview and playback after cache refresh, including staged-audio denial.
8. Only after coverage serves, update the site and eligible store metadata. Prepare version-scoped
   metadata/screenshots for the next submission. Run the existing app through preview, download,
   offline playback and simulated triggering; a real drive follows.

## Deployment and validation record

Commit `64f9d746` was pushed after applying the three additive migrations on 2026-09-09. All four
Cloud Build triggers succeeded. API revision `skipper-api-00162-fjr` replaced `skipper-api-00161-5mj`;
Admin revision `skipper-admin-00094-2qz` replaced `skipper-admin-00093-rzz`, each at 100% traffic.
The Studio job image was updated but no job execution was launched. Root `bun run check` passed again.
Public health/version probes succeeded, `/regions` still returned only Tahoe and Reno/Carson, and
the recent API/Admin error-log window contained no error-level entries. Unauthenticated Admin access
redirected to IAP. Authenticated production Admin loaded Yosemite readiness, persisted an empty review,
resumed it after refresh, and disabled approval/publication for its missing content/endpoints/evidence.
Production listening playback and clip verdict checks await staged audio; fixture verification below
does not substitute for that integrated check. No App Store submission was made.

Additive migrations introduce listening reviews, items and corridor evidence. Apply before deploying
admin; the production admin image now includes ffmpeg/ffprobe and the shared simulator read path.
Review creation, playback, verdicts, audio checks and saved-route replays invoke no model/TTS/Routes.
Paid correction links retain existing explicit confirmations.

Unit tests cover deterministic sampling, both subject kinds, hard findings, changed clip fingerprints,
legacy selections, frozen coordinates and missing subjects. A disposable local Postgres test exercises
real publication SQL for multi-box membership, combined members outside the region, unseen additions,
anchor changes, release stamps and retry receipts. It opts in only through
`LISTENING_TEST_DATABASE_URL` and refuses non-loopback hosts; never use dotenv for this fixture.
Root `bun run check` passed (exit 0). The production admin container built successfully and its
listening routes imported in the container. All three additive migrations applied successfully to a
disposable local Postgres database; the publication integration test passed against that migrated
schema, including concurrent audio edits waiting on the release lock and invalidating approval.

An isolated browser fixture exercised individual/combined navigation, private audio loading,
verdict saving, refresh/resume, rejected premature approval, explicit approval, and stale-review
blocking. The saved note and verdict survived refresh. This verifies the UI against fixtures, not
production R2/IAP. No development admin/API server was listening during that initial pass. Production
readiness and empty-session checks are recorded above; integrated audio and iOS checks remain pending.
Do not start shared development services without the founder's instruction. No public release or paid
operator run has been performed in this implementation pass.

The prior backlog item #75 assumed a global `GET /sample`; that endpoint was removed and anonymous
preview now comes from the proposed route. The #73 new-region nudge is outside this launch's unchanged
mobile scope. Store items #37–#42 remain blocked on release. The enrichment backlog uses the actual
region slug, not the obsolete shorthand `yosemite`.

## After-release copy drafts — do not publish early

Site coverage: “Drive with Skipper around Lake Tahoe and Yosemite, including Yosemite's major park
roads and approaches from Groveland, Mariposa, Oakhurst and Lee Vining. Seasonal road access varies.”

Promotional text: “Meet Skipper, your road-trip storyteller. Plan a drive around Lake Tahoe or Yosemite
and hear stories along the way. Save your drive's audio before heading offline.”

Next submission description/reviewer notes: replace Tahoe-only coverage statements with the verified
Yosemite coverage; retain a known-working Tahoe test journey and add one verified Yosemite journey.
Keywords and screenshots must describe released coverage; leave the geography-free subtitle alone.

## Implementation documentation

Drizzle's documented Neon HTTP batch supports raw `db.execute` statements, including a first lock
statement followed by validation/mutation. Context7 was consulted before implementation.
[Drizzle batch documentation](https://orm.drizzle.team/docs/batch-api).

## Reusable road-review holds

The snapper now retains the selected road way ID and all access tags for both Overpass and local
extracts. Its separate `held` report list prevents known restricted-road and tunnel matches from
being automatically applied, including with `--force`; it does not invent another vantage to bypass
a hold. Seasonal restrictions remain visible for desk review, and absent access tags are not proof
of public access. Class-only mode continues to describe existing anchors without moving them.

A fresh local Yosemite preview after the first 24 anchors returned 352 proposals, 21 holds and
566 beyond-bound subjects. Every proposal/hold had a matched way ID; Half Dome was held. The report
is `packages/studio/.scratch/osm/yosemite-anchor-preview-access-review.json`. Regression checks cover
Overpass evidence retention, nearest-segment/through-road evidence identity and restricted/tunnel
holds. This preview performed no corpus writes.

## Paid preparation and calibration progress — 2026-09-09

The founder explicitly authorized paid work while away. Endpoint curation returned 72 unique places
from 150-target drafting ($0.25 model spend plus Places charges). The 37-subject enrichment completed
without deferrals ($0.78), followed by 122 additional eligible subjects near road proposals and their
contextual group members ($2.22, zero deferrals). Yosemite now has 159 sheets. The second exact-ID set
is saved in `packages/studio/.scratch/osm/yosemite-expansion-enrichment.json`; suspect Sentinel Dome /
Separate Reality and Half Dome / whole-park groupings remain held from this preparation set.

Calibration has staged six clips: El Portal and the Yosemite Railroad, Tuolumne Meadows, Olmsted
Point, Groveland Hotel, Tunnel View and the scenic El Capitan Meadow. Groveland's first
TTS retake returned a provider 400; a later generation synthesized successfully. Its second text
attempt exposed a false positive: “landed on the right one” matched the directional-road regex. The
checker now excludes only bounded choice idioms, while still rejecting actual roadside directions,
including another direction elsewhere in the same script.

A second repair bug affected Tunnel View: `collectAvoid` prefers detail over findings, so the
laterality instruction lost the prefix used to select targeted excision. When factual claims also
failed, the editor received only those claims and never the direction correction. The gate now sends
both corrections through the same repair and re-evaluates the result; ineffective edits still fail
closed. The correction instruction also explicitly covers viewpoint descriptions. Tests exercise
combined factual/directional failures, direction-only repair, and ineffective repair withholding.
These changes apply to the shared individual/combined/scenic gate without changing persona or voice.

An El Capitan Meadow scenic calibration passed text gates but initially could not synthesize: the
production environment expects workload identity, unavailable to a direct local process. The local
development environment has the configured service-account credentials (same shared DB/R2); use it
for subsequent local synthesis. Do not mistake this for a content failure or silently publish silence.
The scenic retry and corrected Tunnel View repair both succeeded; Tunnel View passed all gates
after the shared excision fix (eval run `c280b797-f55f-4db4-a22b-6537d74c675d`).

The first complete endpoint audit billed 77 Routes calls (~$0.39), with three confirmed warnings and
one no-route error (Mariposa Grove). Five frozen, reviewed parking corrections were applied with a
fresh snapshot and atomic comparison: Mariposa Grove → Welcome Plaza parking; Happy Isles → Yosemite
Valley Trailhead Parking; Ansel Adams Gallery, Yosemite Museum and Valley Welcome Center → Yosemite
Village Parking. Only access-coordinate pairs changed; original identity, pin and rank stayed intact.
Artifacts use `packages/studio/.scratch/osm/yosemite-access-1788997160329` as their prefix.
The repeat audit billed 78 calls (~$0.39), returned routes for all 72 endpoints, and left only Happy
Isles with a confirmed warning. NPS explicitly identifies that trailhead parking as vehicle access
near Happy Isles; investigate the actual approach rather than treating Google's warning as proof
of prohibition. [NPS trailhead information](https://www.nps.gov/yose/planyourvisit/trailheads.htm).
Other feature centroids still need endpoint-position review even when the route audit passes.

Raw paid-run logs are local under `/tmp/yosemite-{curate-150,enrich-37,enrich-122,calibration-*,endpoint-audit-*}.log`.
No content has been publicly released. No review verdict has been supplied on the founder's behalf.

A second reviewed anchor batch applied 66 exact proposals, bringing Yosemite to 90 anchors. It covers
additional Valley/Tioga/Glacier approaches, El Portal history, Wawona context, Big Oak Flat's Wildcat
Falls and the Hetch Hetchy approach. Hetch Hetchy and its dam use within-bound narration approach
anchors, not parking endpoints. The selection and matched-way evidence are in
`packages/studio/.scratch/osm/yosemite-anchor-selected-second.json`. Fresh snapshot, exact-plan
comparison and full read-back confirmed only those anchor triples changed; no source pins, kinds,
other POIs or regions changed. Receipt prefix: `yosemite-anchor-second-apply-2026-09-09T23-46-44.465Z`.

All six calibration clips passed complete decode and duration checks using the same checker as Admin.
Olmsted Point initially had a +0.1 dB AAC true peak; exact-script re-synthesis corrected it to −2.1 dB.
The repeated six-clip check passed loudness and peak checks for every clip. Measured story tails were clean; the short scenic clip
is below the tail meter's measurement window. The six-clip report and private local audio are saved
under `packages/studio/.scratch/osm/yosemite-calibration-audio-checks.json` and `calibration-audio/`.
This is technical and script review, not the founder's listening approval.


## Expanded staged preparation — 2026-09-09

Twenty further group-approach anchors were applied with complete before/after comparison, bringing
Yosemite to 110 anchors. Only those 20 coordinate/class triples changed; source pins and other corpus
fields were preserved. Receipt: `yosemite-anchor-groups-apply-2026-09-09T23-52-53.597Z` in the local OSM
scratch directory. Nine misleading kinds were corrected separately: Tioga Pass became `pass`;
Wawona Covered Bridge, Parsons Memorial Lodge, Soda Springs Cabin, Big Oak Flat Road, Hetch Hetchy Road,
Glacier Point Ski Hut and the two visitor centers had incorrect landform kinds cleared. Receipt:
`yosemite-kind-corrections-1788997946968`. These corrections need preserving on future discovery.

Thirteen additional sheets for the groves, Half Dome, Sentinel Dome and Mist Trail context were
successfully enriched ($0.29; no deferrals), bringing the total to 172. Their exact IDs are frozen in
`yosemite-iconic-context-enrichment.json`. The 15-group batch produced 14 staged clips (23.8 minutes, approximately $10.26) and withheld Wawona
over unsupported date arithmetic. The 25 ungrouped, reviewed-road stories produced 24 staged clips
(30.4 minutes, $8.50 model plus approximately $0.96 TTS), withholding Housekeeping Camp over an
unsupported comparison. These exact sets excluded existing clips and questionable groupings.
The subsequent four-group batch produced Half Dome, Sentinel Dome, Mariposa Grove and Merced Grove
(5.7 minutes, approximately $1.54); all four passed the text gates. Tail advisories remain for listening.

Separate Reality was unlinked from Sentinel Dome and placed on an explicit geography hold.
[The climber-contributed route account](https://www.mountainproject.com/route/105874590/separate-reality)
places it near Big Oak Flat Road's tunnels, roughly 12 km west of the source pin;
[NPS places Sentinel Dome's approach on Glacier Point Road](https://www.nps.gov/places/000/sentinel-dome-and-taft-point-trailhead.htm).
No replacement coordinate was invented. The remaining group is titled Sentinel Dome. The whole-park
article was also unlinked from the Half Dome group, leaving Half Dome and its climbing-face context.
Both corrections used a fresh snapshot, exact-row atomic comparison and a no-existing-narration guard;
receipt `yosemite-group-corrections-1788998501863`. No subjects were deleted.


Ten explicit context anchors then brought the total to 120: Half Dome and its face share the
NPS-documented Sentinel Bridge view; grove members share their public trailhead or Welcome Plaza
approach. These deliberate context locations can exceed automatic snap bounds and do not move the
actual subject pins. Scripts must not imply the car reaches the trees. Receipt:
`yosemite-anchor-context-apply-2026-09-10T00-02-48.553Z`. Five more reviewed anchors cover Oakhurst on
CA 41, Badger Pass's Glacier Point Road approach, Tenaya Lake beside Tioga Road, and El Capitan/The Nose
at the Northside Drive meadow view, bringing the total to 125. Receipt:
`yosemite-anchor-landmarks-apply-2026-09-10T00-08-30.624Z`.

El Capitan received a fact sheet ($0.03) and an additive two-member group with The Nose. This does not
rebuild or delete any existing group. The snapshot and receipt use prefix
`yosemite-el-capitan-group-1788998960334`; the new group is `9a4311de-f654-4f7a-a487-846221c3de9f`.

Four access-only corrections now direct Hetch Hetchy, Glacier Point, Tuolumne Grove and Crane Flat to
actual parking/service-road nodes verified in the cached California extract. Original place identity,
rank and geographic pin remain intact. Evidence: `yosemite-reviewed-parking.opl`; atomic-write receipt:
`yosemite-parking-access-1788998727464`. Together with the earlier five corrections, nine places now
have explicit vehicle-access coordinates. NPS confirms the walking/vehicle distinction for these
attractions; the source coordinates are OSM measurements, not NPS-published coordinates.

The first 23 paid QA route requests all returned geometry without restricted-road warnings. Frozen
waypoints, polylines, durations and warnings are in `yosemite-qa-routes/` under the OSM scratch directory.
They are route-provider evidence only so far, not completed saved-drive playback audits. The Mariposa
journeys detour via Oakhurst (roughly 121 km, two hours) and cannot count as the intended Highway 140
approach. Caltrans's 2026-09-09 report lists traffic control on SR 140, while CAL FIRE's September 5
update describes a lane reopening after the Colorado Fire. Preserve the discrepancy and test the
intended via-El-Portal route before accepting corridor coverage.
[Caltrans SR 140](https://roads.dot.ca.gov/?roadnumber=140),
[CAL FIRE reopening update](https://www.fire.ca.gov/incidents/2026/9/1/colorado-fire/updates/1e755e34-46bb-4a37-8934-a223ed31316d).


The explicit Mariposa → Briceburg → El Portal → Valley probe returned 70.7 km / 71 minutes, and its
reverse returned 68.7 km / 67 minutes without warnings. The isolated El Portal → Briceburg request
still produced a 112.2 km detour, while Briceburg → El Portal was 26.9 km. These contradictory provider
choices are saved in `yosemite-qa-mariposa-detour-probes/`; they do not establish a closure. Use the
explicit via routes for corridor replay and retain the detours as rejected audit evidence.

The staged set now contains 75 clips (53 individual/scenic, 22 combined), totalling 85.3 minutes.
All 75 passed full decode and duration checks; none clipped above 0 dBTP. Ten clips miss the stricter
mastering target/headroom checks and three show tail-volume drop in the independent mastered-audio
measurement. These are listening findings, not a claim that every clip sounds right. Full report:
`yosemite-staged-audio-checks.json`; exact publication snapshot: `yosemite-staged-publication-snapshot.json`.

All 23 frozen routes played every selected clip in an initial constant-speed replay, with zero missing
subjects. This uses the API's exported internal `selectStopsForRoute` helper and the simulator's shared
selection resolver; no rider API field changed. Counts range from four clips on the Hetch Hetchy
approach to twenty from Lee Vining to the Valley. Quiet windows range up to about 36 minutes at the
chosen speeds; investigate those intervals before recording corridor attestations. Local replay files
are `yosemite-qa-routes/replay-*.json`. They are not yet operator-owned saved drives or approved evidence.

Audio review exposed a gate classification bug: studio's TTS row mixes script-safety failures with
post-synthesis advisory measurements, but Listening Review treated every failed TTS row as hard.
The review now recognizes only known, structured tail/loudness/non-clipping-headroom advisories.
They stay in the required listening queue and still need an explicit reason and Good verdict.
Withheld content, unsafe markup, failed grounding, actual clipping, missing measurement evidence and
unknown technical failures remain non-waivable. Regression checks cover mixed hard/advisory rows.


Saved route evidence now accepts an active drive owned by the IAP reviewer or by a real app
administrator. This addresses different app/IAP login identities without changing drive ownership,
credits, reviewer attribution, or public access. Missing owners, deleted drives, anonymous accounts
(including an erroneous admin role), and unrelated ordinary riders remain ineligible. The ownership
guard runs before loading staged selection/audio metadata. Predicate tests cover those boundaries;
a read-only review also verified handler ordering and unchanged attribution.

Quiet-window investigation locates the longest gaps on the western Big Oak Flat/Evergreen approaches
and western Tioga forest segment. The frozen selections have no missing subjects. The current inventory
has no convincing omitted roadside landmark in the longest western Tioga window; this is evidence of
sparse coverage, not proof that no worthwhile subject exists. Ackerson Meadow has a useful enriched
restoration story and an NPS-documented Evergreen Road walking approach. Hodgdon Meadow lacks an
enriched sheet; Crocker Meadow's proximity alone does not justify filler. These are desk findings,
not founder listening acceptance or current road-opening guarantees.


The geography readiness check now validates both raw feature coordinates and optional road-trigger/
vehicle-access pairs. Partial pairs and non-finite or out-of-range coordinates block publication.
For an initial launch, two feature pins sharing one parking access point count as one usable endpoint,
matching the API's existing route-waypoint behavior. Region membership still uses original feature
pins. Tests cover individual and combined narration anchors, legacy endpoints without access
corrections, invalid pairs, and shared parking locations. No rider API or mobile change is involved.

Ackerson Meadow received a reviewed Evergreen Road context anchor at 37.834407, -119.847963
(OSM w399774488 / w10712870 junction; anchor receipt
`yosemite-anchor-ackerson-apply-2026-09-10T00-32-24.007Z`). NPS's restoration planning Q28/Q32
identifies the turnout and walking approach; the narration does not promise a view from the car.
The first generated clip exposed a Wikipedia river-name error. Three persistent fact overrides
correct Ackerson Creek, remove a related unsupported rock-apron location sentence, and fix Nancy
Wainwright's misspelled name. The restoration partner's
[account of the acquisition](https://www.americanrivers.org/2016/09/yosemite-national-park-grows-by-400-acres/)
is the correction source. Receipt: `ackerson-fact-corrections-1789000565037`. The existing refetch,
forced enrichment and generation workflows then rebuilt the clip (80 seconds, one tail retake,
eval run `2a3e9c40-0e34-466e-90fa-603aad5bd209`). The set is now 76 staged clips; nothing was released.

### Source correction support and additional endpoint checks (2026-09-09 PDT)

The Wikidata fetcher now applies persistent QID-keyed fact corrections to its rendered bundle.
Individual and combined generation diagnostics check Wikipedia's fetch clock and Wikidata's
separate enrichment clock, including QIDs preserved in older sheets. Retired edits still invalidate
older caches. These are advisory diagnostics; existing sheets need explicit forced enrichment.
The admin correction editor exposes the POI's primary source and its Wikidata QID, with
source-labelled edits and source-specific retirement. The server resolves identities; clients cannot
choose an arbitrary QID. Existing source-omitted requests retain their primary-source behavior.
No migration, rider contract, mobile build, or App Store submission is involved.

The external-source audit completed 55 staged stories, including all 22 combined stories:
`offline_audit` run `0f5c871c-d6a3-41e3-a40a-720f88556e3c`, $23.35 model tokens plus
search fees. Fifteen stories received advisory findings. Findings were adjudicated against source
material; they are not automatic proof of falsehood. For example, Tunnel View's cited NPS planning
document itself includes the disputed 1932 construction date; waterfall tier counts differ across
sources; Ferguson's construction estimate and funding allocation are different measures.
Supported corrections and removal of volatile business/construction status are recorded in the
local `yosemite-veracity-correction-plan.json`; regenerated clips need fresh checks and listening.

The staged corpus now contains 78 clips after adding Dana Meadows and Second Garrotte at verified
road junctions. Neither anchor claims vehicle access to the named feature itself. Seven destinations
received verified parking access coordinates: Tenaya Lake, Tuolumne Meadows, Lembert Dome, Ellery Lake,
Tioga Lake, Saddlebag Lake, and Lundy Lake. Fourteen paid Routes calls (both directions from Lee Vining)
returned plausible routes without restrictions or warnings; frozen responses live in
`yosemite-lake-route-audit/`. This is dated routing evidence, not a promise of seasonal opening.

Before removing three invalid/duplicate endpoints, a full corpus/R2 snapshot completed at
`packages/studio/.scratch/yosemite-pre-endpoint-cleanup-20260910/`: 1,174 objects, all 845 referenced
clips present. Scoped cleanup removed the mid-tunnel Wawona Tunnel pin, duplicate Tuolumne Meadows
lake pin, and unverified Lake Eleanor endpoint. Tunnel View and the canonical Tuolumne Meadows
endpoint remain; the latter inherits the duplicate's priority. There are 69 curated endpoints,
16 with vehicle access coordinates. No narration, rider drive, or published region was removed.

The same audit found an enrichment formatter error: a mixed “sedimentary and volcanic” map-unit
name caused the formatter to append a lava-origin claim to mudstone/carbonate/sandstone/conglomerate.
The formatter now preserves source lithology and age without inferring a shared formation process.
Three Yosemite sheets contain the old line (Ferguson, Briceburg, Greeley Hill); their refresh is
included in correction preparation. The existing Ferguson and Briceburg clips do not speak that
incorrect clause, and Greeley Hill has no clip. Mocked fetch tests cover mixed and ordinary units.

Twenty persistent corrections across 17 POIs were applied with compare-and-swap checks and a
scoped before/receipt snapshot (`yosemite-veracity-corrections-1789002485774`). All 19 requested
sheets rebuilt successfully for approximately $0.35 model spend, including the three geology
repairs. Readback confirmed every superseded find-string absent from refreshed sources/sheets.
Five combined and eleven individual stories regenerated successfully, with zero withheld:
approximately $2.67 combined production and $4.30 individual model spend plus $0.47 estimated
individual TTS. The individual eval run is `f160b241-f8b2-4981-819b-ca99695297ae`.
A fresh external-source audit and all-clip technical pass are in progress; these production gates
are not listening approval. Admin source-channel readback showed both Olmsted identities and
rejected an invalid source with HTTP400 without writes or starting a dev server.


### Saved launch review and final preparation (2026-09-09 PDT)

The follow-up external-source audit checked 18 clips (16 regenerated plus Dana Meadows and Second
Garrotte), eval `fdfae3d8-70e7-4f88-9456-bbbfb1482ea3`, $8.49 model spend plus search fees.
Three advisory disputes remain. Building-specific NPS material supports Mather's $39,380 Rangers'
Club payment; archival catalogues support John Amos Chaffee; Sierra's headquarters relocation does
not contradict continuing Oakhurst operations. These adjudications and the earlier Tunnel View date
conflict are saved as agent notes, without Good verdicts or advisory acceptance reasons.

All 78 current audio files pass full decoding and duration validation, with no measured true peak
above 0 dBTP. Nine mastering measurements and one larger tail drop remain listening advisories;
these checks do not establish a good performance. Evidence: `yosemite-staged-audio-checks.json`.

The final 23 frozen-route replays selected and played 253 clip occurrences with zero missing subjects.
All 23 are now saved drives owned by the existing app administrator, using 23 ordinary drive credits
(balance 91 to 68); retries are designed to avoid additional debits. Corridor evidence includes exact
speeds, dated access sources, investigated quiet windows, and intentional silence. Long forest gaps
remain pacing questions for listening. Receipts and geometry live in `yosemite-qa-routes/`.

Three further vehicle-access corrections cover Lower Yosemite Falls (Village parking), Lundy Canyon
Trailhead (road-end loop), and Mono Lake Tufa State Natural Reserve (Old Marina). Six paid Routes
checks, both directions, returned plausible routes without restrictions or warnings. Following a full
snapshot of 1,190 R2 objects with all 845 referenced clips present, scoped cleanup removed closed
White Wolf Lodge and the private Pine Mountain Lake Association entry. No other place fields changed.
Final inventory: 67 endpoints, 19 access-coordinate pairs. Snapshot:
`packages/studio/.scratch/yosemite-final-endpoint-review-20260910/`.

Saved review [`50d4208c-4897-42ca-84cc-c3b5c58c9b8e`](https://skipper-admin-csslmysz7q-uk.a.run.app/listening?region=yosemite-national-park&review=50d4208c-4897-42ca-84cc-c3b5c58c9b8e)
contains the exact 78-clip staged set: 12 reel clips and 27 additional flagged clips require 49:33 of
listening. The other 39 clips remain available. All 78 technical results are saved, all verdicts remain
Unreviewed, and all 23 corridor evidence records are attached. The current local implementation reports
no structural blockers and a current fingerprint. The deployed admin still misclassifies 17 known
post-synthesis advisory rows as failed generation gates; the already-committed advisory classification
fix must be deployed before approval. The live UI correctly shows the new counts, saved session, route
evidence, and disabled approval/publication controls. Private audio loaded with a 69.1-second duration,
readyState 4 and no media error; Next/Previous navigation changed the selected clip correctly.
No release or approval was submitted.

On the unchanged iOS development build (iPhone 17 Pro Max, iOS 26.5), a cold reload refreshed the old
region bootstrap: Yosemite suggestions and all 23 saved QA drives appeared. The Valley legal circuit
showed five stops and its route map; loading downloaded all five clips and displayed Saved Offline.
A combined-story preview showed advancing playback progress and source attribution. The player reached
Ready to Roll with simulated GPS; automated UI access then lost the Simulator window, so completion of
the in-app simulated drive was not observed. The simulator remains set to simulated GPS and should be
restored to Real after that check. CLI route replay success is separate evidence. Real GPS in motion,
airplane-mode offline use, audio focus, interruptions and lock-screen behavior still require a device;
no fresh native splash/icon verification was attempted. No mobile source was changed.

A repeated release-filtered selection check found zero staged leaks on the Valley circuit and all four
gateway routes. Yosemite still has zero published narrations. Website and store announcements remain
pending the explicit public-release instruction. Root `bun run check` passed after preparation. The remaining review/deployment steps must accompany
the final rollout; counts alone do not establish Tahoe-equivalent driving quality.


### Same-day store update tooling (2026-09-09 PDT)

`bun run asc:metadata -- --promotional-text-only` now previews only the live iOS promotional text.
After the explicit coverage-release and copy-publication instructions, its `--apply` path sends only
that field and reads it back. It never requires review-note credentials or touches version-scoped
metadata. The unique live version and exact en-US localization are selected independently of draft
ordering; ambiguous or incomplete inventories and intervening copy changes fail closed. Mocked API
checks prove write scope, no-op/preview behavior, target rejection and readback failure. A real ASC
preview found the existing live 1.1.0 copy already matched (168/170 characters); no listing was edited.
Apple's [field documentation](https://developer.apple.com/documentation/appstoreconnectapi/app-store-version-localizations)
confirms promotional text can change at any time while other localization fields need an editable
state. This makes the no-App-Store-submission launch path operational; next-version copy still waits.

The saved-drive retry was also exercised against current data: all 23 existing drives recognized,
zero additional credit debits. The remaining simulator UI attempt still found no controllable window;
no further in-app triggering result is claimed.


### Operator deployment verification (2026-09-09 PDT)

Founder authorized pushing the prepared commits. Commit `da7a4a40` deployed successfully through
API build `1491b7d1-1a06-4598-b69d-193712d676a8`, Admin build
`be50f1af-a2f0-4843-9b65-e73ede59c2b6`, and Studio build
`e046bbf7-749b-46fb-967c-e20802a06f48`. Current trigger path filters correctly skipped Site.
API moved from `skipper-api-00162-fjr` to `skipper-api-00163-59p`; Admin moved from
`skipper-admin-00094-2qz` to `skipper-admin-00095-rs9`, both at 100% traffic. Studio job
configuration generation 76 was observed; deployment did not execute the job.

Public health returned HTTP200 in 230ms (baseline 255ms), version policies were unchanged, and
`/regions` continued to expose only Tahoe and Reno/Carson. Health proves process liveness; the region
response additionally exercises DB-backed discovery. No error-level API/Admin logs appeared in either
the pre-push or post-push 15-minute windows. Authenticated production Admin resumed the exact saved
78-clip review, with 67 endpoints, all corridor evidence, and the former 17 false hard blockers gone.

The live UI exposed one remaining usability gap: approval was clickable while listening verdicts
were missing, although the server still rejected it. The button now stays disabled while clips need
required verdicts, advisory reasons or technical checks, with an explicit remaining-item count.
This is presentation guidance; the unchanged atomic server query remains the authority. Regression
checks cover required versus optional items, Needs work, technical failures, and advisory acceptance.
The Reference page and canary skill also reflect the actual workflow and path-filtered deployments.


### Final deployed UI and existing-app pass (2026-09-09 PDT)

Commit `d118ab3e` deployed the approval-button correction through successful Admin build
`3a686fd6-121e-4a20-84df-fac541c53626`. Admin revision `skipper-admin-00096-2gs` serves 100%.
The authenticated production page shows “39 clips still need listening verdicts, advisory reasons,
or technical checks before approval”; both Approve release review and Publish approved set are
disabled. The current saved session and all 78 technical results remain intact. Root `bun run check`
and the admin production build passed before deployment. No API/Admin error-level logs appeared in
the final 15-minute observation window. No human verdict, approval, release or store update was sent.

Simulator access resumed after the founder returned. On the unchanged iPhone 17 Pro Max / iOS 26.5
development build, the saved Valley legal circuit ran to Drive Complete with **5 of 5 stops played**.
The UI showed each automatic transition in order: Fern Spring; Yosemite Valley and Bridalveil Fall;
Ahwahnee and Royal Arches; Camp 4; El Capitan and the Nose. Playback progress advanced through each
clip. Switching to the route map and back preserved playback. The fast simulator compresses quiet
road time and plays clips in real time; this is simulated GPS evidence, not a physical drive.
The drive remained Saved Offline after completion. Settings → Developer was restored to Real GPS,
with Real checked and Simulated unchecked. Actions used accessibility handles, not coordinate taps.

This closes the previously incomplete in-app simulation check. The simulator still does not prove
real GPS accuracy/heading, device airplane-mode operation, exclusive audio focus, interruptions, or
lock-screen behavior. No native build, splash/icon verification, mobile source edit or App Store
submission occurred. The operator review is ready for the founder's listening judgment.


### Review recreation response-limit repair (2026-09-09 PDT)

Creating a replacement review failed after the first populated session existed. Reproduction exposed
Neon HTTP507: the result exceeded 67,108,864 bytes. The history join selected the 4,491,832-byte parent
snapshot once per each of 78 items, multiplying it to roughly 350 MB. Carry-forward now projects only
item fields and selects the latest verdict per narration/fingerprint. The review picker projects only
its three metadata fields; snapshots load only when opening an individual review.

The corrected real-data history response was 41,662 bytes. An in-process request through the actual
admin handler created review `3d43c980-b27e-4453-ad4b-8a789227c09f`, with all 78 items and prior
verdicts, notes, advisory reasons, technical results and reviewer identities preserved. The picker
response was 310 bytes. Regression tests compile the real queries and reject snapshot projection.
No release or approval was created. This repair needs deployment before the founder retries in Admin.

Founder subsequently requested model-led review: passing LLM judgments should count as accepted by
default, with low/uncertain scores presented for optional listening and flagging. This supersedes the
mandatory human reel-listening requirement above. Implementation is pending; retain explicit release
approval/publication, non-waivable technical failures, visible score provenance, and version freshness.
