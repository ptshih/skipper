# External research: judge bias and prompt optimisation

> **Status:** 📚 **REFERENCE, 2026-08-04.** A second external pass after the
> [prompt sweep](../decisions/prompt-sweep-2026-08-04.md), deliberately aimed at what that pass did NOT
> cover. **Nothing here is a commitment.** It produced one confirmed structural finding, one hypothesis
> that would reframe a complaint we already acted on, and three avenues closed off. Both live items are
> settleable for cents — see "The two experiments".

## Why a second pass

The sweep's research covered prompt *construction* (reasons attached to prohibitions, example counts,
long-context ordering, XML structure, untrusted-content policy). It never asked about the **judges as
instruments** — and this repo has five of them, one of which is fail-closed and gates what ships. The
literature on LLM-as-a-judge is where the unexamined risk was.

## ⚠ Finding 1 — every studio judge is the model that wrote the text it judges

Confirmed in code, not inferred:

```
NARRATION_MODEL = CLAUDE_MODELS.opus   → claude-opus-4-8
JUDGMENT_MODEL  = CLAUDE_MODELS.opus   → claude-opus-4-8   ← charm, and…
GROUNDING_MODEL = JUDGMENT_MODEL       → claude-opus-4-8   ← the FAIL-CLOSED gate
```

