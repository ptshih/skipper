# Scenic filler, and what goes in an empty stretch

> **Status:** DECIDED 2026-06-09 (founder) — *real stops only; candidate-less stretches stay silent.*
> **Recorded here 2026-08-03**, and **REOPENED by the founder the same day**. This entry is
> backfilled: the original call was made in a design session, shipped as a revert, and written down
> **nowhere** — it survived only in agent memory and git history, while
> [scenic-stops-spec.md](../designs/scenic-stops-spec.md) went on proposing the very mechanism it
> rejected. The reopening is recorded in §3; nothing new is greenlit.

## 1. What was decided in June, and what was thrown away

The founder's goal was never "add scenic stops" — it was **avoid long stretches of silence.** Two
mechanisms were BUILT and then REVERTED (`d2a2056`):

| Built | Rejected because |
| --- | --- |
| **`SCENIC_ANCHORS`** — factless curated overlooks, geology-only mood beats, on a `'curated'` poi source | *"too neutered"* — factless content was charmless |
| **`FEATURED_STOPS`** — force-include famous spots as separate factless mini-stops | famous spots should be **GROUNDED**, not factless |

The `'curated'` enum value was reverted and never shipped. **What shipped instead was not filler at
all** — it was more of the real thing: loosen the pacing floor (`minGapSec` 240 → 180, max stops
14 → 16), MERGE co-located POIs into one richer telling, and allow multiple optional breaks.

**The decision, in the founder's terms:** candidate-less wilderness stretches — Camp Richardson →
Emerald Bay, ~7 minutes — **stay silent.** Real stops only. *Real stops cannot fill an empty stretch,
and filler is worse than the quiet.*

⚠ **This is the same doctrine the code states in its own voice.** `drive-select.ts:105`:
*"DROPPED — silence beats a clip playing far behind the car."* And the pipeline principle it
inherits: silence beats a hallucinated battle.

## 2. Two things that make the June call STRONGER than it looks

Both were checked 2026-08-03 while trying to find grounds to reopen it, and both cut the other way:

- **The soundtrack already existed.** `apps/mobile/src/lib/driveMusic.ts` landed **2026-06-07**
  (`f6aff09`), two days BEFORE the decision. So "stays silent" never meant silence — the founder
  made this call knowing an empty stretch is a rotating curated instrumental. ⚠ Any future argument
  of the form *"but today that stretch is dead air"* is false and was false in June.
- **Nothing measures quiet, deliberately.** `DRIVE_MIN_GAP_SEC = 180`
  (`packages/engine/src/pacing.ts:15`) is a **floor**; `driveMaxStops = totalSec / 240` is a **cap**.
  There is no gap CEILING anywhere in selection — no code path treats a long quiet stretch as a
  defect. The absence is the design, not an oversight.

## 3. Reopened 2026-08-03 (founder), and where it went

The founder reopened *"real stops only"* explicitly in a Skipper Hours session. The session did not
resurrect either rejected mechanism — both objections above are about CONTENT QUALITY and nothing
since June has addressed them. It produced a **third shape** instead, which cleared the "too
neutered" bar because it is grounded:

**The subject is the EMPTINESS.** He is not narrating rock; he is explaining *why there is nothing
here* — and each void has its own reason (a lake bed that dried out, land nobody could farm, a
wilderness nobody was ever allowed to build in, water that got taken to a city). The staged moment:

> *"You have noticed there is nothing out here. That is not an accident — you are driving across the
> floor of a lake that dried up before anybody was around to miss it. Everything green gave up here a
> long time ago."*

**Why this is not `SCENIC_ANCHORS` again:** it asserts real facts, so it is grounded rather than
factless, and its subject differs per stretch — where "this is granite" was one line that landed at
**24 places** and needed a `[SHARED]` marker to beat back, "why is this empty" is unique to each void
by construction.

### What it would need, none of which exists

1. **A fact source.** Macrostrat gives you the rock, not the reason. ⚠ Note that the `geology`
   narration channel already exists and has **never fired** — `narrate.ts:70-75` records that
   Macrostrat sentences go into `facts` as ordinary bullets, *"which is why the geology monotony it
   was written to prevent happened anyway."* Do not read that channel as coverage.
2. **A third subject kind.** `narrations_subject_xor` is
   `(poi_id IS NOT NULL) <> (cluster_id IS NOT NULL)` — a stretch is neither. The wire is already
   subject-keyed (`subjectId`/`subjectKind`) and 1.1's offline store is keyed by subject id, so the
   change is a nullable FK plus widening the XOR — cheap, but it is a schema change.
3. 💸 **A paid enrich + generate pass** — an operator paid run requiring an explicit founder go, per
   run, never inferred from a design session.

**Not greenlit.** It survived the charm questions and lost on timing: it is not a this-week idea, and
the founder chose a $0 path in the same session (see below).

## 4. What the session actually shipped a decision on

The founder's own reframe mid-session — *"tell stories about the area/district that doesn't
necessarily pin to one specific POI"* — turned out to be a different and much cheaper problem, and it
is recorded where it belongs: [fused-cluster-generation-spec §4.3](../designs/fused-cluster-generation-spec.md).
Short version: three groups already hold **8m13s of released audio no drive can play**, and the fix
is $0.

⚠ **They are opposite motions and should not be conflated.** Area/district tellings make dense places
**sparser and richer** (members retire behind the fused telling). They fill no empty stretch. The
question this entry exists to answer — *what goes in the void* — is still answered "nothing", by the
June decision, until the §3 shape is funded.

## 5. Related

- [scenic-stops-spec.md](../designs/scenic-stops-spec.md) — ⚠ still proposes `SCENIC_ANCHORS`, the
  mechanism §1 rejected. Read this entry first.
- [downtime-callouts-spec.md](../designs/downtime-callouts-spec.md) — the PERSONA-ONLY answer to the
  same void (placeless mood beats). Amended the same day; its own §0 records that the music now
  **steps back** rather than ducking, on the same "the stretch was never quiet" finding as §2 here.
- [poi-legibility-layer.md](../designs/poi-legibility-layer.md) — measured drives selecting **8 stops
  where pacing allowed 12**, i.e. some gaps are unspent budget rather than absent content.
