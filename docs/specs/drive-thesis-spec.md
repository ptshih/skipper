# The drive's thesis — build spec

> **Schema-names note (2026-06-19):** the `tour_brackets`/`tour_frames` and `tours`/`tour_stops`
> tables this spec references were ALL dropped in migration 0009 (V2 roam-first model — see
> `packages/db/src/schema.ts`). Mapping for a future build: the user-owned ordered sequence is now
> the `drives` table (not `tours`); place tellings are 1:1 `narrations` (not `tour_stops`); and the
> placeless intro/outro "brackets" are now **frames persisted to the `asides` table** (see
> `packages/studio/src/pipeline/narrate.ts`). Read every `tours.*`/`tour_*` reference below as the
> corresponding V2 entity.

> **Status:** SPEC ONLY — unbuilt. Generation-only feature; post-MVP, gated behind the proven phone
> player. Decided 2026-06-09. **The keystone** of the charm layer: it organizes the through-line
> (`docs/specs/downtime-callouts-spec.md` is the push side; the through-line is its pull cousin) and
> the skipper's opinions (`docs/specs/skipper-opinions-spec.md`), and it supplies the missing
> *content* for the drive-complete payoff (`docs/ideas/drive-complete-moment.md`).

## 0. TL;DR

- A **thesis** is the skipper's *point of view about the whole route* — the one idea the drive is
  "about" ("this whole drive is really about water — what it carved, who chased it, where it's still
  deciding everything"). The stops stop being a list and become **evidence** for it.
- **Structure:** the **intro bracket plants** the thesis → the **stops are its evidence** (a few nod
  to it) → the **drive-complete payoff lands** it. That arc is the whole feature.
- **It's the keystone, not a fourth feature:** it gives the through-line its *content* (callbacks
  become the thesis recurring, not arbitrary), gives the skipper's taste/opinions a *spine*, and
  gives the payoff beat — which today has none — something specific to *pay off*.
- **Grounding rule:** the thesis is **delivery** (a framing/take) but must be **earned by the
  grounded facts** — never a frame that manufactures a connection the facts don't support.
  **Exhaustion-gated:** if the stops don't honestly share an idea, *don't force one.*
- **Cheap — generation-only.** Reuses the intro/outro frames + the within-tour conditioning
  machinery + the persona; one nullable `thesis` field on the drive entity; no player change.
- **Production:** model proposes candidate theses, **founder blesses** one per corridor (the
  hand-authored-charm-artifact pattern) — a thesis is a *lens* (structure-adjacent), so the words
  stay generated and principle #2 holds.

## 1. Why it's the keystone

A list of charming stops is still a list. A thesis turns a **sequence into a story** — the
difference between a guide who *knows facts* and one who has a *take on the place*. Emerald Bay stops
being stop #4 and becomes *Exhibit C*.

The insight that elevates it above "nice framing": **it's exactly what the drive-complete payoff pays
off.** That payoff beat (`docs/ideas/drive-complete-moment.md`) is roadmapped as motion + sound, but
it has *no content* — it's an emotional landing with nothing specific to say. A thesis is its
destination: *"Forty miles, ten stops, and like I told you at the start — it was always about the
water."* It lands because it was *planted.*

And it's the organizing idea the other charm features were circling:
- **The through-line** (`docs/specs/downtime-callouts-spec.md` and the pull-ladder family) is *how*
  the thesis recurs — callbacks become "there's the water again," not arbitrary "remember the island?"
- **The skipper's opinions/taste** (`docs/specs/skipper-opinions-spec.md`) are the *voice* of the
  thesis — his geology obsession was really just *one possible thesis*. "Cultivate the granite thread"
  generalizes to "cultivate the drive's thesis."
- **The payoff** is *where it lands.*

Build the thesis and these click into place around it; build them without it and they stay local and
arbitrary.

## 2. What a thesis is (and isn't)

- **Is:** a single, *specific*, grounded idea the route genuinely coheres around — water, the people
  who came chasing something, how the granite decides everything, a boom-and-bust arc. The stops are
  its evidence.
- **Isn't:** (a) a *generic* frame ("a journey through history," "the human spirit" — vacuous);
  (b) a *spoiler* ("wait till you see the 1929 castle"); (c) a *script* — it sets the LENS, the model
  still generates every word.
- **A lens, not a leash.** The thesis colors *which* facts a stop leans into and lets it *nod* to the
  through-idea — it never dictates the telling or overrides a stop's own story.

## 3. The grounding rule (the invariant, one altitude up)

> **The thesis is DELIVERY (a framing/take). Its claimed connections must be FACT.**

The skipper can *frame* the drive however his persona likes — but a thesis that asserts a connection
the facts don't support ("the water *caused* the gold rush") is a hallucination wearing a frame. So:
- The thesis must be **derived from the actual collective facts** — "what do these real wells
  *genuinely* share?" — not imposed top-down.
- **Exhaustion-gated**, exactly like the deeper cut (`docs/specs/tell-me-more-spec.md`): if no honest
  thesis emerges, **return none** — a warm, theme-less intro/outro is correct, and *better* than a
  forced one. Not every drive has a thesis, and faking one is the worst outcome.
- A **thesis judge** (reuse the validation-harness judge pattern) gates it: *does the thesis survive
  the stops being its only evidence? Is every connective claim grounded?* If not, weaken or drop it.

## 4. The disciplines ("getting it right")

- **Optional.** §3's exhaustion gate — no genuine thesis → none. Tours without one still get brackets.
- **Restraint.** Bookends + a *few* light per-stop nods — never a drumbeat. "WATER. AGAIN. IT'S ALL
  WATER" is exhausting and reductive; most stops just tell their story. (Same restraint discipline as
  callouts and reveals.)
