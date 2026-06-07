import { describe, expect, test } from 'bun:test'
import { lintScripts, type LintInput } from '../src/pipeline/lint'

const story = (seq: number, script: string): LintInput => ({ seq, stopType: 'story', script })

describe('lintScripts', () => {
  test('clean tour: distinct openers/closers, no kit, no stock phrases → no findings', () => {
    const findings = lintScripts([
      story(0, 'The bay opens wide here. Sixty feet of the clearest water you ever saw.'),
      story(1, 'Vikingsholm sits in the trees. A castle somebody hauled across an ocean.'),
      story(2, 'A dam holds the lake. Six feet of it answers to one concrete wall.'),
    ])
    expect(findings).toEqual([])
  })

  test('flags the second stop that CLOSES on the personal kit', () => {
    const findings = lintScripts([
      story(0, 'The lake runs deep here. Meanwhile my dock guy is still coming Tuesday.'),
      story(1, 'A fine old road climbs up. Even my cousin Ray would have stayed home.'),
      story(2, 'The pines lean over the water, quiet as anything.'),
    ])
    const seqs = findings.map((f) => f.seq)
    expect(seqs).toContain(1) // second kit-closer flagged
    expect(seqs).not.toContain(2) // clean stop untouched
    const f1 = findings.find((f) => f.seq === 1)!
    expect(f1.avoid.join(' ')).toMatch(/personal kit/i)
  })

  test('flags over-budget kit usage (more than floor(n/3) stops touch the kit)', () => {
    // 3 stops, all mid-script kit → budget 1 → 2 flagged.
    const findings = lintScripts([
      story(0, 'My coffee opinions aside, this water is a remarkable blue today.'),
      story(1, 'The engine and I disagree, but the cove ahead is worth the trip.'),
      story(2, 'Ray says hello. The old pier here has stood a hundred winters.'),
    ])
    expect(findings.length).toBeGreaterThanOrEqual(2)
  })

  test('flags a repeated stock phrase, keeping the first use', () => {
    const findings = lintScripts([
      story(0, 'This is the one and only island the lake has. A rare thing.'),
      story(1, 'Down the shore runs the one and only ferry. It sails at dawn.'),
    ])
    expect(findings.map((f) => f.seq)).toEqual([1])
    expect(findings[0]!.avoid.join(' ')).toMatch(/one and only/i)
  })

  test('flags a duplicated closer signature', () => {
    const findings = lintScripts([
      story(0, 'A long road climbs up the ridge. And the lake keeps its secrets.'),
      story(1, 'The old pier leans out over the cove. And the lake keeps its secrets.'),
    ])
    expect(findings.map((f) => f.seq)).toContain(1)
    expect(findings.find((f) => f.seq === 1)!.avoid.join(' ')).toMatch(/close differently/i)
  })

  test('flags a banned "here is the …" wind-up on first occurrence (not just repeats)', () => {
    const findings = lintScripts([
      story(0, 'A captain ran this place. But here is the fun of it: the maps once called it Yanks.'),
      story(1, 'The dam holds the lake. Here is the thing it does, though: it manages the top six feet.'),
      story(2, 'The pines lean over the cove, quiet as a held breath.'),
    ])
    expect(findings.map((f) => f.seq)).toContain(0) // single occurrence still flagged
    expect(findings.map((f) => f.seq)).toContain(1)
    expect(findings.map((f) => f.seq)).not.toContain(2)
    expect(findings.find((f) => f.seq === 0)!.avoid.join(' ')).toMatch(/here is the/i)
  })

  test('does NOT flag legitimate "there is the …" pointing', () => {
    const findings = lintScripts([
      story(0, 'Out across the water there is the lighthouse, the highest one in the country.'),
      story(1, 'Down the shore there is a campground now, where a grand resort once stood.'),
    ])
    expect(findings).toEqual([])
  })

  test('empty input → no findings', () => {
    expect(lintScripts([])).toEqual([])
  })
})
