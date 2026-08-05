/**
 * The words the APP says on the skipper's behalf, and the one rule that makes serving them worth it.
 *
 * ⚠ THE FAILURE THIS EXISTS FOR. Two of these lines are SEEDED into the transcript as the skipper's
 * own prior sentences and re-sent to the model on the next turn — in-context precedent, read as
 * something he already said. On 2026-08-04 one of them asked "About how long do you want to be out?"
 * for a day after the planner prompt was changed to forbid that ask. Nothing caught it: there was no
 * model turn to score, so the eval passed, and the copy lived in the app so deploying the prompt fixed
 * nothing. Moving it here makes the prompt and the words it governs deploy together. What it does NOT
 * do by itself is stop them disagreeing again — that is what the cross-check below is for.
 */
import { describe, expect, test } from 'bun:test'
import { plannerExample } from '@skipper/shared'
import { composeRegionCopy, PLANNER_COPY } from '../src/planner-copy'
import { PLANNER_SYSTEM_PROMPT } from '../src/planner-prompt'

const EIGHT = [
  'Tahoe City, California',
  'Emerald Bay, California',
  'Incline Village, Nevada',
  'Kings Beach, California',
  'Truckee, California',
  'Stateline, Nevada',
  'Carson City, Nevada',
  'Genoa, Nevada',
]

describe('composition — names in, finished sentences out', () => {
  test('NOTHING leaves with a placeholder in it', () => {
    // ⚠ THE WHOLE REASON COMPOSITION MOVED HERE. The first cut shipped `{a}`/`{b}` templates for the app
    // to fill, and the two sides disagreed about the budget on the first try: `toEnd` said
    // "Take me to {b}." against a one-name row, so the app's brace guard dropped the row and the chip
    // silently vanished. With the sentence finished here there is no budget to mismatch — and this is
    // the assertion that says so, across every region size rather than the one that happens to ship.
    for (let n = 0; n <= EIGHT.length; n++) {
      for (const rotation of [0, 1, 5, 37]) {
        for (const label of [null, 'Lake Tahoe']) {
          for (const e of composeRegionCopy(EIGHT.slice(0, n), label, rotation).examples) {
            expect(e.ask).not.toMatch(/\{[^}]*\}/)
            expect(() => plannerExample.parse(e)).not.toThrow()
          }
        }
      }
    }
  })

  test('a full region fills every shape and NO NAME IS SAID TWICE', () => {
    const { examples } = composeRegionCopy(EIGHT, 'Lake Tahoe', 0)
    expect(examples.map((e) => e.shape)).toEqual(['aToB', 'via', 'fromStart', 'toEnd', 'open'])
    // ⚠ Five rows share one name pool, so the complaint this rotation exists for — one town saying
    // itself in every slot — is one careless per-shape index away. Pinned as a property.
    const said = examples.flatMap((e) => EIGHT.map((raw) => raw.split(',')[0]!).filter((n) => e.ask.includes(n)))
    expect(said).toEqual([...new Set(said)])
  })

  test('names arrive CLEANED — a chip never says "Tahoe City, California"', () => {
    // The raw rows carry the Wikipedia/Google state suffix. Cleaning used to happen in the app; the
    // server has to produce the identical string now that it composes the sentence.
    for (const e of composeRegionCopy(EIGHT, null, 0).examples) expect(e.ask).not.toMatch(/,\s+(California|Nevada)/)
  })

  test('a shape it cannot afford is SKIPPED, not terminal', () => {
    // Three names cannot buy the three-name pass-through once A→B has taken two — but one is left, and
    // a single-ended row still renders. Stopping at the first unaffordable shape would strip a thin
    // region back to the open ask alone, which is the degradation that actually matters.
    expect(composeRegionCopy(EIGHT.slice(0, 3), null, 0).examples.map((e) => e.shape)).toEqual([
      'aToB',
      'fromStart',
      'open',
    ])
    expect(composeRegionCopy([], null, 0).examples.map((e) => e.shape)).toEqual(['open'])
  })

  test('the rotation reaches EVERY name, at every region size — not just at eight', () => {
    // ⚠ THE MULTI-REGION BUG THIS REPLACED. The stride was a fixed 3 with a note that it must stay
    // coprime with "the server's name count (8)" — but 8 is a MAXIMUM, and a region with fewer curated
    // places sends fewer. At 6 names a stride of 3 reaches only 2 of the 6 windows and at 3 names only
    // one, so the same town leads every launch: exactly the complaint the rotation was built to fix,
    // and invisible while one region existed that happened to have 8.
    for (let n = 1; n <= EIGHT.length; n++) {
      const leads = new Set(
        Array.from({ length: 60 }, (_, launch) => composeRegionCopy(EIGHT.slice(0, n), null, launch).names[0]),
      )
      expect(leads.size).toBe(n)
    }
  })

  test('a corrupt rotation counter reads as zero rather than blanking the screen', () => {
    // It arrives off the caller's disk. NaN indices would empty every row at once.
    const good = composeRegionCopy(EIGHT, null, 0)
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(composeRegionCopy(EIGHT, null, bad)).toEqual(good)
    }
  })

  test('no chip offers a LOOP — he may not offer a shape he cannot know the roads support', () => {
    // docs/decisions/no-same-road-loops.md §8: a loop is an explicit-ask exception, so a suggestion the
    // app authored makes that offer in his voice — the thing the prompt stops him doing himself.
    for (const e of composeRegionCopy(EIGHT, 'Lake Tahoe', 0).examples) {
      expect(e.ask.toLowerCase()).not.toContain('loop')
      expect(e.ask.toLowerCase()).not.toContain('back around')
      expect(e.title.toLowerCase()).not.toContain('loop')
    }
  })
})

describe('the seeded skipper lines agree with the prompt that governs them', () => {
  // ⚠ THIS IS THE POINT OF THE WHOLE MOVE. Serving the copy means the prompt and these lines deploy
  // together; it does not mean they AGREE. Only a check that reads both can say that, and this is the
  // only place both are importable.
  const SEEDED = [PLANNER_COPY.adjustSay, PLANNER_COPY.noStopsSay]

  test('none of them asks how long the rider wants to be out', () => {
    // The exact drift that shipped. The prompt states "You never ask how long they want to be out";
    // a seeded line doing it anyway is the app contradicting the prompt in the model's own voice.
    expect(PLANNER_SYSTEM_PROMPT).toContain('You never ask how long they want to be out')
    for (const line of SEEDED) {
      expect(line.toLowerCase()).not.toMatch(/how long/)
      expect(line.toLowerCase()).not.toMatch(/how much time/)
    }
  })

  test('none of them claims a distance, a duration or a road fact', () => {
    // He is given no map and says so. A seeded line quoting a number would be the app inventing the
    // one thing the character is written never to guess at.
    for (const line of SEEDED) {
      expect(line).not.toMatch(/\b\d+\s*(min|minute|hour|hr|mile|km|kilometre)/i)
    }
  })

  test('the adjust invitation still offers "shorter" — deliberately, and the prompt answers it', () => {
    // ⚠ READ BEFORE "FIXING" THIS. "longer, shorter" looks like the banned duration ask and is not: it
    // is founder-picked, because it is what riders actually want to say, and the prompt was taught to
    // answer it honestly rather than the copy being bent to hide the request. If this pair ever
    // disagrees, the prompt is what moved — the line is not the thing to change.
    expect(PLANNER_COPY.adjustSay).toContain('shorter')
    expect(PLANNER_SYSTEM_PROMPT).toContain('which end do you want to give up?')
  })
})