`eval/excise.ts` uses `NARRATION_MODEL` too, deliberately ("same model that wrote it, so the voice stays
consistent"). The one judge that escapes is the planner's persona judge — Opus 4.8 judging Opus 5 output —
and that is **accidental**, a side effect of the planner being pinned to a newer model.

**Self-preference bias** — models rating their own output more favourably — is measured and characterised in
the literature ([Panickssery et al.](https://arxiv.org/pdf/2410.21819)). The load-bearing detail for us:
**it is not strongly correlated with judge capability**, so "use a better judge" is not a mitigation. A
*different* model is.

⚠ **Severity is not uniform across our judges, and the difference matters:**

- **Charm is the exposed one.** It is a pure taste judgment on prose the same model produced, which is
  exactly the setting the bias was measured in.
- **Grounding is far less exposed**, and this is worth writing down so nobody panics about the gate: it is
  a *verifiable* check — does this claim trace to the sheet printed directly above it? A model cannot
  prefer its way into a claim being supported when the source is in the context window. The bias literature
  concerns preference judgments, not source-checking.
- **Excise is an editor, not a judge**, and its output is re-gated. Same-model there is a feature.

⚠ **Nobody chose this.** `models.ts` records that narration ran on Fable 5 until it became unavailable
account-wide, at which point it fell back to Opus 4.8 — which is also the judgment tier. The constants were
kept separate on purpose so they could diverge again. So divergence is a one-line change; the cost is that
the judge rubrics were *"calibrated against Opus-tier judging"* and moving one means re-running
`eval/calibrate.ts`.

## ⚠ Finding 2 — verbosity bias exists in POINTWISE settings, which reframes the "flat middle"

The assumption worth killing: that verbosity bias is a pairwise-comparison artefact. It is **"observed in
both pairwise and pointwise settings"**, with length-controlled win rates proposed as a post-hoc
correction ([Judging the Judges](https://arxiv.org/html/2604.23178v2)).

Our judges are pointwise 1–10. And on 2026-08-04 the planner's persona judge scored terse draw turns
**4/10, "Bare echo"**, repeatedly, across three runs — the complaint that drove a prompt change which then
had to be reverted.

Two facts now sit side by side:

1. The judge's rubric has **no band for "correctly terse"** — band 3–4 is *"competent and flat… the man is
   not in the room"*, so a one-line confirmation cannot score above 4 however well written (found
   independently during the sweep).
2. Pointwise verbosity bias is a documented phenomenon.

Which means **part of the flat-middle signal may be length rather than quality** — and we already paid for
acting on it once. This is the single most valuable open question from either research pass.

## Three avenues closed off

- **Prefilling the assistant turn** to force output shape: superseded. The docs now carry a *"Migrating
  away from prefilled responses"* section pointing at Structured Outputs instead. Not an avenue.
- **`output_config.format: json_schema`** exists as a first-class JSON-output path separate from tool use.
  Our judges all use forced tool use, which works; `strict: true` was already assessed during the sweep as a
  partial win with a first-request latency cost. No reason to move.
- **Extended thinking instead of k-sample union voting** on the grounding gate: attractive on cost (k× Opus
  calls → thinking tokens) but the literature offers **no comparative data**, so it is an experiment rather
  than a known win. Meanwhile self-consistency sampling — which is what union-voting is — is the
  well-established test-time reliability strategy ([Wang et al.](https://arxiv.org/pdf/2203.11171)), so the
  current design is on solid ground. ⚠ The research direction there is *adaptive stopping*, which does
  **not** transfer cleanly: our rule is UNION ("any sample flags it"), not majority, so a clean early
  sample cannot license stopping — the later samples exist precisely to find what it missed.

## The two experiments

Both are cents, and each settles a question rather than adding a mitigation on faith.

1. **Length probe on the persona judge (~2¢).** Score the same draw turn twice: once terse, once padded to
   roughly double the length **without adding character** (filler, not voice). If the padded version scores
   materially higher, verbosity bias is present and the flat-middle complaint is partly artefactual — and
   the fix is a rubric band for correct brevity, not a prompt change to the Skipper.
2. **Cross-model probe on the charm judge (~5¢).** Score the same clips with `JUDGMENT_MODEL` and with a
   different family (Sonnet 4.6). A materially *lower* score from the outside model is the signature of
   self-preference. ⚠ Confounded by capability — a weaker judge may score differently for unrelated
   reasons — so read a *large* gap as signal and a small one as inconclusive.

⚠ **Do not "fix" either bias before measuring it.** The sweep's own record concludes that both changes
proposed from reading rather than measuring had to be reverted, and a mitigation for a bias this repo does
not actually exhibit would cost a re-calibration for nothing.

## ✅ Both probes RUN, 2026-08-04 — and neither bias is present

Total ~7¢. The founder bumped `CLAUDE_MODELS.opus` 4.8 → 5 immediately before, which handed probe 2 a
cleaner design than the one proposed above.

**Probe 2 — self-preference: NO evidence.** The bump made the experiment free. The two sample clips were
written by Opus **4.8**; this morning's baseline had Opus **4.8** judging them, which is the *self*
condition (8 and 9, overall 8, "ship"). Re-scored by Opus **5** — the *cross* condition on identical text —
they came back **8 and 8, overall 8, "ship"**. A one-point drop on one clip is noise for a stochastic
judge, so the flattery effect is not visible here.
⚠ n=1 per model, and 4.8→5 is a capability change as well as an identity change, so this rules the effect
*out* only weakly. It is enough to stop treating it as an open risk; it is not enough to prove absence.
⚠ Incidental: Opus 5 volunteered a `biggestRisk` where 4.8 omitted one — *"Both stops land the same way — a
dry one-line zinger as the closer"* — which is a real pattern in those two clips. That reads as the
now-optional field being used correctly rather than as the sweep's charm-judge fix regressing.

**Probe 1 — verbosity: NO bias, and the sags overturned the premise.** A padded variant (2.4× the words,
no groaner, no image, no new information — filler only) scored **4/10** against the terse original's
**3/10**. Within noise. But the judge's reasoning is the actual result:

- It **named the padding as padding**: *"'start to finish, just the way you asked for it' is padding with a
  service-desk cadence."* It was not fooled by length, which is stronger than the +1 suggests.
- Its complaint about the terse version was **not brevity**: *"A verbatim repeat of the prior turn's first
  line with nothing added… This was the free square — one dry send-off line and the whole exchange lands."*
  Both variants were flagged `canned: true`.

⚠ **So the "flat middle" is a REPETITION finding, not a length one.** The draw turn scores low because it
restates the read-back's sentence verbatim — and the planner prompt already carries the rules that would
prevent it (*"If a phrasing has already been used once in this conversation, it is the one to skip"*, and
once a plan is settled *"say back only the part that CHANGED"*). They are simply not landing on that turn.
⚠ **That is NOT a licence to add a rule.** Two changes made from exactly this kind of reading were reverted
on 2026-08-04, and the judge's own prescription ("one dry send-off line") is a taste instruction whose
failure mode is a quip on every turn. The honest next step is a targeted eval arm, not an edit.

## Sources

- [Self-Preference Bias in LLM-as-a-Judge](https://arxiv.org/pdf/2410.21819)
- [Judging the Judges: A Systematic Evaluation of Bias Mitigation Strategies in LLM-as-a-Judge Pipelines](https://arxiv.org/html/2604.23178v2)
- [LLM-Judge Bias Mitigation (2026): Detect, Measure, Fix](https://futureagi.com/blog/evaluating-llm-judge-bias-mitigation-2026/)
- [Self-Consistency Improves Chain of Thought Reasoning](https://arxiv.org/pdf/2203.11171)
- [Claude prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices)
  · [Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
  · [Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
