// Skipper narration — the Anthropic (claude-opus-4-8) call.
//
// The SYSTEM message is the static, hardened SKIPPER_SYSTEM_PROMPT. For each stop
// we send ONE user message: the grounded FACT SHEET plus the region/corridor
// and stop type. The model returns ONLY the words the Skipper says.
//
// Grounding is the cardinal invariant: persona lives in DELIVERY, never in FACTS.
// So the only place-facts that reach the model are the ones we put on the sheet
// (story stops). Scenic and break stops carry NO place-facts by construction —
// naming a peak/town/business is itself a fact the model was not given.
//
// Model constraints (Opus 4.8): adaptive thinking only — NO temperature / top_p /
// top_k / budget_tokens (all 400). We pass adaptive below. Output is modest (a story stop now targets a
// Shaka-length ~2 min telling, ~300 spoken words ≈ ~450 output tokens), so a single
// non-streaming messages.create is right; max_tokens is generous because adaptive
// thinking tokens count against it AND a long-form grounded telling reasons harder.
// A refusal or a max_tokens truncation is a HARD failure — we never persist a
// truncated or empty script (quality invariant), so size for the worst case.

import Anthropic from '@anthropic-ai/sdk'
import type { StopType } from '@skipper/shared'
import { getAnthropic, NARRATION_MODEL } from '../models'
import { recordModelUsage } from '@skipper/shared'
import { WORDS_PER_SECOND } from '../config'

/**
 * Generous ceiling. A long-form story script (~2 min ≈ ~300 words ≈ ~450 output
 * tokens) leaves the rest as adaptive-thinking headroom — and high-effort thinking
 * on a rich, grounded fact sheet can be substantial. A truncation throws (we never
 * persist a half script), so we size well above the worst plausible thinking+output.
 */
const NARRATION_MAX_TOKENS = 16000

