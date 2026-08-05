# The prompt sweep — all 14 prompts under a microscope

> **Status:** ✅ **DONE 2026-08-04.** Every prompt in the repo assessed one at a time against current
> Anthropic guidance and against the live corpus. **5 changed, 9 left alone**, ~$1.20 spent (most of it one
> operator apply). This exists so the sweep is not re-run: each verdict below carries the reason, and the
> "left alone" entries are the point of the document as much as the changes.
> ⚠ **The meta-lesson is at the bottom and is worth more than any single entry.**

## Method

External research first (Anthropic's prompt-engineering docs plus independent literature on few-shot
repetition), then each prompt read in full, then — where possible — its OUTPUT measured against the live
corpus or a crafted probe rather than its prose critiqued. Presented to the founder one prompt at a time
with a change-or-leave recommendation.

## The 14

| # | Prompt | Verdict |
| --- | --- | --- |
| 1 | narration (`persona/skipper.ts`) | **changed** — named 7 linted tics it never mentioned + a parity test |
| 2 | planner (`planner-prompt.ts`) | **reverted** — 4 diverse examples measurably made it worse |
| 3 | grounding judge | left alone |
| 4 | enrichment scout | left alone |
| 5 | planner persona judge | **changed** — added the missing truncation check |
| 6 | studio charm judge | **changed** — `biggestRisk` was required, so it invented risks |
| 7 | veracity judge | **changed** — added an untrusted-content policy for web results |
| 8 | excision repair | **changed** — it stranded punchlines whose fact it cut |
| 9 | classify-treatments | left alone + a protective comment |
| 10 | `draftSystem` (allowlist) | left alone + pinned its two copies |
| 11 | classify-register | left alone — but it reached only 58% of the corpus (**fixed in the CLI**) |
| 12 | TTS delivery style | left alone — ear-gated, and its blast radius just went 6× |
| 13 | job-log summarizer | left alone + dropped one misleading field hint |
| 14 | b-side deeper cut | left alone — the item blocking it was a misquote |

## What the changes were

- **Narration (`dd36d94`)** — the deterministic lint bans 15 tics; the prose named 8. That exact gap
  (9 banned by regex, 3 named in prose) is the documented cause of **148 of 457 released clips** shipping a
  "here's the …" wind-up: *"the model avoided the three it was told about and wrote the rest."* Seven were
  still unnamed. A test now asks the lint's own table, so adding a pattern fails until the prompt says it.
- **Persona judge (`379a278`)** — four model calls in the repo branch on `stop_reason`; this one never did.
  A truncated verdict scores the run on the turns that survived, which reads as a *better* run.
- **Charm judge (`142080c`)** — `biggestRisk` was required, so a run it scored 8-and-9 with "ship" still
  produced *"could tip from showman into smug op-ed."* Made optional; scores unchanged, output 25% shorter.
- **Veracity (`d8b7996`)** — the only prompt that reads the open web had no policy for treating retrieved
  content as data. Low severity (advisory), adopted from Anthropic's documented pattern, unverifiable cheaply.
- **Excision (`fa46ba0`)** — probed first: it cut a fact and left the pun that rode it pointing at nothing.
  **The re-gate cannot catch that** — a stranded punchline asserts nothing false. One rule; verified for 2¢.

## Two changes that were reverted or refused, and why they matter more

**Prompt 2 is the cautionary one (`6459501`).** Anthropic recommends 3–5 diverse examples and the
literature agrees diversity cures repetition; the planner had one. I added three. Result: **discipline gate
PASS → FAIL** (an example reused a line the prose already quoted, and the model recited it verbatim) and
**persona 0.66 → 0.61 with flagged turns 3 → 12**, seven of them draw turns scored 4/10 "bare echo" —
because three of four examples ended on a bare restatement. *I diversified the asks and standardised the
draw.* The lesson: **a worked exchange teaches every beat it contains, not the one you added it for.**

**Prompt 1 nearly went the wrong way.** I proposed cutting a five-item phrase blacklist as
doctrine-violating, and it was approved on my reasoning — then the history showed that list *is* the
remediation for the 148-clip failure. Cutting it would have recreated a third-of-corpus defect right before
a paid regeneration.

## Five stated problems that dissolved on inspection

Each had a different cause, which is why none of them generalises to "assume it's fine":

1. **The phrase blacklist** — I misread a remediation as a failure. History settled it.
2. **Required fields biasing classify-treatments** — defused by **property order**: `treatment` is emitted
   before the fields that could pull it. The repo had already measured that tool input serialises in order.
3. **Long-context ordering** (data above instructions) — applies above ~20k tokens; the prompts that could
   qualify already do it, and the ones that don't are far below the threshold.
4. **The grounding judge's lack of examples** — the consistency problem examples would address is already
   solved by **union-voting k samples**, which attacks stochasticity rather than calibration.
5. **The b-side's "contradiction"** — the backlog misquoted the prompt. It bans a *stock* opening and
   explicitly grants *"one warm beat that lands as 'since you asked'."* Nothing to resolve.

## The findings that were not in the prompts at all

The two most valuable results came from measuring output, and neither was a prompt defect:

- **42% of audible clips had no delivery register** (309 of 730), every one scenic and un-enriched, because
  the classifier required enrichment and scenic stops are never enriched. The `landscape` read — *"give it a
  little more air"* — is written for exactly those stops and was the one thing they never got. Fixed in the
  CLI (`fd56294`); applied for $0.56; landscape went **9.3% → 50.7%** of audible clips.
- ⚠ **Which makes prompt 12 urgent in a way it wasn't this morning.** The landscape suffix has been heard on
  roughly 61 clips and will govern ~370 on the next regeneration, while also shortening them (60s aim vs
  90s). **Ear-check it before the next regen** — that is the gate its own comment demands.

## The meta-lesson

**Measuring beat reading, decisively.** Of five changes, four came from measuring output or probing
behaviour; both changes proposed from reading prose alone were reverted. And **the repo's own dated comments
outranked the external guidance every time the two disagreed** — on example counts, on a deliberately coarse
detector, on prohibition-versus-structure. The guidance is right in general and this repo has already paid
for the exceptions.

Three patterns worth reusing:

- **A required output field manufactures content.** A judge forced to name a risk invents one; the fix is
  optionality, not better wording. Check every `required` list for fields that are meaningless on a clean run.
- **Structure beats prohibition** in low-input forms — *"Assigned, not BANNED"*
  ([scenic-stops-spec §11.8](../designs/scenic-stops-spec.md)). It resolved the b-side item and is why the
  narration tics were left alone rather than expanded into a longer list.
- **Probe before you edit.** Two 1-cent probes settled questions that would otherwise have been argued: one
  proved a real defect (excision), one refuted a predicted one (the cost field). Both were cheaper than
  being wrong.
