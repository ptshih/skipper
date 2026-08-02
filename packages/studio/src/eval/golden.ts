// The GOLDEN SET — known-answer eval cases (the eval flywheel's substrate).
//
//   1. CALIBRATION SUBSTRATE for the LLM evaluators (grounding, charm): the human-labeled cases
//      let calibrate.ts measure judge↔human AGREEMENT — an LLM judge is only worth anything if
//      it predicts the founder's ear, so we MEASURE that rather than assume it. Only GROUNDING_CASES
//      is wired in today (calibrate.ts).
//   2. LABELED FIXTURES for the deterministic evaluators (tts, diversity): every case has a
//      human-labeled expected verdict. NOTE: the eval-golden.test.ts regression gate that asserted
//      TTS_CASES/DIVERSITY_CASES was removed in 5ca12d3 — they are retained as labeled fixtures but
//      are not currently run as a test (the live tts/diversity tests use their own inline cases).
//
// TYPED, not loose JSON: a case references the evaluator input shapes directly, so if
// GroundingInput / TtsInput / LintInput change, the corpus stops compiling (drift-proof —
// "code wins"). Each case carries a `why` recording the exact failure mode it locks in.
//
// Curation rule: a label here is GROUND TRUTH. Add a case when a real failure mode recurs
// (the recap-bow closer, kit overuse, the "was nothing" frame, an invented number, a markdown
// leak); fix the label only with a human in the loop.

import { buildGroundingWell } from './grounding'
import type { GroundingInput } from './grounding'