export interface NarrationRequest {
  /** e.g. "Lake Tahoe". Naming the region is allowed without the sheet — it's STABLE for every drive
   *  that reuses the clip. */
  region: string
  /** OPTIONAL named stretch, e.g. "Emerald Bay Run". OMITTED for the shared atom (the narration
   *  corpus): the same telling rides ANY route through the place, so it can't bake one corridor. ⚠ No
   *  production caller passes this today — it is held for the DEFERRED authored-tour path, where a
   *  GIVEN corridor is sayable without the sheet. */
  corridor?: string
  stopType: StopType
  /** Required for STORY and BREAK (the curated, stable name + kind). OPTIONAL for SCENIC: a
   *  NAMED natural feature (a bay/beach) — its name + kind are sayable like a break's, no facts. */
  place?: { name: string; kind?: string | null }
  /** Grounded fact lines (STORY only). The entire well of facts the model may use. */
  facts?: string[]
  /**
   * Which of `facts` are REGIONAL BOILERPLATE, and how many OTHER places carry the identical line.
   * Keyed by the exact fact text; absent/empty means "nothing shared", which is the old behaviour.
   *
   * ⚠ The model cannot possibly know this on its own, and that is the whole bug. One Macrostrat map
   * unit hands 24 Tahoe POIs the byte-identical pair "the bedrock at this spot is undivided granitic
   * rocks…" / "Late Cretaceous — roughly 66 to 101 million years old", and from inside a single call
   * that is simply a good, vivid, specific fact — so the model leads with it, 24 times. Measured, the
   * carriers are NOT thin cards (most have 3-5 other facts), so this is not "it had nothing else to
   * say"; it is a choice made without the one piece of context that would change it.
   *
   * Marking beats gating: dropping the fact would lose a true and interesting thing from the one clip
   * where a rider meets it first, and any "only the first N places may mention it" rule has to pick
   * arbitrarily which peak gets the good line.
   */
  sharedFacts?: Readonly<Record<string, number>>
  /**
   * Coordinate-keyed geology facts (the rock underfoot). Grounded like `facts`; allowed on STORY and SCENIC.
   *
   * ⚠ NOTHING SETS THIS ON ANY LIVE PATH (verified 2026-07-30: the only two `narrateStop` callers are
   * generate-narrations and generate-cluster-narrations, and neither passes it). V2 enrichment folds
   * macrostrat sentences into `facts` as ordinary sheet bullets instead, so `geologyLines` below —
   * including its careful "do not close on the rock / no deep-time reflection" cues — never fires.
   * That is why the geology monotony it was written to prevent happened anyway. Kept because an
   * authored-tour path may want the separate channel; do not trust it as live coverage.
   */
  geology?: string[]
  /** STORY only: co-located landmarks merged into this stop — each {name, facts}. Grounded;
   *  the narrator may name them and weave them into ONE telling of the place.
   *
   *  `background: true` marks a place whose facts are grounded but which is NOT worth naming — the
   *  FUSED-cluster case, where a group of nine has five a driver would recognise and four that are
   *  only texture. ⚠ Not cosmetic: measured on the first fused telling, with every member equally
   *  nameable the model chose by FACT RICHNESS and opened on a dropped supper club's 1930s dinner
   *  menu while never naming three of the five places the group is named for. Default (absent) is
   *  nameable, so the poi path is unchanged. */
  mergedFeatures?: { name: string; facts: string[]; background?: boolean }[]
  // ⚠ THE WITHIN-SEQUENCE CONDITIONING WINDOW — DECLARED AND RENDERED, BUT NOTHING SETS IT.
  //   No production caller (and no test) passes any of the four below, so these branches have never
  //   fired on a shipped clip; the corpus generator narrates each POI in a VACUUM, and the ONLY live
  //   cross-clip variety mechanism is the diversity lint → `avoid` (pipeline/lint.ts, whose header
  //   carries the long version of this warning). Do NOT read them as an upstream repetition damper.
  //   KEPT, not swept, for two reasons of record: docs/decisions/cut-wave-form.md cites this exact
  //   unwired state as the evidence for "monotony in a low-input form is STRUCTURAL", and
  //   docs/designs/drive-thesis-spec.md (SPEC ONLY, post-MVP) builds its stop-conditioning on this
  //   window. Wiring or deleting them is a founder call, not a cleanup.
  /** Short reminders of earlier stops, for earned callbacks. ⚠ Unwired (above) — and today it would
   *  CONTRADICT `selfContained`, which forbids callbacks outright. */
  priorStops?: string[]
  /** How the last few stops OPENED — so this stop can open differently. ⚠ Unwired (above). */
  recentOpeners?: string[]
  /** How the last few stops CLOSED — so this stop can close differently. ⚠ Unwired (above). */
  recentClosers?: string[]
  /** Recurring frames / self-deprecation flavors already spent, cumulatively — one-time bits, never
   *  reuse. ⚠ Unwired (above); there is no "this drive" at corpus-generation time to accumulate over. */
  recentMotifs?: string[]
  /** Pacing target; honored but never padded past the facts. */
  targetSeconds?: number
  /** Hard upper cap on spoken length (s). A fact-rich place must not sprawl into a lecture; this
   *  only ever SHORTENS, so it composes with "never pad" (targetSeconds = the aim, this = the
   *  ceiling). Omit for a single-point target. */
  maxSeconds?: number
  /** Re-narration notes from the diversity lint — concrete things THIS take must avoid. */
  avoid?: string[]
  /** SHARED-ATOM framing (generate-narrations.ts): this telling is the place's ONE narration, reused
   *  mid-drive by EVERY route that reaches the place, at any position in the order. Adds the
   *  self-contained block to the sheet (route-agnostic, no order, no baked laterality, no tour shape);
   *  all grounding rules are unchanged. */
  selfContained?: boolean
}

export interface NarrationResult {
  script: string
  stopReason: string | null
  usage: { inputTokens: number; outputTokens: number }
}

/**
 * The GEOLOGY block — coordinate-keyed bedrock facts (Macrostrat). These ARE on the
 * sheet, so they are sayable like any other fact (this is what makes "this point is
 * granite" grounded instead of invented). Allowed on STORY and, uniquely among fact
 * categories, on SCENIC — the rock underfoot is plainly there, names no landmark, and
 * is the one true thing an otherwise-factless stop may speak.
 */
