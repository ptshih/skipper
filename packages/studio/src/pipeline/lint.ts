// Post-assembly diversity lint — the cross-stop backstop the per-stop studio pipeline
// can't be.
//
// Each stop's narration is an INDEPENDENT per-stop LLM call (narrateStop) with no
// view of its siblings, so a stop can't know what its neighbours did. The studio pipeline
// threads a recent-openers/closers/kit window to dampen repetition, but a window
// can't catch a gag that recurs >3 stops apart, and a per-stop prompt quota can't
// enforce a tour-level budget. After every stop is narrated, this lints the
// ASSEMBLED scripts and emits per-stop `avoid` notes. It's consumed via
// eval/diversity.ts (evaluateDiversity), whose findings drive optimize() in
// generate.ts for a bounded re-narration.
//
// Detection is DETERMINISTIC (fast, free, predictable) and targets LEXICAL/
// STRUCTURAL repeats: personal-kit overuse, repeated stock phrases, and duplicate
// opener/closer signatures. It deliberately does NOT judge SEMANTIC monotony (two
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
// The SEMANTIC-monotony counterpart now lives in pipeline/judge.ts: an optional
// LLM-judge pass (gated behind --judge-closers) that scores the assembled CLOSERS
// for shared rhetorical MOVE — the personification-kicker residual ("the water
// showing off" / "Tahoe generous to a fault" read samey but share no words, so the
// deterministic rules here can't catch them). It returns the over-used-move seqs in
// this module's LintFinding shape, so generate.ts feeds them through the SAME regen
// hook. This deterministic lint stays the always-on baseline.

import type { StopType } from '@skipper/shared'
import type { KitBeat } from '../persona/types'

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
}

// Personal-kit detectors come from the active persona (passed in), so the lint and the
// studio pipeline's spent-beat tracking read the SAME source — they can never desync (the bug
// the per-region registry fixed). See packages/studio/src/persona/.

// HARD-BANNED reveal wind-ups and AI/brochure tics — the persona prompt forbids
// these outright ("just say the surprising thing plainly"), so flag on the FIRST
// occurrence, not on repeat. The "here is the ..." family is the one the model
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
]

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

/**
 * Lint the assembled narrated scripts for cross-stop monotony. Returns one finding
 * per flagged stop (each with the reasons and the `avoid` notes to regenerate with).
 * Pass story/scenic stops only — break stops carry no script.
 */
export function lintScripts(
  stops: LintInput[],
  kit: { beats: KitBeat[]; dropNote: string },
): LintFinding[] {
  const findings = new Map<number, LintFinding>()
  const flag = (seq: number, reason: string, avoid: string): void => {
    const f = findings.get(seq) ?? { seq, reasons: [], avoid: [] }
    f.reasons.push(reason)
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
        flag(s.seq, `uses a banned wind-up/tic: ${label}`, `Do NOT use ${label} — say the surprising thing plainly; the persona prompt bans this.`)
      }
    }
  }

  // 1. Personal kit is BANNED from stops — it lives in the INTRO frame now (the kit's
  //    only home), so the per-stop budget INVERTS to zero: flag ANY stop that touches
  //    Ray / the mechanic / the truck / coffee. (Oblique refs — "before my first cup",
  //    "balance a checkbook" — slip this regex and are caught by ear, not here.) The
  //    intro/outro frames are never passed to this lint (they are placeless asides,
  //    not stop narrations), so the kit is free there.
  for (const s of stops) {
    if (kit.beats.some((b) => b.match.test(s.script))) {
      flag(s.seq, 'mentions the personal kit (banned from stops — the kit lives in the intro now)', kit.dropNote)
    }
  }

  // 2. Stock-phrase repeats — keep the first use, flag later reuses.
  for (const phrase of STOCK_PHRASES) {
    const hits = stops.filter((s) => s.script.toLowerCase().includes(phrase))
    for (const s of hits.slice(1)) {
      flag(s.seq, `reuses stock phrase "${phrase}"`, `Do NOT use the phrase "${phrase}" — it already appears at an earlier stop.`)
    }
  }

  // 3. Duplicate opener / closer signatures — keep the first, flag later matches.
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

  // 4. Tic STACKING within ONE stop — section 0 flags a stop for ANY banned tic;
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
      )
    }
  }

  // 5. List / inventory SHAPE — a long stop that ENUMERATES facts ("Next... Also...
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

  // 6. Tidy bow / reflective recap CLOSER — the wrap the persona prompt bans ("just
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

  // 7. Within-stop self-repetition — at length a stop can echo its own phrasing. Flag
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
