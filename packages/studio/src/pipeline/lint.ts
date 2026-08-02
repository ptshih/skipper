// Post-assembly diversity lint — the cross-stop backstop the per-stop studio pipeline
// can't be.
//
// Each stop's narration is an INDEPENDENT per-stop LLM call (narrateStop) with no
// view of its siblings, so a stop can't know what its neighbours did.
//
// ⚠ This header used to say the pipeline "threads a recent-openers/closers/kit window to dampen
// repetition", framing the lint as the second of two layers. There is no such window on any live path:
// `narrateStop` still DECLARES `recentOpeners`/`recentClosers`/`recentMotifs`/`priorStops` and renders
// them, but no production caller sets any of them (grep — only narrate.ts mentions them), and the
// persona KIT was cut outright (docs/decisions/cut-intro-frame-and-persona-kit.md). So this lint plus
// the diversity context the gate scores against is the ONLY cross-clip layer, not the backstop behind
// one. Worth knowing before trusting repetition to be handled upstream — it isn't.
//
// After every stop is narrated, this lints the
// ASSEMBLED scripts and emits per-stop `avoid` notes. It's consumed via
// eval/diversity.ts (evaluateDiversity), whose findings drive optimize() (defined in
// eval/optimize.ts) from generate-narrations.ts for a bounded re-narration.
//
// Detection is DETERMINISTIC (fast, free, predictable) and targets LEXICAL/
// STRUCTURAL repeats: repeated stock phrases and duplicate opener/closer
// signatures. It deliberately does NOT judge SEMANTIC monotony (two
// DIFFERENT "personify the place" kickers read as samey but share no words) — that
// needs an LLM judge and is left as a future extension.
//
// LONG-FORM backstop: once a STORY stop targets a Shaka-length ~2 min telling, new
// failure modes appear WITHIN a single stop that the cross-stop checks miss — the
// model, given more room, reaches for MULTIPLE wind-up crutches, enumerates facts
// like a list, ties a reflective bow on the end, or echoes its own phrasing. The
// per-stop checks below (tic-stacking, list/inventory shape, tidy-bow closer,
// within-stop repetition) catch those; the persona prompt forbids all of them, so
// they flag on first occurrence, conservatively (so a valid long stop isn't
// needlessly regenerated).
//
// (A SEMANTIC-monotony counterpart — an optional LLM closer-diversity judge — was
// removed with the V1→V2 collapse: cross-stop closer monotony assumes an ordered
// per-tour closer SEQUENCE, which V2's 1:1 shared-narration atom dissolves, so the
// rhetorical-move residual the deterministic rules can't catch is left unaddressed.)
// This deterministic lint stays the always-on baseline.

import type { StopType } from '@skipper/shared'

export interface LintInput {
  seq: number
  stopType: StopType
  /** The narrated script (story/scenic stops only — breaks carry no audio). */
  script: string
}

export interface LintFinding {
  seq: number
  /** Why this stop was flagged — human-readable, for the generation log. */
  reasons: string[]
  /** Concrete instructions fed verbatim into the stop's re-narration. */
  avoid: string[]
  /** How many of `reasons` are HARD — a banned wind-up/tic the persona prompt forbids outright.
   *  Reported separately so a consumer can weight it without parsing the prose: these are per-clip
   *  and fixable on the next take, unlike the shared-n-gram findings, which are a corpus-level
   *  source problem. See `StopEval.hardFindings`. */
  hard: number
}