function geologyLines(
  geology: string[] | undefined,
  stopType: StopType,
  namedScenic = false,
): string[] {
  const geo = (geology ?? []).map((g) => g.trim()).filter(Boolean)
  if (geo.length === 0) return []
  const out: string[] = [
    '',
    'GEOLOGY UNDERFOOT (grounded, from geologic maps — the rock you are driving through; treat these as facts on the sheet, sayable like any other):',
  ]
  for (const g of geo) out.push(`- ${g}`)
  if (stopType === 'scenic') {
    out.push(
      namedScenic
        ? '(On a SCENIC stop this is the ONE extra fact you may state. Beyond the named feature on your sheet you still name no OTHER peak, town, or island — only this feature, the rock, and its rough age, exactly as given. Invent nothing beyond these lines; speak the age as the rough range it is.)'
        : '(On a SCENIC stop this is the ONE thing you may state as fact. You still name no peak, town, island, or landmark — only the rock and its rough age, exactly as given. Invent nothing beyond these lines; speak the age as the rough range it is.)',
    )
  } else {
    // The STORY case: supporting texture. The cue asserts nothing about the sheet's
    // thinness — the enrichment scout may attach supporting geology to a rich telling too,
    // and a "you're light on facts" premise would then be false. Same two bans, to kill the
    // monotony seen when every stop got geology.
    out.push(
      '(The rock here is good supporting material — work a little of it in where it fits, in your own words. Two rules: do NOT make it your closing line, and do NOT reach for the "deep time versus our brief human lives" reflection — that frame gets old fast. Land it mid-telling and end the stop on something else.)',
    )
  }
  return out
}

/**
 * The ALSO-AT-THIS-STOP block — landmarks that sit right here with the main place (folded in
 * from the co-located cluster). Each is grounded by its own facts, so the narrator MAY name it
 * and weave it in — the whole point is to cover the highlight (e.g. Emerald Bay AND its castle,
 * island, and falls) as ONE flowing telling, not several stops. Same grounding rule: only what
 * is listed here is known.
 */
type MergedFeature = { name: string; facts: string[]; background?: boolean }

/**
 * The merged features a telling may actually NAME: entries carrying both a name and facts, minus the
 * ones the classifier demoted to background.
 *
 * ⚠ BOTH closer rules key on THIS count, never on the raw array — that mismatch was a live bug. The
 * fused closer fired at `named.length >= 2` (post-filter) while the single-subject closer was
 * suppressed by `req.mergedFeatures?.length` (RAW), so any sheet in between — exactly one nameable
 * feature, one nameable plus background, all background, or entries that all filter out — got NEITHER
 * closing rule. That window is live on the fused path (a cluster whose tellable set narrows to one
 * member), and it is precisely the defect the two rules exist to close: their absence was MEASURED at
 * 21% tail collapse on single-place clips and 35% on fused ones, up to 14.4 dB under the body. A
 * collapsed tail is also not free — it drives the synth retake loop, which bills per take.
 */
function nameableFeatures(features: MergedFeature[] | undefined): MergedFeature[] {
  return (features ?? []).filter((f) => f.name && f.facts.length > 0 && !f.background)
}

function mergedFeatureLines(features: MergedFeature[] | undefined): string[] {
  const fs = (features ?? []).filter((f) => f.name && f.facts.length > 0)
  if (fs.length === 0) return []
  const named = nameableFeatures(features)
  const background = fs.filter((f) => f.background)
  const out: string[] = []
  const bullets = (list: typeof fs) => {
    for (const f of list) {
      out.push(`• ${f.name}:`)
      for (const fact of f.facts) out.push(`    - ${fact}`)
    }
  }

  if (named.length > 0) {
    out.push('')
    out.push(
      background.length > 0
        ? 'ALSO RIGHT HERE — the landmarks a driver would RECOGNISE. Name each of these (grounded; weave them into ONE telling of this place, not separate asides — only what is listed is known):'
        : 'ALSO RIGHT HERE — landmarks at this same stop (grounded; you MAY name each and weave them into ONE telling of this place, not separate asides — only what is listed is known):',
    )
    bullets(named)
    out.push(
      background.length > 0
        ? '(These are what the stop is FOR — work every one of them in, in one flowing pass. Invent nothing beyond their facts above.)'
        : '(Cover these as part of the SAME stop — the place plus its notable features — in one flowing pass. Name them freely; invent nothing beyond their facts above.)',
    )
    // ⚠ CLOSER SHAPE — the fix for a MEASURED defect, not a style preference. Across the first 31
    // fused clips, 11 (35%) tail-collapsed against ~2% on single-place clips, at up to 14.4 dB below
    // the body. All three retakes collapse identically, which means the SCRIPT determines it rather
    // than the sampler: a many-subject telling reaches for a summarising sign-off, and a verbless
    // tally ("four towers, a mountain of stories") is a falling-intonation fragment with nothing for
    // the voice to land on. Scoped to the multi-subject block on purpose — the delivery prompt's
    // anti-fade clause is already maximal and ear-locked, and single-place clips do not have this
    // problem, so they must not inherit the rule.
    if (named.length >= 2) {
      out.push(
        '(END ON ONE OF THEM — a full sentence about a single place, the last thing you would leave a friend with. Not a tally of everything you just named: a closing fragment that lists them back has nothing to land on, and it dies in the mouth.)',
      )
    }
  }

  // The asymmetry fused generation needs: grounded, but not the subject. Stated as PROPORTION rather
  // than a naming ban, because most facts are intrinsically about their own place — an outright ban
  // would make them unusable, which is the same as dropping them from the well.
  if (background.length > 0) {
    out.push('')
    out.push(
      'BACKGROUND ONLY — also at this stop, but not what a driver came for. These facts are grounded and you may draw on them for context or colour. Do NOT open on one, do NOT let one become the subject of the telling, and prefer not to name them at all:',
    )
    bullets(background)
  }
  return out
}

