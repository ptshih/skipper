# Narration context follows region geometry

**Status:** Deployed and verified 2026-09-10. Five staged recordings repaired; final Yosemite review has 78 Good verdicts, zero blockers, and current route evidence. The founder published the reviewed Yosemite corpus on 2026-09-10; all 78 clips and public discovery were verified.

The old studio helper classified every coordinate west of one longitude as Lake Tahoe, and every
other coordinate as Reno or Carson Valley. That assumption reached enrichment, story and scenic
generation, combined stories, alternate tellings, and offline grounding audits. Savage Trading Post
then presented a historical event near Tahoe as happening beside the listener on the Merced River.
Grounding could accept the mistake because it received the same wrong context.

Studio now reads the configured region catalog once per operator process and tests subject coordinates
against every box using the shared parser. Exactly one match supplies “the wider [display name] area.”
No match, invalid geometry, or overlapping regions supplies neutral wording, never a Tahoe fallback.
This supports new states without editing a location switch. A database failure stops the run.
Region boxes include approaches: both narrator and grounding judge are explicitly told that a region
label does not establish park entry, a lake view, proximity to water, or a specific valley floor.

A separate regional assumption existed in the pronunciation lexicon: bare Genoa used Nevada's
pronunciation even in “Genoa, Italy.” Qualified names now outrank matching unqualified hints.
Merced and Tioga have pronunciation hints for the operator-flagged recordings; stored scripts keep
normal spelling. References: [Merced](https://www.dictionary.com/browse/merced) and
[Yale's Tioga pronunciation entry](https://documents.law.yale.edu/pronouncing-dictionary).
A focused audio assessment did not flag the existing Hotel Charlotte recording's Genoa pronunciation;
the code-level collision is fixed without automatically replacing that accepted clip.

## Existing Yosemite audit

An independent desk review read all 78 staged scripts and found Savage as the sole confirmed
Tahoe/Reno/Carson location error. A deeper read of saved grounding evidence found five scenic clips
whose valley descriptions had been justified using Carson Valley: Glacier Canyon, Siesta Lake,
Bridalveil Meadow, El Capitan Meadow, and Pothole Meadows. Bridalveil and El Capitan Meadows
do occupy Yosemite Valley, and the canyon description does not establish a wrong setting.
Siesta Lake's “this valley country” is misleading enough to remove; Pothole Meadows' similar phrase
is removed conservatively. Targeted audio assessment flagged Siesta's geography and accepted
Pothole's generic framing. This is a regional-contamination audit, not a fresh verification of every
historical/geological fact or current amenity claim.

## Targeted spend must stay targeted

The first Savage repair invocation supplied both --region and --include-ids. A pre-existing selection
bug treated that combination as a region sweep and ignored the IDs, selecting 73 eligible subjects.
The process was terminated during narration/grounding, before the synthesis/persistence phase.
Some model requests had incurred spend; the terminated process did not retain its complete usage
tally, so its exact charge is unknown. No success or zero-cost claim is made for that attempt.

The selector now always constrains explicit IDs, intersecting with region geometry when supplied;
explicit IDs also force regeneration. Regression tests inspect the generated SQL and prove that a
region cannot erase the ID constraint. The corrected free preview selected exactly Savage Trading
Post before its paid retry. Future operator runs should still inspect the preview before spending.

Tests cover Yosemite, multi-box gateway approaches, Tahoe, unknown/invalid/overlapping regions,
a newly configured Moab region, qualified pronunciation, and combined region/ID selection.


## Completion evidence

Commit ea431418 deployed via Studio build 9a992602-000f-4fbf-8d48-779d27b40399 (SUCCESS).
The updated job executed successfully as skipper-studio-f25vh. Root checks passed; no mobile or API
contract changes. All 121 member subjects in the staged Yosemite publication set now resolve to
“the wider Yosemite National Park area,” with no Tahoe/Reno/Carson labels.

Savage was regenerated through the normal grounding gate. Ferguson and Tioga received fresh
pronunciation-guided recordings; Tioga required a further take after the judge caught an omitted
“made.” The final candidate scored source support/road context/fidelity 10 and writing/delivery 9.
Siesta and Pothole received minimal phrase removals, fresh grounding judgments, and new audio.
The 73 other narration versions were retained. Superseded audio remains backed up.

All 23 saved drives were replayed with the final recordings: 253 selected, 253 played, zero missing,
zero queue conflicts. The largest increase in a route's longest quiet window was 9.32 seconds,
explained by shorter audio; existing access/intentional-silence notes remain dated evidence.

Final review: 76382d75-fe0a-4194-886c-61249a49d85d. Assessment job
7c6a3cfb-7cf9-4a1a-bcf3-0f74afa0ece1 succeeded: 78 Good, no pending items, no structural blockers,
not stale. The final pass reused 77 judgments and cost $0.03174; the preceding five-change assessment
cost $0.1372. Focused regional audio checks cost $0.097326, and Tioga's pre-save candidate check
cost $0.031678. Savage's generation log reports ~$0.46 LLM plus ~$0.05 TTS; the two scenic grounding
checks report $0.111835 LLM. TTS repair costs are estimates, and the interrupted mis-scoped attempt's
charge is not included because its usage tally was lost. These are not claimed as a complete bill.

No release approval or publication was performed. Public region discovery still lists Tahoe and
Reno/Carson only. The operator can now approve the final review and explicitly publish its set.

Publication follow-up: the founder approved and published the final review on 2026-09-10 PDT.
Read-back confirms all 78 clips released and Yosemite ready in the public region list.
