import { describe, expect, test } from 'bun:test'
import { lintScripts, type LintInput } from '../src/pipeline/lint'

const story = (seq: number, script: string): LintInput => ({ seq, stopType: 'story', script })
const lint = (stops: LintInput[]) => lintScripts(stops)

describe('lintScripts', () => {
  test('clean tour: distinct openers/closers, no stock phrases → no findings', () => {
    const findings = lint([
      story(0, 'The bay opens wide here. Sixty feet of the clearest water you ever saw.'),
      story(1, 'Vikingsholm sits in the trees. A castle somebody hauled across an ocean.'),
      story(2, 'A dam holds the lake. Six feet of it answers to one concrete wall.'),
    ])
    expect(findings).toEqual([])
  })

  test('flags a repeated stock phrase, keeping the first use', () => {
    const findings = lint([
      story(0, 'This is the one and only island the lake has. A rare thing.'),
      story(1, 'Down the shore runs the one and only ferry. It sails at dawn.'),
    ])
    expect(findings.map((f) => f.seq)).toEqual([1])
    expect(findings[0]!.avoid.join(' ')).toMatch(/one and only/i)
  })

  test('flags a duplicated closer signature', () => {
    const findings = lint([
      story(0, 'A long road climbs up the ridge. And the lake keeps its secrets.'),
      story(1, 'The old pier leans out over the cove. And the lake keeps its secrets.'),
    ])
    expect(findings.map((f) => f.seq)).toContain(1)
    expect(findings.find((f) => f.seq === 1)!.avoid.join(' ')).toMatch(/close differently/i)
  })

  test('flags a banned "here is the …" wind-up on first occurrence (not just repeats)', () => {
    const findings = lint([
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
    const findings = lint([
      story(0, 'Out across the water there is the lighthouse, the highest one in the country.'),
      story(1, 'Down the shore there is a campground now, where a grand resort once stood.'),
    ])
    expect(findings).toEqual([])
  })

  test('flags the "here\'s where it …" / "where it gets …" wind-up family', () => {
    const findings = lint([
      story(0, 'The resort filled up fast that summer. But here is where it gets fancy: they ran their own steamer.'),
      story(1, "A quiet village, mostly. Here's where it turns, though: the post office moved twice."),
      story(2, 'The pines lean over the cove, quiet as a held breath.'),
    ])
    expect(findings.map((f) => f.seq)).toContain(0)
    expect(findings.map((f) => f.seq)).toContain(1)
    expect(findings.map((f) => f.seq)).not.toContain(2)
  })

  // --- long-form (per-stop) detectors -------------------------------------

  test('flags tic-stacking: multiple wind-ups/AI tics in ONE stop', () => {
    const findings = lint([
      story(0, 'Fun fact, a captain ran this place. And get this, the maps once called it Yanks.'),
      story(1, 'The pines lean over the cove, quiet as a held breath.'),
    ])
    const f0 = findings.find((f) => f.seq === 0)!
    expect(f0.reasons.join(' ')).toMatch(/stacks \d+ wind-up/i)
    expect(f0.avoid.join(' ')).toMatch(/remove all/i)
    expect(findings.map((f) => f.seq)).not.toContain(1)
  })

  test('flags list/inventory shape: multiple enumerated sentences in one stop', () => {
    const findings = lint([
      story(0, 'A grand resort stood here. First, they cleared the pines. Next, they laid the foundation. Also, they built a long pier.'),
      story(1, 'The water turns the color of old glass right about here.'),
    ])
    const f0 = findings.find((f) => f.seq === 0)!
    expect(f0.reasons.join(' ')).toMatch(/reads like a list/i)
    expect(f0.avoid.join(' ')).toMatch(/weave/i)
    expect(findings.map((f) => f.seq)).not.toContain(1)
  })

  test('flags a tidy-bow / reflective recap closer', () => {
    const findings = lint([
      story(0, 'A castle went up here in the trees. Really, it is just one of the many stories this place has to tell.'),
      story(1, 'Sixty feet of clear water sits off the bow.'),
    ])
    const f0 = findings.find((f) => f.seq === 0)!
    expect(f0.reasons.join(' ')).toMatch(/tidy bow|reflective recap/i)
    expect(findings.map((f) => f.seq)).not.toContain(1)
  })

  test('flags within-stop self-repetition (a repeated content 4-gram)', () => {
    const findings = lint([
      story(0, 'The steamer hauled silver across mountains every morning, hauled silver across mountains every night, until the mine finally closed.'),
    ])
    const f0 = findings.find((f) => f.seq === 0)!
    expect(f0.reasons.join(' ')).toMatch(/repeats the phrase/i)
    expect(f0.avoid.join(' ')).toMatch(/do not repeat the phrase/i)
  })

  test('a clean long-form story stop produces no findings', () => {
    const findings = lint([
      story(
        0,
        'A woman built a stone house at the head of the bay in the twenties. She brought the masons over from across the ocean to lay it the old way, without a single nail. The roof grew wildflowers. Out on the island she kept a tiny teahouse you could only reach by boat.',
      ),
    ])
    expect(findings).toEqual([])
  })

  test('empty input → no findings', () => {
    expect(lint([])).toEqual([])
  })
})