/** Build the per-stop USER fact sheet, matching the system prompt's "Reading the fact sheet" contract. */
export function buildFactSheet(req: NarrationRequest): string {
  const lines: string[] = []
  lines.push(`REGION: ${req.region}`)
  // Only when a named stretch is actually given (the deferred authored-tour path). The shared atom
  // omits it — the same telling rides any route, so it must not name a specific corridor/drive.
  if (req.corridor) lines.push(`CORRIDOR: ${req.corridor}`)
  lines.push(`STOP TYPE: ${req.stopType.toUpperCase()}`)
  lines.push('')

  if (req.stopType === 'story') {
    lines.push(`PLACE: ${req.place?.name ?? '(unnamed)'}`)
    if (req.place?.kind) lines.push(`KIND: ${req.place.kind}`)
    lines.push('')
    const facts = (req.facts ?? []).map((f) => f.trim()).filter(Boolean)
    if (facts.length > 0) {
      lines.push(
        'FACT SHEET (the entire well of facts you may draw from — if it is not here, you do not know it):',
      )
      const shared = req.sharedFacts ?? {}
      let anyShared = false
      for (const f of facts) {
        const others = shared[f] ?? 0
        if (others > 0) {
          anyShared = true
          lines.push(`- ${f}  [SHARED — ${others} other places near here carry this exact line]`)
        } else {
          lines.push(`- ${f}`)
        }
      }
      if (anyShared) {
        lines.push(
          '(A line marked SHARED is REGIONAL character, not this place\'s story — the identical sentence sits on many other sheets around here, so a rider meets it again and again. You may still use one, but keep it to a clause in the middle, never open on it, never close on it, and never spend your one groaner on it. Lead with whatever is TRUE OF THIS PLACE ALONE.)',
        )
      }
    } else {
      // STORY requested but nothing groundable arrived: the system prompt tells the
      // Skipper to treat this as a scenic moment rather than invent a story.
      lines.push(
        'FACT SHEET: (none — no real facts available. Treat this as a scenic moment; do not invent a story.)',
      )
    }
    for (const l of geologyLines(req.geology, 'story')) lines.push(l)
    for (const l of mergedFeatureLines(req.mergedFeatures)) lines.push(l)
    // ⚠ CLOSER SHAPE for a SINGLE-SUBJECT telling — added 2026-07-30 for a MEASURED regression, and
    // it deliberately reverses the scoping note on the fused rule above ("single-place clips do not
    // have this problem, so they must not inherit the rule"). That was true when it was written, at
    // ~2%. It stopped being true the moment the persona prompt's "here's the …" ban was widened from
    // three completions to the whole family: regenerating 72 clips took tail collapse from 2 of 125
    // rows to 15 of 72 (21%), on THE SAME PLACES. The construction the model used to run up to its
    // payoff was gone, so it landed on a quiet aside instead — "Not bad company.", "This one just
    // earns the view." — and the voice has nothing to put weight on.
    //
    // ⚠ This must NOT kill the deflate. "The grand build, then the deflate" is the Skipper's signature
    // move and the system prompt teaches it; the defect is a closer with no PREDICATE to land on, not
    // a closer that is wry. So the rule asks for a full sentence, not for a bigger finish.
    //
    // Scoped to the single-subject case because the fused block above already carries its own version
    // — which it only emits at TWO OR MORE nameable features, so this must be the exact complement of
    // that condition (`nameableFeatures`), not a raw-array check. Between the two lay a window where a
    // story sheet carried no closing-shape rule at all. Every story sheet now carries exactly one.
    if (nameableFeatures(req.mergedFeatures).length < 2) {
      lines.push('')
      lines.push(
        '(END ON A FULL SENTENCE — subject and verb, said flat and sure, the last thing you would leave a friend with as the car pulls away. Your deflate still belongs here; just give it something to stand on. A closing FRAGMENT ("Not bad company.", "A house furnished by half a state.") reads as an afterthought and dies in the mouth — the voice drops away and the rider loses the line entirely over road noise.)',
      )
    }
  } else if (req.stopType === 'scenic') {
    const namedScenic = Boolean(req.place?.name)
    if (namedScenic) {
      lines.push(`PLACE: ${req.place!.name}`)
      if (req.place!.kind) lines.push(`KIND: ${req.place!.kind}`)
      lines.push('')
      lines.push(
        'SCENIC stop, NAMED — a natural feature you are passing. You MAY name the PLACE above and say',
      )
      lines.push(
        'what KIND it is (a bay, a beach, a cove — plainly), and which side it is on. That is ALL the',
      )
      lines.push(
        'name buys you: no history, no how it got its name, no size/depth/temperature, no "famous",',
      )
      lines.push(
        '"popular", "hidden gem", or "local favorite", no who owns it, no events. Naming it is not',
      )
      lines.push(
        'license to assert what the name implies, and you cannot see THIS feature, so do not hand it a',
      )
      lines.push(
        "specific (its sand, its boulders, its crowds): the water's general blue and the light are",
      )
      lines.push(
        "everyone's to see; this named feature's particulars are not. Name it, gesture at it, react to the",
      )
      lines.push('plain look of the water and sky in your own voice, and stop — a glance, not a story.')
    } else {
      lines.push(
        'SCENIC stop — delivery only, NO place-facts. Point only at what is plainly, visibly there',
      )
      lines.push(
        '(light, water color, sky, the road). Do not name any peak, town, island, or landmark.',
      )
    }
    for (const l of geologyLines(req.geology, 'scenic', namedScenic)) lines.push(l)
  } else {
    // break — the curated name + kind ARE given and sayable; everything volatile is not.
    lines.push(`PLACE: ${req.place?.name ?? '(unnamed)'}`)
    if (req.place?.kind) lines.push(`KIND: ${req.place.kind}`)
    lines.push('')
    lines.push(
      'BREAK stop — a rest/food spot is coming up. You MAY name the PLACE above and say what KIND',
    )
    lines.push(
      'it is (plainly). You may NOT add anything else about THIS spot — no hours, prices, rating,',
    )
    lines.push(
      'popularity, menu, quality, character adjectives (cozy/charming/little/family-run), or physical',
    )
    lines.push(
      'features (where it sits, its deck, its view). Naming it is not license to assert what the name',
    )
    lines.push(
      'describes (a Lakeview Café gets no view). Name it, give a generic invitation (pull over, stretch,',
    )
    lines.push(
      'fuel, a bite), and stop there. Live details resolved fresh at tour-load. No side of the road.',
    )
  }

  if (req.selfContained) {
    lines.push('')
    lines.push(
      'SELF-CONTAINED PLACE TELLING — this is ONE place\'s telling, and it is the SHARED ATOM: the very same clip plays on its own when a rider rolls past this spot, AND is reused mid-drive on a planned route, in an order you cannot predict. So it has to stand completely on its own, every time, in either mode — no welcome-aboard, no tour framing, no "next stop" or "later on this drive", no promising anything else, no callbacks to other places; you never know what came before or after, or whether there is a before or after at all. You also do NOT know the direction of travel or which side of the road the place is on — never name a side, never say "behind us" or "up ahead on the left"; "coming up", "just out there", and "right about here" are fine. Open on the place or its best fact, land your best bit, and get out clean — honor the target length below, and never a chapter.',
    )
  }

  if (req.priorStops && req.priorStops.length > 0) {
    lines.push('')
    lines.push('EARLIER STOPS (for earned callbacks only — never a fact you were not given):')
    for (const p of req.priorStops) lines.push(`- ${p}`)
  }

  if (req.recentOpeners && req.recentOpeners.length > 0) {
    lines.push('')
    lines.push(
      'YOUR LAST FEW OPENERS (do NOT begin like any of these — open this stop a different way):',
    )
    for (const o of req.recentOpeners) lines.push(`- "${o}..."`)
  }

  if (req.recentClosers && req.recentClosers.length > 0) {
    lines.push('')
    lines.push(
      'YOUR LAST FEW CLOSINGS (do NOT end like any of these — close this stop a different way):',
    )
    for (const c of req.recentClosers) lines.push(`- "...${c}"`)
  }

  if (req.recentMotifs && req.recentMotifs.length > 0) {
    lines.push('')
    lines.push(
      'BITS ALREADY SPENT ON THIS DRIVE (a worn frame or a self-deprecation flavor an earlier stop used — each is a ONE-TIME bit; do NOT reach for any of these again, even reworded. If your facts hand you one of these, state the fact plainly and find your joke elsewhere, or skip the joke):',
    )
    for (const m of req.recentMotifs) lines.push(`- ${m}`)
  }

  if (req.targetSeconds && req.targetSeconds > 0) {
    const words = Math.round(req.targetSeconds * WORDS_PER_SECOND)
    lines.push('')
    if (req.maxSeconds && req.maxSeconds > req.targetSeconds) {
      const maxWords = Math.round(req.maxSeconds * WORDS_PER_SECOND)
      lines.push(
        `TARGET LENGTH: aim for about ${req.targetSeconds} seconds read aloud (~${words} words), and NEVER exceed ${req.maxSeconds} seconds (~${maxWords} words) — once the facts are spent, stop. A shorter, fully-grounded telling beats a stretched one; never pad past the facts to reach the aim.`,
      )
    } else {
      lines.push(
        `TARGET LENGTH: about ${req.targetSeconds} seconds read aloud (~${words} words). Honor it, but never pad past the facts.`,
      )
    }
  }

  if (req.avoid && req.avoid.length > 0) {
    lines.push('')
    lines.push(
      'REVISION NOTES — this is a re-narration to break up tour-wide repetition. Same facts, fresh take. You MUST:',
    )
    for (const a of req.avoid) lines.push(`- ${a}`)
  }

  return lines.join('\n')
}

