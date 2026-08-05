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
import { PLANNER_EXAMPLE_NAME_COST, plannerCopy } from '@skipper/shared'
import { PLANNER_COPY } from '../src/planner-copy'
import { PLANNER_SYSTEM_PROMPT } from '../src/planner-prompt'

describe('the payload', () => {
  test('satisfies the DTO the client parses it with', () => {
    // The client reads this through `plannerCopy`, whose fields all `.catch` to silence. So a shape
    // mismatch does not throw at a rider — it DEGRADES, quietly, to no suggestions at all. Parsing the
    // real constant here is what turns that silent failure into a red test.
    expect(() => plannerCopy.parse(PLANNER_COPY)).not.toThrow()
  })

  test('every example carries a rider line and a title, and no skipper prose', () => {
    for (const e of PLANNER_COPY.examples) {
      expect(e.ask.length).toBeGreaterThan(0)
      expect(e.title.length).toBeGreaterThan(0)
      // ⚠ THE REGRESSION GUARD. Each chip used to ship a hand-authored SKIPPER answer alongside the
      // rider's line, and that answer is what drifted. A `reply` (or any other skipper-voiced field)
      // reappearing on this type is the bug returning, so the absence is pinned rather than assumed.
      expect(Object.keys(e).sort()).toEqual(
        e.askRegion === undefined ? ['ask', 'shape', 'title'] : ['ask', 'askRegion', 'shape', 'title'],
      )
    }
  })

  test('only the open shape has a region form, and only it needs no place name', () => {
    // The client fills names by SHAPE, so these two facts are structural rather than cosmetic: a row
    // that suddenly needed `{r}` or stopped needing `{a}` would be filled wrong and silently.
    for (const e of PLANNER_COPY.examples) {
      if (e.shape === 'open') {
        expect(e.ask).not.toMatch(/\{[abc]\}/)
        expect(e.askRegion).toContain('{r}')
      } else {
        expect(e.ask).toMatch(/\{[abc]\}/)
        expect(e.askRegion).toBeUndefined()
      }
    }
  })

  test('every sentence uses exactly the tokens its name budget can fill', () => {
    // ⚠ THE SEAM THIS FILE EXISTS TO WATCH, and it has already bitten once. The server writes the
    // tokens; the client pours in PLANNER_EXAMPLE_NAME_COST names, positionally. Disagree and NOTHING
    // fails — the client's leftover-brace guard drops the row, so the chip silently stops appearing.
    // `toEnd` shipped as "Take me to {b}." against a one-name budget and vanished exactly that way.
    const TOKENS = ['{a}', '{b}', '{c}'] as const
    for (const e of PLANNER_COPY.examples) {
      const cost = PLANNER_EXAMPLE_NAME_COST[e.shape]
      const allowed = TOKENS.slice(0, cost)
      const banned = TOKENS.slice(cost)
      // Contiguous from {a}: a two-name row using {a} and {c} would leave {c} unfilled.
      for (const t of allowed) expect(e.ask).toContain(t)
      for (const t of banned) expect(e.ask).not.toContain(t)
    }
  })

  test('no chip offers a LOOP — he may not offer a shape he cannot know the roads support', () => {
    // docs/decisions/no-same-road-loops.md §8: a loop is an explicit-ask exception. A suggestion the
    // app authored makes that offer in his voice, which is the thing the prompt stops him doing
    // himself. The loop chip was removed once already; this is what stops it coming back as copy.
    for (const e of PLANNER_COPY.examples) {
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
