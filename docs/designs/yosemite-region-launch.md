# Yosemite launch and admin listening review

**Status:** Operator tools implemented and locally verified 2026-09-09; corpus snapshot complete. Corpus preparation,
paid runs, listening approval, deployment and public release remain pending. Yosemite is not announced.

The launch covers Yosemite's major driving corridors and the approaches from Groveland, Mariposa,
Oakhurst and Lee Vining, using the existing Skipper persona and voice. The installed mobile app stays
unchanged. Desk review, saved route simulations, audio checks and founder listening approval establish
release readiness; a real drive remains follow-up validation. Documented silence is acceptable.

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

## Preparation snapshot and first run awaiting go

The read-only snapshot completed 2026-09-09 under
`packages/studio/.scratch/yosemite-preparation-2026-09-09/`: 16 tables, 9,116 rows,
1,094 R2 objects, all 767 referenced narration files present, zero missing references. It includes
private account data and remains gitignored. No database or R2 content was mutated by that backup.

The snapshot confirms Yosemite's starting 825 POIs, 30 groups, zero sheets, zero road anchors and zero
narrations. The region remains draft. The proposed expansion preserves the original park rectangle and
adds four approach rectangles:

```text
-119.8861,37.4944,-119.1969,38.1858;
-120.25,37.70,-119.80,37.93;
-120.02,37.46,-119.73,37.74;
-119.72,37.30,-119.58,37.54;
-119.30,37.90,-119.10,38.00
```

The added boxes cover the Groveland/Evergreen approach, Mariposa/El Portal approach, Oakhurst/Wawona
approach and Lee Vining/Tioga approach, respectively. These are proposed broad discovery bounds;
precise vehicle access points still need curation. Their northern extent is south of the other two
regions' southern boundary, so the proposed region boxes do not overlap Tahoe or Reno/Carson in the
snapshot. Store as one semicolon-separated value, without the presentation line breaks.

First operator run to present for go: apply this region-only geometry update; refresh discovery with
`discover-pois --region yosemite-national-park --apply`; inspect resulting coordinates and groups;
preview `snap-speakable-anchors --region yosemite-national-park`, then apply only if the preview is
suitable, without `--force`. Discovery and OSM snapping make no model/TTS/Routes calls. No deletion,
classification, enrichment, narration generation, route-provider audit or release is included.
The plan requires each operator run to be presented concretely for go, so this run has not started.

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
production R2/IAP. No development admin/API server was listening when checked, so integrated browser
and iOS checks remain pending.
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