/**
 * Shared narration call — a system prompt + ONE user message → the script. Throws on
 * refusal, truncation, or empty output (callers must NEVER persist a bad script). The
 * system prompt is cached (cache_control) so a run's later calls read it cheaply.
 */
async function runNarration(
  system: string,
  userMessage: string,
  label: string,
): Promise<NarrationResult> {
  const client = getAnthropic('run via dotenvx -f .env.development')
  const response = await client.messages.create({
    model: NARRATION_MODEL,
    max_tokens: NARRATION_MAX_TOKENS,
    thinking: { type: 'adaptive' }, // grounding adherence benefits from reasoning; effort defaults to high
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userMessage }],
  })
  recordModelUsage(NARRATION_MODEL, response.usage)

  if (response.stop_reason === 'refusal') {
    throw new Error(`Narration refused for ${label}: ${JSON.stringify(response.stop_details ?? {})}`)
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error(`Narration hit max_tokens (truncated) for ${label} — raise NARRATION_MAX_TOKENS.`)
  }

  const script = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  if (!script) {
    throw new Error(`Narration produced no text for ${label} (stop_reason=${response.stop_reason}).`)
  }

  return {
    script,
    stopReason: response.stop_reason,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  }
}

/** Narrate one stop with the persona's stop system prompt. Throws on refusal/truncation —
 *  callers must not persist a bad script. */
