# Narration context follows region geometry

**Status:** Built 2026-09-10; Yosemite remediation and release assessment in progress. Public release remains gated.

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
