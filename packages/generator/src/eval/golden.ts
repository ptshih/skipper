// The GOLDEN SET — known-answer eval cases (the eval flywheel's substrate).
//
// Two jobs:
//   1. REGRESSION GATE for the deterministic evaluators (tts, diversity): every case has a
//      human-labeled expected verdict, run as bun-test assertions (free, CI-able) so a prompt
//      or rule change that breaks a locked-in failure mode trips immediately.
//   2. CALIBRATION SUBSTRATE for the LLM evaluators (grounding, charm): the same labeled cases
//      let calibrate.ts measure judge↔human AGREEMENT — an LLM judge is only worth anything if
//      it predicts the founder's ear, so we MEASURE that rather than assume it.
//
// TYPED, not loose JSON: a case references the evaluator input shapes directly, so if
// GroundingInput / TtsInput / LintInput change, the corpus stops compiling (drift-proof —
// "code wins"). Each case carries a `why` recording the exact failure mode it locks in.
//
// Curation rule: a label here is GROUND TRUTH. Add a case when a real failure mode recurs
// (the recap-bow closer, kit overuse, the "was nothing" frame, an invented number, a markdown
// leak); fix the label only with a human in the loop.

import type { GroundingInput } from './grounding'
import type { TtsInput } from './tts'
import type { LintInput } from '../pipeline/lint'

export interface GroundingCase {
  id: string
  dimension: 'grounding'
  input: GroundingInput
  /** Expected verdict: overall pass, + lowercase substrings each expected ungrounded claim should contain. */
  expect: { pass: boolean; ungrounded: string[] }
  why: string
}
export interface TtsCase {
  id: string
  dimension: 'tts'
  input: TtsInput
  expect: { pass: boolean }
  why: string
}
export interface DiversityCase {
  id: string
  dimension: 'diversity'
  /** Diversity is CROSS-stop, so a case is a set of scripts. */
  inputs: LintInput[]
  expect: { failingSeqs: number[] }
  why: string
}
export type GoldenCase = GroundingCase | TtsCase | DiversityCase

const LT = { region: 'Lake Tahoe', corridor: 'Emerald Bay Run' }

export const GROUNDING_CASES: GroundingCase[] = [
  {
    id: 'grounding-clean-story',
    dimension: 'grounding',
    input: {
      seq: 0,
      stopType: 'story',
      placeName: 'Vikingsholm',
      script:
        'At the head of the bay — Vikingsholm, finished in 1929 for a woman named Lora Knight. They call it Scandinavian architecture; I call it the fanciest cabin you will ever see.',
      well: [
        'Vikingsholm is a mansion at the head of Emerald Bay.',
        'Vikingsholm was completed in 1929.',
        'Vikingsholm was built for Lora Josephine Knight.',
        'Vikingsholm is regarded as an example of Scandinavian architecture.',
      ],
      ...LT,
    },
    expect: { pass: true, ungrounded: [] },
    why: 'every claim (1929, Lora Knight, Scandinavian architecture) is on the sheet — must not false-positive.',
  },
  {
    id: 'grounding-invented-number',
    dimension: 'grounding',
    input: {
      seq: 1,
      stopType: 'story',
      placeName: 'Emerald Bay',
      script: 'Emerald Bay herself — and at three hundred feet deep, she is a serious piece of water.',
      well: ['Emerald Bay is a bay on the southwest shore of Lake Tahoe.'],
      ...LT,
    },
    expect: { pass: false, ungrounded: ['feet'] },
    why: 'a depth not on the sheet is invented — measurements are hard facts, never ambient color.',
  },
  {
    id: 'grounding-hedged-invention',
    dimension: 'grounding',
    input: {
      seq: 2,
      stopType: 'story',
      placeName: 'Emerald Bay',
      script: 'I bet this old road has seen a stagecoach or two come rattling through in its day.',
      well: ['Emerald Bay is a bay on the southwest shore of Lake Tahoe.'],
      ...LT,
    },
    expect: { pass: false, ungrounded: ['stagecoach'] },
    why: 'the hardest case: "I bet" does NOT launder an invented event — flag the claim, not the hedge.',
  },
  {
    id: 'grounding-invented-ranking',
    dimension: 'grounding',
    input: {
      seq: 3,
      stopType: 'story',
      placeName: 'Emerald Bay',
      script: 'This has to be one of the deepest, prettiest coves on the whole lake.',
      well: ['Emerald Bay is a bay on the southwest shore of Lake Tahoe.'],
      ...LT,
    },
    expect: { pass: false, ungrounded: ['deepest'] },
    why: 'a ranking/superlative about the place ("one of the deepest") is a place-fact unless on the sheet.',
  },
  {
    id: 'grounding-computed-span',
    dimension: 'grounding',
    input: {
      seq: 4,
      stopType: 'story',
      placeName: 'Tahoe Tavern',
      script: 'The old Tahoe Tavern opened in 1901 and finally came down in 1964 — it stood for sixty-three years.',
      well: ['The Tahoe Tavern opened in 1901.', 'The Tahoe Tavern was demolished in 1964.'],
      ...LT,
    },
    expect: { pass: false, ungrounded: ['sixty-three'] },
    why: 'a span COMPUTED from two sheet years is a number the sheet never stated — the "do not compute" rule.',
  },
  {
    id: 'grounding-scenic-names-landmark',
    dimension: 'grounding',
    input: {
      seq: 5,
      stopType: 'scenic',
      script: "That's Mount Tallac off to the left, with Cascade Lake tucked in below it.",
      well: ['Bedrock here is granite, Cretaceous — roughly 100 million years old.'],
      ...LT,
    },
    expect: { pass: false, ungrounded: ['tallac'] },
    why: 'a SCENIC stop may name no peak/lake/landmark — only the given geology + plainly-visible things.',
  },
  {
    id: 'grounding-scenic-clean',
    dimension: 'grounding',
    input: {
      seq: 6,
      stopType: 'scenic',
      script:
        'Look at that water — that impossible blue. The rock we are rolling over is granite, about a hundred million years old. Quiet up here, is it not.',
      well: ['Bedrock here is granite, Cretaceous — roughly 100 million years old.'],
      ...LT,
    },
    expect: { pass: true, ungrounded: [] },
    why: 'scenic done right: only the given geology + delivery ("impossible blue", "quiet") — no place-fact.',
  },
  {
    id: 'grounding-ambient-ok',
    dimension: 'grounding',
    input: {
      seq: 7,
      stopType: 'story',
      placeName: 'Tahoe City',
      script:
        'Welcome to Tahoe City, settled back in 1864 — and you can feel that mountain-morning chill coming off the lake, can you not.',
      well: ['Tahoe City was settled in 1864.'],
      ...LT,
    },
    expect: { pass: true, ungrounded: [] },
    why: 'naming the corridor town + plain world-knowledge (mountain mornings are cold) are the sanctioned carve-outs.',
  },
]