export async function narrateStop(
  req: NarrationRequest,
  systemPrompt: string,
): Promise<NarrationResult> {
  return runNarration(systemPrompt, buildFactSheet(req), describe(req))
}

function describe(req: NarrationRequest): string {
  return req.stopType === 'scenic'
    ? 'SCENIC stop'
    : `${req.stopType.toUpperCase()} "${req.place?.name ?? '?'}"`
}

/**
 * The exhaustion sentinel for a b-side (docs/designs/tell-me-more-spec.md §2, "if the facts are
 * exhausted, return nothing").
 *
 * ⚠ IT EXISTS BECAUSE "RETURN NOTHING" IS NOT AVAILABLE. `runNarration` THROWS on empty output — a
 * deliberate quality invariant for the main telling (never persist a half script), and one a b-side
 * must not weaken, since both share the call. So an exhausted place has to say so IN BAND, and the
 * caller maps the sentinel to `null`. Silence would be indistinguishable from a truncation.
 *
 * Kept ugly and unpunctuated on purpose: the model is otherwise told to write only spoken words, so a
 * sentinel that could plausibly BE a spoken line risks a real telling being thrown away as exhausted.
 */
export const DEEPER_CUT_NONE = 'NO DEEPER CUT'

/**
 * The B-SIDE conditioning block, appended AFTER the ordinary fact sheet.
 *
 * ⚠ ORDER IS LOAD-BEARING: the sheet comes first so the prompt's cached prefix and every grounding
 * rule land exactly as they do for the main telling — a b-side is not a looser form, it is the SAME
 * grounding with a different selection rule. This block only narrows WHICH facts are still available.
 *
 * ⚠ The main script is quoted as MATERIAL ALREADY SPENT, never as an example to imitate. Handing a
 * model its own prior output invites pastiche of the telling rather than of the facts, which is the
 * failure mode this whole block exists to avoid (tell-me-more-spec §8.5: "a genuine B-side or a
 * leftover-scraps dump?").
 */