- **No spoilers.** The intro plants a *lens*, not a *preview* — it must not pre-empt a stop's reveal.

## 5. Production model — model proposes, founder blesses

Pure-generated risks the forced/generic thesis; pure-curated creeps toward scripting the contents. So
the same **hand-authored-charm-artifact** pattern used for the narration prompt and the refusal lines:
1. At generation, the model reads the route's collective fact wells and **proposes 2–3 candidate
   theses**, each with the stops it would lean on as evidence (so the founder can see it's earned).
2. The **founder blesses one** (or none). With few corridors this is cheap, and it's the quality gate
   that keeps theses specific and true.
3. The blessed thesis is **persisted** and re-used on regen (stable, not re-proposed each run).

**Principle #2 is safe:** a thesis is a *lens* — structure-adjacent, like choosing the route or
deciding intro/outro brackets exist. Blessing the lens is fine; the *contents* (every spoken word)
stay generated. The failure to guard is a thesis so prescriptive it dictates the telling — that's
contents-creep; keep it a frame.

## 6. Where it lives (data + generation)

- **A `thesis` field on the drive entity** — a nullable text column (the blessed framing string;
  null when the exhaustion-gate found none). It's a drive-level *input to generation* (like the
  drive's headline/the route), not narration — so it sits on `drives`, not on the `narrations` atom.
  Persisting it makes regen stable. (No `thesis` column exists yet — schema TBD at build time.)
- **Intro/outro frames** (the `asides` table, `docs/specs/tour-structure-spec.md`) carry the
  plant/land — generated *from* the blessed thesis. This is where 90% of the thesis lives.
- **Light stop conditioning:** each stop's narration is *optionally* told the thesis (a nod when
  natural), threaded through the within-tour conditioning the studio pipeline already runs
  (`narrate.ts`'s `priorStops`/motif window — the thesis becomes one more threaded element). This is
  the **bookends-first** refinement (§9) — ship the frames first, add stop-nods later.
- Reuses the persona (`packages/studio/src/persona/`) — the thesis is spoken in the skipper's
  voice; for region skippers it's *his* take (ties the thesis to the region-host identity).

## 7. Cost

Generation-only and cheap: a thesis-proposal step (one model call over the collective wells, at
generation), the bracket generation (already exists), optional light stop conditioning (reuses
existing threading), one nullable `thesis` field on the drive entity. **No player change, no new audio
path** (the thesis rides the frames + stops, which already carry audio). Same weight class as the
through-line.

## 8. Build phases (file-level)

1. **Thesis proposal + bless loop.** A studio pipeline step that reads the route's wells and emits 2–3
   grounded candidate theses (+ their supporting stops) for founder review; persist the blessed one to
   the drive's `thesis` field. Exhaustion-gate (propose *none* when honest). Add the thesis judge
   (validation harness).
2. **Schema:** the nullable `thesis` column on the `drives` entity (`packages/db/src/schema.ts`).
   Clean/destructive.
3. **Frames generate from the thesis** (`narrate.ts` intro/outro): plant in intro, land in outro;
   feeds the drive-complete payoff content. Theme-less fallback when `thesis` is null.
4. **(Refinement) Light stop nods** — thread the drive's `thesis` into stop narration; tune restraint by ear.
5. **Ear-tune:** is the thesis specific + earned, or generic + forced? Does the payoff land? (Founder
   gate — the highest-leverage iteration, like the narration prompt itself.)

## 9. Forks

- **Generated vs curated thesis** → **DECIDED: model-proposes / founder-blesses** (§5).
- **Bookends-only vs lightly-threaded** → **lean bookends-first** (intro + payoff; stops untouched) —
  cheapest, lowest heavy-handedness risk — with light per-stop nods as phase 4. *(Open: how many nods
  before it's a drumbeat — ear-tune.)*
- **One thesis per tour, or per region?** → per *tour* (each route coheres around its own idea), but a
  region's skipper may have a recurring *meta*-lens (his obsession) the per-tour theses rhyme with —
  that's the §1 link to `docs/specs/skipper-opinions-spec.md`, deferred.

## 10. Edge cases

- **No honest thesis** → the drive's `thesis` null; warm theme-less frames; no stop-nods. Correct, common.
- **Regen** → reuses the blessed drive `thesis` (stable), unless facts changed enough to re-propose
  (founder re-blesses).
- **Thin/short tour** → usually no thesis (too little evidence); don't force.
- **Spoiler risk** → the §4 no-spoiler discipline + the judge.

## 11. Provenance

- Designed 2026-06-09 as the keystone unifying the charm layer.
- Lands the payoff: `docs/ideas/drive-complete-moment.md`. Organizes: the through-line
  (`docs/specs/downtime-callouts-spec.md` + the pull ladder) and `docs/specs/skipper-opinions-spec.md`
  (the thesis is taste at drive-altitude). Borrows the **exhaustion gate** from
  `docs/specs/tell-me-more-spec.md`.
- Generation seams: `packages/studio/src/pipeline/narrate.ts` (intro/outro frame gen + the
  proposal step + within-tour conditioning), `packages/studio/src/persona/` (`PersonaDef` — the
  voice), `packages/db/src/schema.ts` (the drive `thesis` field). Narration stays place-owned
  (`docs/decisions/tour-data-model-zero-reuse.md`); the thesis is a drive-level *input*, not cached
  cross-drive content.

**Decisions locked:** the thesis is the keystone (plant → evidence → land); delivery but
fact-earned + exhaustion-gated (no forced theses) + judged; model-proposes/founder-blesses (a lens,
not a script — principle #2 safe); persisted on the drive's `thesis` field; generation-only; bookends-first with
light stop-nods deferred.