export interface GroundingCase {
  id: string
  dimension: 'grounding'
  input: GroundingInput
  /** Expected verdict: overall pass, + lowercase substrings each expected ungrounded claim should contain. */
  expect: { pass: boolean; ungrounded: string[] }
  why: string
}
const LT = { region: 'Lake Tahoe', corridor: 'Emerald Bay Run' }
const NV = { region: 'Northern Nevada', corridor: 'US 395' }

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
    id: 'grounding-scenic-named-clean',
    dimension: 'grounding',
    input: {
      seq: 8,
      stopType: 'scenic',
      placeName: 'Sand Harbor',
      script:
        "Off to the right — that's Sand Harbor, a beach, and the water there is doing that show-off blue it does. Just look. That's the whole assignment.",
      // Built by the SHARED well builder (not hand-copied) so a phrasing change there
      // re-calibrates here instead of silently drifting.
      well: buildGroundingWell({
        stopType: 'scenic',
        name: 'Sand Harbor',
        kind: 'beach',
        sideOfRoad: 'right',
      }),
      ...LT,
    },
    expect: { pass: true, ungrounded: [] },
    why: 'a NAMED scenic may say its given name + kind + side (the narrate.ts contract) — the well line licenses exactly that; must not false-positive.',
  },
  {
    id: 'grounding-scenic-named-overreach',
    dimension: 'grounding',
    input: {
      seq: 9,
      stopType: 'scenic',
      placeName: 'Sand Harbor',
      script:
        "Sand Harbor on the right, folks — softest sand on the lake, and the most popular beach in Nevada. Locals line up at dawn for a spot.",
      well: buildGroundingWell({
        stopType: 'scenic',
        name: 'Sand Harbor',
        kind: 'beach',
        sideOfRoad: 'right',
      }),
      ...LT,
    },
    expect: { pass: false, ungrounded: ['popular'] },
    why: 'the name licenses NOTHING it implies — softness/popularity/crowds on a named scenic are invented place-facts.',
  },
  {
    id: 'grounding-callback-ambient',
    dimension: 'grounding',
    input: {
      seq: 10,
      stopType: 'story',
      placeName: 'Cave Rock',
      script:
        'Cave Rock, dead ahead — the tunnel runs right through it. Volcanic rock, says my sheet. Quite a morning we are having: first Vikingsholm, now a road that drives through a rock.',
      well: ['Cave Rock is a tunnel formation of volcanic rock on the east shore of Lake Tahoe.'],
      otherStops: ['Vikingsholm', 'Emerald Bay State Park'],
      ...LT,
    },
    expect: { pass: true, ungrounded: [] },
    why: 'recalling an earlier stop BY NAME while asserting nothing new about it is a sanctioned callback — ambient, not invention. (A callback that DOES add a fact, e.g. where Vikingsholm sits, is still ungrounded — this stop was not given that.)',
  },
  {
    id: 'grounding-merged-feature',
    dimension: 'grounding',
    input: {
      seq: 11,
      stopType: 'story',
      placeName: 'Emerald Bay State Park',
      script:
        'Emerald Bay — the postcard itself. And that speck of granite out in the middle is Fannette Island, the only island in all of Lake Tahoe. One island. The lake said "perfect, no notes."',
      well: buildGroundingWell({
        stopType: 'story',
        name: 'Emerald Bay State Park',
        facts: ['Emerald Bay State Park is a state park on the southwest shore of Lake Tahoe.'],
        mergedFeatures: [
          {
            name: 'Fannette Island',
            facts: [
              'Fannette Island is the only island in Lake Tahoe.',
              'The island is composed of granite.',
            ],
          },
        ],
      }),
      ...LT,
    },
    expect: { pass: true, ungrounded: [] },
    why: 'a co-located MERGED feature\'s facts are part of the permitted well (name-prefixed lines) — naming the island + its sheet facts must not false-positive.',
  },
  {
    id: 'grounding-inverse-relation',
    dimension: 'grounding',
    input: {
      seq: 12,
      stopType: 'story',
      placeName: 'Vikingsholm',
      script:
        "The house was drawn up by Leonard Palme — Lora Knight's nephew, which made family dinners double as design reviews.",
      well: [
        'The architect was Leonard Palme, who was hired by his aunt Lora Josephine Knight to design and build Vikingsholm.',
      ],
      ...LT,
    },
    expect: { pass: true, ungrounded: [] },
    why: 'restating a sheet relationship from the other side ("his aunt X" ⇒ "he was X\'s nephew") is entailment, not invention — a real false-positive caught on a live run (2026-06-09).',
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
  {
    id: 'grounding-type-knowledge-ambient',
    dimension: 'grounding',
    input: {
      seq: 10,
      stopType: 'story',
      placeName: 'Brougher Mansion',
      script:
        "It's a Queen Anne — the only one in Carson City. A Queen Anne is the fancy kind, all turrets and trim and porches that go nowhere in particular.",
      well: [
        'Brougher Mansion is a Queen Anne house.',
        'Brougher Mansion is the only Queen Anne in Carson City.',
      ],
      ...NV,
    },
    expect: { pass: true, ungrounded: [] },
    why: 'general knowledge about the Queen Anne STYLE (turrets/trim/porches) is a category trait true everywhere — ambient, not a place-fact; the only-one-in-the-city claim is on the sheet. A real withhold false-positive (2026-06-20).',
  },
  {
    id: 'grounding-definition-ambient',
    dimension: 'grounding',
    input: {
      seq: 11,
      stopType: 'story',
      placeName: 'U.S. Route 395 in Nevada',
      script: "This stretch started life as a toll road — Boyd's Toll Road. Used to be you paid to use it.",
      well: ["US 395 here began as a toll road called Boyd's Toll Road."],
      ...NV,
    },
    expect: { pass: true, ungrounded: [] },
    why: 'that you PAY to use a "toll road" is the definition of the term the sheet supplies — definitional, ambient. (A toll AMOUNT, or who personally collected, would be ungrounded.)',
  },
  {
    id: 'grounding-external-frame-ambient',
    dimension: 'grounding',
    input: {
      seq: 12,
      stopType: 'story',
      placeName: 'Tahoe Vista',
      script:
        'Tahoe Vista sits up here at about six thousand two hundred feet, and yet it counts in with the Sacramento metro — a valley city way down low.',
      well: [
        'Tahoe Vista is at an elevation of 6,230 feet.',
        'Tahoe Vista is part of the Sacramento metropolitan area.',
      ],
      ...LT,
    },
    expect: { pass: true, ungrounded: [] },
    why: 'that Sacramento (a different, well-known place named only as a frame) is a low valley city is basic common knowledge — ambient; the elevation + metro membership are on the sheet.',
  },
  {
    id: 'grounding-general-knowledge-not-a-loophole',
    dimension: 'grounding',
    input: {
      seq: 13,
      stopType: 'story',
      placeName: 'Brougher Mansion',
      script: 'A Queen Anne has turrets and trim — and this one has the tallest turret in the whole state.',
      well: ['Brougher Mansion is a Queen Anne house.'],
      ...NV,
    },
    expect: { pass: false, ungrounded: ['tallest'] },
    why: 'the boundary: general STYLE knowledge is ambient, but a superlative about THIS place ("tallest turret in the state") is a checkable place-fact not on the sheet — the carve-out must never become a hallucination loophole.',
  },
  {
    id: 'grounding-naming-origin-ungrounded',
    dimension: 'grounding',
    input: {
      seq: 14,
      stopType: 'story',
      placeName: 'Tahoe Vista',
      script: 'Tahoe Vista — a fine name for a place named for its view.',
      well: ['Tahoe Vista is a census-designated place on the north shore.'],
      ...LT,
    },
    expect: { pass: false, ungrounded: ['view'] },
    why: 'a NAMING ORIGIN ("named for its view") is a specific historical claim about THIS place, not definition or category knowledge — stays ungrounded even though "vista" means view. Conservative boundary (2026-06-20).',
  },
]

// ⚠ `TTS_CASES` and `DIVERSITY_CASES` lived here until the 1.1 sweep (D26). They were dropped from the
// runner in 5ca12d3 and kept "as labeled fixtures" — but nothing imported them after that, so they
// were two hand-maintained case tables that could never fail and never ran. The GATE they belonged to
// is very much alive (`generate-narrations` is fail-closed on the eval panel); these were the part of
// it that had already been disconnected. Git is the archive if the runner ever wants them back.