function deeperCutBlock(mainScript: string): string {
  return [
    'THE SECOND TELLING (this is a B-SIDE):',
    '',
    'The folks already heard the telling below at this place, start to finish. They liked it enough to ask for more, so they are not being sold the place again — they are being let further in.',
    '',
    '--- ALREADY SAID (do not repeat any of it) ---',
    mainScript,
    '--- END OF WHAT WAS ALREADY SAID ---',
    '',
    'Now tell them something ELSE from the fact sheet above. The rules:',
    '- Everything you say must still come off that sheet. This is not permission to reach further; it is permission to go where the first telling did not.',
    '- Never restate a fact from the already-said, even reworded, and never re-explain what the place IS. They know. Start from the assumption that they were listening.',
    '- Do not open by acknowledging the request with a stock line, and do not narrate that this is a second telling. One warm beat that lands as "since you asked" is plenty, and it should sound like YOU, not like a menu.',
    '- Go for the material the first telling had no room for: the specific, the odd, the human. A tight telling spends the headline and drops the detail — the detail is what you are here for.',
    '- No recap, no summary, no closing bow that ties it back to the main telling.',
    '',
    `IF THE SHEET IS SPENT, SAY SO BY RETURNING EXACTLY THIS AND NOTHING ELSE: ${DEEPER_CUT_NONE}`,
    'A thin place with one good fact already used has no b-side, and that is a correct outcome, not a failure. Padding, restating, or stretching one leftover fact into a telling is worse than the folks hearing nothing — silence beats a scraps dump. Returning the line above is the RIGHT answer more often than you would think; do not talk yourself into a telling you cannot ground.',
  ].join('\n')
}

/**
 * Narrate a place's DEEPER CUT — the "Tell me more" b-side (tell-me-more-spec.md).
 *
 * Resolves to `null` when the model reports the sheet exhausted, which IS the spec's eligibility
 * gate: there is no separate heuristic deciding which places deserve a b-side, only whether one can
 * be grounded (§2, "eligibility is automatic"). Throws on refusal/truncation exactly like
 * `narrateStop` — a caller must never persist a half script.
 *
 * ⚠ `req` is the SAME request that produced the main telling (same sheet, same grounding, same
 * attribution), with `mainScript` naming what was spent. Do NOT hand it a trimmed sheet: the model
 * needs the whole well to find what the first pass left behind.
 */
export async function narrateDeeperCut(
  req: NarrationRequest,
  systemPrompt: string,
  mainScript: string,
): Promise<NarrationResult | null> {
  const user = `${buildFactSheet(req)}\n\n${deeperCutBlock(mainScript)}`
  const result = await runNarration(systemPrompt, user, `B-SIDE ${describe(req)}`)
  // Tolerant match: the sentinel may arrive with stray punctuation or quoting, and a false NEGATIVE
  // here is the expensive direction — it persists a "telling" that is really the model saying no.
  if (result.script.replace(/[^a-z ]/gi, '').trim().toUpperCase() === DEEPER_CUT_NONE) return null
  return result
}

