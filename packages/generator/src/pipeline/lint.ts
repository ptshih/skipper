// Post-assembly diversity lint — the cross-stop backstop the per-stop generator
// can't be.
//
// poi_content is narrated ONCE per place, IN ISOLATION (the cache key carries no
// tour/sibling context, per CLAUDE.md), so a stop can't know what its neighbours
// did. The generator threads a recent-openers/closers/kit window to dampen
// repetition, but a window can't catch a gag that recurs >3 stops apart, and a
// per-stop prompt quota can't enforce a tour-level budget. After every stop is
// narrated, this lints the ASSEMBLED scripts and emits per-stop `avoid` notes the
// generator feeds into a bounded re-narration (see generate.ts `lintAndRegen`).
//
// Detection is DETERMINISTIC (fast, free, predictable) and targets LEXICAL/
// STRUCTURAL repeats: personal-kit overuse, repeated stock phrases, and duplicate
// opener/closer signatures. It deliberately does NOT judge SEMANTIC monotony (two
// DIFFERENT "personify the place" kickers read as samey but share no words) — that
// needs an LLM judge and is left as a future extension.
//
// The SEMANTIC-monotony counterpart now lives in pipeline/judge.ts: an optional
// LLM-judge pass (gated behind --judge-closers) that scores the assembled CLOSERS
// for shared rhetorical MOVE — the personification-kicker residual ("the water
// showing off" / "Tahoe generous to a fault" read samey but share no words, so the
// deterministic rules here can't catch them). It returns the over-used-move seqs in
// this module's LintFinding shape, so generate.ts feeds them through the SAME regen
// hook. This deterministic lint stays the always-on baseline.

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
}

// Personal-kit detectors — mirror generate.ts KIT_BEATS so the lint and the
// generation-time signal agree on what "the kit" is.
const KIT = [/dock guy/i, /\bRay\b/, /\bengine\b/i, /\bcoffee\b/i]
const kitInText = (t: string): boolean => KIT.some((re) => re.test(t))
const DROP_KIT =
  'Do NOT mention the personal kit (cousin Ray, the dock guy, the boat engine, or coffee) anywhere in this stop — close on the place itself.'

// HARD-BANNED reveal wind-ups and AI/brochure tics — the persona prompt forbids
// these outright ("just say the surprising thing plainly"), so flag on the FIRST
// occurrence, not on repeat. The "here is the ..." family is the one the model
// reaches for most as a kit replacement ("here is the fun of it", "here is the
// family deal", "here is one that ..."). Note: only "here's"/"here is" — "there is
// the lighthouse" is legitimate pointing, not a wind-up.
const BANNED: [RegExp, string][] = [
  [/\bhere(?:'s| is)\s+(?:the|one|a|an|what|why|how|something)\b/i, 'a "here is the …" reveal wind-up'],
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

const lastSentence = (s: string): string => {
  const parts = s.trim().split(/(?<=[.!?])\s+/).filter(Boolean)
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
export function lintScripts(stops: LintInput[]): LintFinding[] {
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

  // 1. Personal-kit budget — at most floor(n/3) stops may touch the kit, and at
  //    most ONE may close on it. Flag the worst offenders (closers first, then the
  //    latest stops) to drop the kit.
  const kitStops = stops.filter((s) => kitInText(s.script))
  const kitCloserStops = stops.filter((s) => kitInText(lastSentence(s.script)))
  const kitBudget = Math.max(1, Math.floor(n / 3))
  const kitFlagged = new Set<number>()
  const flagKit = (seq: number, reason: string): void => {
    if (kitFlagged.has(seq)) return
    kitFlagged.add(seq)
    flag(seq, reason, DROP_KIT)
  }
  // (a) every kit-closer beyond the first
  for (const s of kitCloserStops.slice(1)) flagKit(s.seq, 'closes on the personal kit (max one closer-on-kit per tour)')
  // (b) total kit-touching stops beyond budget → flag the latest until within budget
  const overBy = kitStops.length - kitFlagged.size - kitBudget
  if (overBy > 0) {
    const remaining = kitStops.filter((s) => !kitFlagged.has(s.seq)).sort((a, b) => b.seq - a.seq)
    for (const s of remaining.slice(0, overBy)) {
      flagKit(s.seq, `personal kit used in ${kitStops.length}/${n} stops (budget ${kitBudget})`)
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

  return [...findings.values()].sort((a, b) => a.seq - b.seq)
}
