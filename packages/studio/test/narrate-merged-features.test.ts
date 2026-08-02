// The FUSED block of the fact sheet — the nameable/background split and the ">=2 nameable" closer
// rule. Both are MEASURED fixes and neither had a test. With every member equally nameable the model
// chose by FACT RICHNESS and opened the first fused telling on a dropped supper club's 1930s dinner
// menu while never naming three of the five places the group is named for; and 11 of the first 31
// fused clips tail-collapsed (35% against ~2% on single-place clips, up to 14.4 dB under the body)
// because a many-subject telling reaches for a verbless summarising tally.
//
// A prompt's EFFECT can only be judged by ear, so what a test can hold is its STRUCTURE: which places
// the sheet asks for by name, in what order they are presented, and which closing shape is demanded.
// That is exactly the layer where a refactor silently undoes a fix that cost a paid run to find.

import { describe, expect, test } from 'bun:test'
import { buildFactSheet, type NarrationRequest } from '../src/pipeline/narrate'

type Feature = NonNullable<NarrationRequest['mergedFeatures']>[number]

const f = (name: string, background?: boolean): Feature => ({
  name,
  facts: [`${name} opened in nineteen twenty-nine.`],
  ...(background === undefined ? {} : { background }),
})

/** The live fused shape (generate-cluster-narrations): the cluster TITLE is the place, and every fact
 *  arrives through `mergedFeatures` — the request carries no `facts` of its own. */
const storySheet = (mergedFeatures: Feature[]) =>
  buildFactSheet({
    region: 'Lake Tahoe',
    stopType: 'story',
    place: { name: 'Emerald Bay' },
    mergedFeatures,
  })

const NAMEABLE = 'ALSO RIGHT HERE'
const RECOGNISE = 'the landmarks a driver would RECOGNISE'
const MAY_NAME = 'you MAY name each'
const BACKGROUND = 'BACKGROUND ONLY'
const FUSED_CLOSER = 'END ON ONE OF THEM'
const SOLO_CLOSER = 'END ON A FULL SENTENCE'

describe('buildFactSheet — the nameable/background split', () => {
  test('only the RECOGNISABLE places are asked for by name; the rest stay grounded but unnamed', () => {
    const sheet = storySheet([f('Vikingsholm'), f('Eagle Falls'), f('Tahoe Tavern Annex', true)])
    const split = sheet.indexOf(BACKGROUND)
    expect(split).toBeGreaterThan(-1)
    const named = sheet.slice(0, split)
    const background = sheet.slice(split)

    expect(named).toContain('• Vikingsholm:')
    expect(named).toContain('• Eagle Falls:')
    expect(named).not.toContain('• Tahoe Tavern Annex:')
    expect(background).toContain('• Tahoe Tavern Annex:')
    // The demoted place keeps its FACTS on the sheet. It is grounded, just not the subject — and the
    // grounding judge scores the script against this same well, so dropping the facts here would make
    // an allowed mention read as an invention.
    expect(background).toContain('    - Tahoe Tavern Annex opened in nineteen twenty-nine.')
  })

  test('the presence of a background place hardens the ask from "you MAY name" to "work every one in"', () => {
    // The asymmetry IS the fix. A flat list of equals is what let fact richness pick the opening.
    const flat = storySheet([f('Vikingsholm'), f('Eagle Falls')])
    expect(flat).toContain(MAY_NAME)
    expect(flat).not.toContain(RECOGNISE)

    const asymmetric = storySheet([f('Vikingsholm'), f('Eagle Falls'), f('Tahoe Tavern Annex', true)])
    expect(asymmetric).toContain(RECOGNISE)
    expect(asymmetric).toContain('work every one of them in')
    expect(asymmetric).not.toContain(MAY_NAME)
  })

  test('the recognisable block renders FIRST regardless of input order, and the closer sits inside it', () => {
    // Two orderings matter and this pins both. (1) A background place listed first must not be the
    // first thing the model reads about this stop. (2) "END ON ONE OF THEM" has to stay attached to
    // the named list — let the BACKGROUND block slide in between and "them" rebinds to the very
    // places the next paragraph says not to name.
    const sheet = storySheet([f('Tahoe Tavern Annex', true), f('Vikingsholm'), f('Eagle Falls')])
    const named = sheet.indexOf(NAMEABLE)
    const closer = sheet.indexOf(FUSED_CLOSER)
    const background = sheet.indexOf(BACKGROUND)
    expect(named).toBeGreaterThan(-1)
    expect(closer).toBeGreaterThan(named)
    expect(background).toBeGreaterThan(closer)
  })

  test('a feature with no facts is off the sheet entirely — an ungrounded name is not sayable', () => {
    const sheet = storySheet([f('Vikingsholm'), { name: 'Fannette Island', facts: [] }])
    expect(sheet).not.toContain('Fannette Island')
    // …and it does not count toward the two-nameable bar either: the rule is measured on how many
    // SUBJECTS the telling actually has, which is the post-filter count.
    expect(sheet).not.toContain(FUSED_CLOSER)
  })

  test('a SCENIC stop ignores mergedFeatures — merged facts are STORY-only by construction', () => {
    const sheet = buildFactSheet({
      region: 'Lake Tahoe',
      stopType: 'scenic',
      mergedFeatures: [f('Vikingsholm')],
    })
    expect(sheet).not.toContain('Vikingsholm')
  })
})