// HARD-BANNED reveal wind-ups and AI/brochure tics — the persona prompt forbids
// these outright ("just say the surprising thing plainly"), so flag on the FIRST
// occurrence, not on repeat.
//
// ⚠ ADDING A PATTERN HERE IS HALF THE JOB — say it in the PROMPT too (persona/skipper.ts). This
// table and that prose are two hand-maintained lists, and only one of them the model ever reads.
// That gap is not theoretical: the prompt banned three completions of the "here's the …" family
// while this regex banned nine, so the model avoided the three it was told about and wrote the rest
// — 148 of 457 released clips. A test guards the OTHER direction (the prompt may not itself USE a
// pattern in this table, via `bannedTicsIn`); nothing yet checks that the prompt MENTIONS each one. The "here is the ..." family is the one the model
// reaches for most as a kit replacement ("here is the fun of it", "here is the
// family deal", "here is one that ..."). Note: only "here's"/"here is" — "there is
// the lighthouse" is legitimate pointing, not a wind-up.
const BANNED: [RegExp, string][] = [
  // "here's the / here's where it …" reveal wind-ups (incl. the long-form leak
  // "here's where it gets fancy" / "here is where it turns" the audit caught).
  [/\bhere(?:'s| is)\s+(?:the|one|a|an|what|why|how|where|something)\b/i, 'a "here is the/where …" reveal wind-up'],
  [/\bwhere it (?:gets|turns|starts to get|really gets)\b/i, 'a "where it gets/turns …" pivot wind-up'],
  [/\bwrap your head around\b/i, 'a "wrap your head around …" listener-nudge'],
  [/\b(?:wait for it|wait (?:till|until) you)\b/i, 'a "wait for it" listener-nudge'],
  [/\bthe story (?:does ?n'?t|does not) end\b/i, 'a "the story doesn\'t end there" wind-up'],
  [/\bfun fact\b/i, '"fun fact"'],
  [/\bdid you know\b/i, '"did you know"'],
  [/\b(?:but|and)\s+get this\b/i, '"(but/and) get this"'],
  [/\bisn'?t that (?:something|wild|amazing|incredible)\b/i, '"isn\'t that something"'],
  [/\bpretty (?:cool|neat|wild),?\s+right\b/i, '"pretty cool, right"'],
  [/\bto this day\b/i, '"to this day"'],
  [/\bover the years\b/i, '"over the years"'],
  [/\bnestled\b/i, '"nestled"'],
  [/\brich history\b/i, '"rich history"'],
  // "The card" is the PROMPT's internal word for the fact sheet. A rider has never heard it and has
  // no idea what it means, so naming it aloud breaks the fiction mid-sentence — "Late Cretaceous, the
  // card tells me", "I'm quoting the card here", "That is the whole card, folks."
  // ⚠ Narrowed against the real corpus, because this is a casino region and cards are legitimate
  // SUBJECT matter: the leak always says "the/my card" singular, while every genuine use is "a card"
  // or "cards" ("pick a card, any card", "a calling card", "still dealing the cards", "more aliases
  // than a card shark"). Measured over all 458 scripted clips: this catches 18 leaks in 18 clips and
  // none of the 15 legitimate mentions. The lookahead keeps a real card room/table/game out of it.
  [
    /\b(?:the|my) (?:whole )?card\b(?!\s+(?:room|table|game|games|club|catalogue|catalog|shark))/i,
    '"the card" — the fact sheet named out loud',
  ],
]

/** Labels whose WORDS the persona prompt legitimately uses in its own INSTRUCTION voice, so the
 *  prompt-guard test must not flag them in its prose.
 *
 *  ⚠ Only prose is exempt. The guard still lints the prompt's EXAMPLE narrations against the full
 *  table, and that is the half that matters: the prompt has to say "the card" to explain what the
 *  card IS, but an example narration that says it is teaching the leak. One did — the Coyote Mesa
 *  scenic example read "That is all the card gives me" — which is where a good share of the 18 came
 *  from. Add to this set only when the prompt must NAME a thing it forbids the Skipper from saying. */
export const PROMPT_PROSE_EXEMPT: ReadonlySet<string> = new Set([
  '"the card" — the fact sheet named out loud',
])

/** Which banned wind-ups/tics appear in a piece of text, by label. Exported so anything that must
 *  agree with this table can ASK it instead of keeping a second copy — notably the persona-prompt
 *  guard test, which checks that the prompt does not itself model the constructions it forbids.
 *  (It did: two sentences in its own voice, measured as the cause of 148 shipped clips carrying the
 *  "here's the …" family, because the prompt's prose banned only three completions of it.) */
export function bannedTicsIn(text: string): string[] {
  return BANNED.filter(([re]) => re.test(text)).map(([, label]) => label)
}

// Global-flag variants of BANNED, precomputed once at module load — used to COUNT
// occurrences for the within-stop tic-stacking check below. The base BANNED forms are
// single-match (test()), so without this the stacking pass would rebuild a global regex
// per stop × per pattern on every lintScripts call.
const BANNED_GLOBAL: RegExp[] = BANNED.map(([re]) =>
  new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'),
)

// Crutch phrases the Skipper reaches for: fine ONCE, grating when repeated across a
// single drive. Matched case-insensitively as substrings.
const STOCK_PHRASES = [
  'the whole works',
  'the whole shebang',
  'one and only',
  'no backups',
  'my kind of',
  'imagine that',
  "she's a beaut",
  'after my own heart',
  'here is the twist',
  'here is the wild part',
  'here is the kicker',
  'take your pick',
]

// Filler that shouldn't anchor an opener/closer signature (so "Now, up at the head"
// and "Up at the head" count as the same opening shape).
const FILLER = new Set([
  'now', 'so', 'well', 'and', 'but', 'folks', 'the', 'a', 'an', 'that', 'this',
  'up', 'out', 'here', 'there', 'just', 'see', 'is', 'it', 'at', 'in', 'of', 'on',
])

const contentWords = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w))

const splitSentences = (s: string): string[] => s.trim().split(/(?<=[.!?])\s+/).filter(Boolean)

const lastSentence = (s: string): string => {
  const parts = splitSentences(s)
  return parts.length ? parts[parts.length - 1]! : s.trim()
}

/** First N content words — an opener "shape" signature robust to leading filler. */
const openerKey = (s: string): string => contentWords(s).slice(0, 4).join(' ')
/** Last N content words — a closer "shape" signature. */
const closerKey = (s: string): string => contentWords(s).slice(-4).join(' ')

/** A COARSE opener signature — the first 2 content words.
 *
 *  Why both: `openerKey`'s 4-word exact match is too specific to see the monotony that actually
 *  exists. Measured over the 420 released solo clips, "right about here…" opens 20 and "here is a…"
 *  opens 25, yet the exact key read "right about you are", "right about once stood" and "right about
 *  here" as three unrelated openers and flagged 2 collisions in the whole corpus. Two words catches the
 *  SHAPE; the tolerance below is what keeps it from crying wolf. */
const openerShape = (s: string): string => contentWords(s).slice(0, 2).join(' ')

/** How many EARLIER clips must already share an opener shape before the next one is flagged. Higher
 *  than the exact-key rule's implicit 1 on purpose — a 2-word shape collides legitimately now and
 *  then, and a rule that fires on the second use of "gold hill" would be noise. */
const OPENER_SHAPE_MIN_PRIOR = 2

// ── Shared content n-grams — the rule STOCK_PHRASES structurally cannot express ──────────────────
// STOCK_PHRASES is a hand-written list, so it only ever catches repetition someone predicted. The
// corpus measurement (2026-07-30) is what this rule exists for: the cross-stop rules flagged 16 of 451
// released clips, while an n-gram sweep found "the national register of historic places" in 60/420 solo
// and 7/31 fused tellings, and the granite age range in 20. None of it was in the list, and none of it
// ever would have been — co-located POIs are handed the SAME source facts (one Macrostrat map unit for
// a whole batholith, one NRHP listing phrase), so they converge on wording no author anticipated.
const SHARED_NGRAM_N = 6
/** An n-gram must be carried by this many DISTINCT clips before it counts as worn out.
 *  Exported because GENERATION has to agree with EVALUATION about where "worn out" starts —
 *  `generate-narrations.ts` derives its shared-fact warning threshold from this rather than
 *  restating the number and trusting a comment to keep the two aligned. */
export const SHARED_NGRAM_MIN_CLIPS = 4
/** Cap the notes per stop — overlapping windows of one phrase would otherwise fill the avoid list. */
const SHARED_NGRAM_MAX_REPORTED = 3

// MEASURED at these thresholds over the 451 released clips (2026-07-30), so the rate is not a surprise
// later: the n-gram rule flags 170 clips (38%) and the opener-shape rule 49 (11%), against 6 and 10 for
// the two rules that existed before. 38% READS high, but the top six shared phrases are all NRHP or
// granite-age variants — it is not spraying, it is finding the two problems the corpus actually has, at
// their real size. Both are ADVISORY (they weight optimize()'s score and feed the retake's avoid list,
// never withhold), which is what makes a rate this high safe. ⚠ Do NOT promote either to a gate without
// re-measuring: at 38% a gate would withhold a third of the corpus over wording, not truth.

/** Word n-grams for the shared-phrase scan, deduped within the clip. Raw lowercase words (NOT
 *  `contentWords`) so the reported phrase reads back as something the writer actually said. */
function ngramsOf(script: string, n: number): Set<string> {
  const w = script.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const out = new Set<string>()
  for (let i = 0; i + n <= w.length; i++) {
    const g = w.slice(i, i + n)
    // Need real substance: a run that is nearly all filler ("and it is on the a") is not a phrase.
    if (g.filter((x) => !FILLER.has(x)).length < 3) continue
    out.add(g.join(' '))
  }
  return out
}

/**
 * Lint the assembled narrated scripts for cross-stop monotony. Returns one finding
 * per flagged stop (each with the reasons and the `avoid` notes to regenerate with).
 * Pass story/scenic stops only — break stops carry no script.
 */
export function lintScripts(stops: LintInput[]): LintFinding[] {
  const findings = new Map<number, LintFinding>()
  const flag = (seq: number, reason: string, avoid: string, hard = false): void => {
    const f = findings.get(seq) ?? { seq, reasons: [], avoid: [], hard: 0 }
    f.reasons.push(reason)
    if (hard) f.hard++
    if (!f.avoid.includes(avoid)) f.avoid.push(avoid)
    findings.set(seq, f)
  }

  const n = stops.length
  if (n === 0) return []

  // 0. Hard-banned reveal wind-ups / AI tics — flagged on FIRST occurrence (the
  //    persona prompt forbids them, so they're never OK, not just when repeated).
  for (const s of stops) {
    for (const [re, label] of BANNED) {
      if (re.test(s.script)) {
        flag(
          s.seq,
          `uses a banned wind-up/tic: ${label}`,
          `Do NOT use ${label} — say the surprising thing plainly; the persona prompt bans this.`,
          true, // HARD: never acceptable, and fixable in this clip — see LintFinding.hard
        )
      }
    }
  }

  // 1. Stock-phrase repeats — keep the first use, flag later reuses.
  // Lowercase ONCE, not once per phrase: with V2 passing a whole region's corpus as context
  // (evaluateDiversityAgainst), `stops` is hundreds of scripts and this loop runs per take.
  const lowered = stops.map((s) => s.script.toLowerCase())
  for (const phrase of STOCK_PHRASES) {
    const hits = stops.filter((_s, i) => lowered[i]!.includes(phrase))
    for (const s of hits.slice(1)) {
      flag(s.seq, `reuses stock phrase "${phrase}"`, `Do NOT use the phrase "${phrase}" — it already appears at an earlier stop.`)
    }
  }

  // 2. Duplicate opener / closer signatures — keep the first, flag later matches.
  const seenOpen = new Map<string, number>()
  const seenClose = new Map<string, number>()
  for (const s of stops) {
    const ok = openerKey(s.script)
    const ck = closerKey(s.script)
    if (ok) {
      const prev = seenOpen.get(ok)
      if (prev !== undefined) flag(s.seq, `opens like stop ${prev} ("${ok}")`, `Open DIFFERENTLY — do not begin with words like "${ok}".`)
      else seenOpen.set(ok, s.seq)
    }
    if (ck) {
      const prev = seenClose.get(ck)
      if (prev !== undefined) flag(s.seq, `closes like stop ${prev} ("${ck}")`, `Close DIFFERENTLY — do not end with words like "${ck}".`)
      else seenClose.set(ck, s.seq)
    }
  }

  // 2b. Opener SHAPE — the coarse counterpart to 2's exact key, which under-counts badly (see
  //     `openerShape`). Tolerated until OPENER_SHAPE_MIN_PRIOR earlier clips already share the shape,
  //     so an occasional collision is free and a habit is not.
  const shapeCount = new Map<string, number>()
  for (const s of stops) {
    const sh = openerShape(s.script)
    if (!sh) continue
    const prior = shapeCount.get(sh) ?? 0
    if (prior >= OPENER_SHAPE_MIN_PRIOR) {
      flag(
        s.seq,
        `opens on a worn shape — ${prior} earlier stops already begin "${sh}…"`,
        `Do NOT open with "${sh}…" — ${prior} other tellings around here already start that way. Find a different way in.`,
      )
    }
    shapeCount.set(sh, prior + 1)
  }

  // 2c. Shared content n-grams — repetition nobody predicted, which is most of it.
  //     Keep the first user of a worn phrase and flag the rest, matching every other cross-stop rule.
  if (n >= SHARED_NGRAM_MIN_CLIPS) {
    const grams = stops.map((s) => ngramsOf(s.script, SHARED_NGRAM_N))
    const carriers = new Map<string, number[]>() // n-gram → stop indices, in order
    grams.forEach((set, i) => {
      for (const g of set) {
        const arr = carriers.get(g)
        if (arr) arr.push(i)
        else carriers.set(g, [i])
      }
    })
    for (let i = 0; i < stops.length; i++) {
      // Worn phrases this stop carries, most-shared first — but not if it was the FIRST to use it.
      const worn = [...grams[i]!]
        .map((g) => ({ g, at: carriers.get(g)! }))
        .filter((x) => x.at.length >= SHARED_NGRAM_MIN_CLIPS && x.at[0] !== i)
        .sort((a, b) => b.at.length - a.at.length)
      const taken: string[][] = []
      for (const { g, at } of worn) {
        if (taken.length >= SHARED_NGRAM_MAX_REPORTED) break
        // Collapse overlapping windows of ONE phrase: "on the national register of historic" and
        // "the national register of historic places" are the same complaint slid by a word.
        const words = g.split(' ')
        if (taken.some((t) => words.filter((w) => t.includes(w)).length >= SHARED_NGRAM_N - 1)) continue
        taken.push(words)
        flag(
          stops[i]!.seq,
          `shares the phrase "${g}" with ${at.length - 1} other tellings`,
          // ⚠ Aimed at the WORDING, never the fact. "On the National Register" is usually TRUE, and a
          // note that reads as "don't mention it" would trade grounding for variety — the one trade
          // this project never makes.
          `Do not phrase it as "${g}" — ${at.length - 1} other tellings around here already use those exact words. Keep the fact; find your own way to say it.`,
        )
      }
    }
  }

  // 3. Tic STACKING within ONE stop — section 0 flags a stop for ANY banned tic;
  //    at length the model piles several into one telling. Count total occurrences
  //    so the regen note can say "you stacked N," which the per-pattern flag can't.
  for (const s of stops) {
    let ticCount = 0
    for (const g of BANNED_GLOBAL) ticCount += (s.script.match(g) ?? []).length
    if (ticCount >= 2) {
      flag(
        s.seq,
        `stacks ${ticCount} wind-up/AI tics in one stop`,
        'You used several canned setups/wind-ups in this single stop — remove ALL of them and just state each surprising thing plainly.',
        true, // HARD for the same reason as the per-pattern ban above: it counts the SAME patterns.
      )
    }
  }

  // 4. List / inventory SHAPE — a long stop that ENUMERATES facts ("Next... Also...
  //    Another thing...") instead of weaving them; the persona prompt bans the
  //    encyclopedia shape. Flag ≥2 sentence-initial enumerators in one stop.
  const LIST_MARKER =
    /^(first(?:ly)?|second(?:ly)?|third(?:ly)?|next|also|lastly|finally|another thing|and another|then there'?s|then there is|plus)\b,?/i
  for (const s of stops) {
    const sentences = splitSentences(s.script)
    const markers = sentences.filter((x) => LIST_MARKER.test(x.trim())).length
    if (markers >= 2) {
      flag(
        s.seq,
        `reads like a list (${markers} enumerated sentences)`,
        'Do NOT enumerate the facts ("Next... Also... Another thing..."). Weave them — let one fact hand you to the next with a reaction or a turn, not a list marker.',
      )
    }
  }

  // 5. Tidy bow / reflective recap CLOSER — the wrap the persona prompt bans ("just
  //    one of the many stories this place has to tell"). Checked on the LAST sentence
  //    only, so a mid-stop aside doesn't trip it.
  const TIDY_BOW: RegExp[] = [
    /one of the many/i,
    /stor(?:y|ies) this place (?:has|could)/i,
    /goes to show/i,
    /at the end of the day/i,
    /\ball in all\b/i,
    /there you have it/i,
    /sums? (?:it|this|the place|this place) up/i,
    /if that (?:doesn'?t|does not|isn'?t|is not)\b/i,
    /just one of those (?:places|spots|stories)/i,
  ]
  for (const s of stops) {
    const last = lastSentence(s.script)
    if (TIDY_BOW.some((re) => re.test(last))) {
      flag(
        s.seq,
        'ends on a tidy bow / reflective recap',
        'Do NOT end with a reflective bow or summary ("just one of the many stories...", "goes to show...", "all in all..."). Close on a concrete fact, a plain sensory image, or honest understatement.',
      )
    }
  }

  // 6. Within-stop self-repetition — at length a stop can echo its own phrasing. Flag
  //    any CONTENT-word 4-gram repeated in a single script (filler-stripped, so "the
  //    a now" don't count; a repeated 4-word content run is a real echo, not chance,
  //    and 4 words rarely collide with a 2–3-word place name). Long scripts only.
  for (const s of stops) {
    const words = contentWords(s.script)
    if (words.length < 12) continue
    const seen = new Set<string>()
    let repeated: string | undefined
    for (let i = 0; i + 3 < words.length; i++) {
      const quad = `${words[i]} ${words[i + 1]} ${words[i + 2]} ${words[i + 3]}`
      if (seen.has(quad)) {
        repeated = quad
        break
      }
      seen.add(quad)
    }
    if (repeated) {
      flag(
        s.seq,
        `repeats the phrase "${repeated}" within the stop`,
        `Do NOT repeat the phrase "${repeated}" inside this stop — say it once.`,
      )
    }
  }

  return [...findings.values()].sort((a, b) => a.seq - b.seq)
}