export const TTS_CASES: TtsCase[] = [
  {
    id: 'tts-clean',
    dimension: 'tts',
    input: { seq: 0, script: 'Coming up on the right — a beaut of a cove. Do not blink... you will miss it.' },
    expect: { pass: true },
    why: 'em-dashes, ellipses, apostrophes are normal spoken prose — must not flag.',
  },
  { id: 'tts-markdown-bold', dimension: 'tts', input: { seq: 1, script: 'Pull over at **Camp Richardson** for a bite.' }, expect: { pass: false }, why: 'markdown emphasis would be read aloud as garbage.' },
  { id: 'tts-emoji', dimension: 'tts', input: { seq: 2, script: 'What a view 😍 folks.' }, expect: { pass: false }, why: 'emoji render as tofu and TTS chokes.' },
  { id: 'tts-url', dimension: 'tts', input: { seq: 3, script: 'More at https://tahoe.example later.' }, expect: { pass: false }, why: 'a URL spoken aloud is nonsense.' },
  { id: 'tts-year-ok', dimension: 'tts', input: { seq: 4, script: 'Back in 1960, the games came to the valley.' }, expect: { pass: true }, why: 'a bare year reads fine — digits are intentionally NOT gated.' },
]

export const DIVERSITY_CASES: DiversityCase[] = [
  {
    id: 'diversity-clean',
    dimension: 'diversity',
    inputs: [
      { seq: 0, stopType: 'story', script: 'A quiet cove opens up on the left, the water gone glassy and still.' },
      { seq: 1, stopType: 'scenic', script: 'Pines crowd the shoulder here; the light comes down green and easy.' },
    ],
    expect: { failingSeqs: [] },
    why: 'two varied, clean stops — no cross-stop sameness to flag.',
  },
  {
    id: 'diversity-banned-windup',
    dimension: 'diversity',
    inputs: [
      { seq: 0, stopType: 'story', script: 'The lake sits flat and bright this morning, smooth off to the right.' },
      { seq: 1, stopType: 'story', script: "Well, here's the thing about this old town, folks." },
    ],
    expect: { failingSeqs: [1] },
    why: 'locks the banned "here\'s the …" reveal wind-up the persona prompt forbids.',
  },
]

export const GOLDEN: GoldenCase[] = [...GROUNDING_CASES, ...TTS_CASES, ...DIVERSITY_CASES]