describe('buildFactSheet — the closer rule', () => {
  test('turns on at TWO nameable places, and counts NAMEABLE ones only', () => {
    // The boundary is where the measurement is: a single-place telling collapses at ~2%, so it must
    // not inherit the multi-subject rule. Counting the whole roster instead (a `fs.length >= 2`) would
    // fire on a one-subject telling that merely has texture around it.
    expect(storySheet([f('Vikingsholm'), f('Eagle Falls')])).toContain(FUSED_CLOSER)
    expect(
      storySheet([f('Vikingsholm'), f('Cabin A', true), f('Cabin B', true), f('Cabin C', true)]),
    ).not.toContain(FUSED_CLOSER)
  })

  test('the single-subject closer yields to the fused one — a story sheet never carries both', () => {
    // They ask for different things (end on ONE OF THEM vs end on A FULL SENTENCE) and both were added
    // for their own measured regression; handing the model both would leave it choosing between them.
    const fused = storySheet([f('Vikingsholm'), f('Eagle Falls')])
    expect(fused).toContain(FUSED_CLOSER)
    expect(fused).not.toContain(SOLO_CLOSER)

    const solo = buildFactSheet({
      region: 'Lake Tahoe',
      stopType: 'story',
      place: { name: 'Cave Rock' },
      facts: ['The rock is a volcanic plug, and the tunnel through it opened in nineteen thirty-one.'],
    })
    expect(solo).toContain(SOLO_CLOSER)
    expect(solo).not.toContain(FUSED_CLOSER)
  })

  // ⚠ REGRESSION GUARD for a real bug (fixed 2026-08-02). The single-subject closer was suppressed by
  // `!req.mergedFeatures?.length` — the RAW array — while the fused closer gates on the FILTERED
  // nameable count. Between those two conditions sat a live window in which a story sheet carried NO
  // closing-shape rule at all: any request whose mergedFeatures all filter out (no facts, or no name),
  // and any fused cluster narrowed to one nameable member. Both closers exist because their absence was
  // MEASURED at 21% / 35% tail collapse, so the window was the exact defect they were written to close —
  // and a collapsed tail is not free, it drives the billed synth retake loop. Both now key on
  // `nameableFeatures`, so the rules are exact complements: every story sheet carries EXACTLY one.
  test.each([
    ['a feature with no facts (filters out entirely)', [{ name: 'Fannette Island', facts: [] }]],
    ['a feature with no name (filters out entirely)', [{ name: '', facts: ['a fact'] }]],
    ['exactly ONE nameable feature', [{ name: 'Vikingsholm', facts: ['a castle'] }]],
    [
      'one nameable + background',
      [
        { name: 'Vikingsholm', facts: ['a castle'] },
        { name: 'Eagle Falls', facts: ['a waterfall'], background: true },
      ],
    ],
    [
      'ALL background',
      [
        { name: 'Vikingsholm', facts: ['a castle'], background: true },
        { name: 'Eagle Falls', facts: ['a waterfall'], background: true },
      ],
    ],
  ])('a story sheet with %s still carries a closing-shape rule', (_label, features) => {
    const sheet = storySheet(features)
    const solo = sheet.includes(SOLO_CLOSER)
    const fused = sheet.includes(FUSED_CLOSER)
    expect(solo || fused).toBe(true)
    expect(solo && fused).toBe(false) // exactly one, never both
  })

  test('two or more nameable features still get the FUSED closer, not the solo one', () => {
    const sheet = storySheet([
      { name: 'Vikingsholm', facts: ['a castle'] },
      { name: 'Eagle Falls', facts: ['a waterfall'] },
    ])
    expect(sheet).toContain(FUSED_CLOSER)
    expect(sheet).not.toContain(SOLO_CLOSER)
  })
})
