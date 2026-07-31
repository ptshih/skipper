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

  // The `hard` count is the contract optimize()'s HARD_ADVISORY_WEIGHT depends on — a banned tic is
  // per-clip and fixable, a shared phrase is a corpus-level source problem, and they must not weigh
  // the same. Reported as a count so the consumer never has to parse the reason prose.
  test('reports banned tics as HARD, and ordinary cross-stop findings as not', () => {
    const findings = lint([
      story(0, 'A captain ran this place. But here is the fun of it: the maps once called it Yanks.'),
      story(1, 'The pines lean over the cove. The whole works sits quiet under the snow.'),
      story(2, 'A mill stood here once. The whole works burned in a single afternoon.'),
    ])
    const banned = findings.find((f) => f.seq === 0)!
    expect(banned.hard).toBeGreaterThan(0)
    // Stop 2 reuses a stock phrase — flagged, but not HARD.
    const reuse = findings.find((f) => f.seq === 2)
    expect(reuse).toBeDefined()
    expect(reuse!.hard).toBe(0)
  })

  test('a clean stop produces no finding at all (so `hard` has nothing to report)', () => {
    const findings = lint([story(0, 'The pines lean over the cove, quiet as a held breath.')])
    expect(findings).toEqual([])
  })

  // "The card" is the prompt's internal word for the fact sheet — meaningless to a rider. The
  // subtlety is that this is a casino region, so cards are legitimate SUBJECT matter; the leak is
  // always "the/my card" singular, real usage is "a card" or "cards". Measured over all 458 scripted
  // clips: 18 leaks caught, 15 genuine mentions untouched.
  describe('the fact sheet named out loud', () => {
    test('flags the Skipper referring to his own card', () => {
      for (const script of [
        'Late Cretaceous, the card tells me. Somewhere between sixty-six million and a hundred.',
        'That is the whole card, folks. A racing series, real horses, real distance.',
        'Described, and I am quoting the card here, as a man of great enterprise.',
        'That is most of what is on my card for this one.',
        'You would never believe it if it were not on the card.',
      ]) {
        expect(lint([story(0, script)]).length).toBeGreaterThan(0)
      }
    })

    test('does NOT flag cards as real subject matter', () => {
      for (const script of [
        'Six tries, six answers. Pick a card, any card. The fellow who finally made it stuck.',
        'It has been dealing cards longer than any other casino on this street.',
        'This one hands you a calling card, and you tip your hat and roll on.',
        'More aliases than a card shark, and every one of them on a lease somewhere.',
        'All-night card games with the door propped open and nobody counting.',
      ]) {
        expect(lint([story(0, script)])).toEqual([])
      }
    })

    test('it is a HARD finding — per-clip and fixable, like the other banned tics', () => {
      const f = lint([story(0, 'Late Victorian, the card tells me, which is the fancy kind.')])
      expect(f[0]!.hard).toBeGreaterThan(0)
    })
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

// Added 2026-07-30 after measuring the released corpus: the pre-existing cross-stop rules flagged only
// 16 of 451 clips, while an n-gram sweep found one NRHP phrase in 67 and a granite age range in 20.
// STOCK_PHRASES is hand-written, so it can only ever catch repetition somebody predicted — and
// co-located POIs converge on wording nobody does, because they are handed the same source facts.
describe('lintScripts — shared content n-grams (repetition nobody predicted)', () => {
  const NRHP = 'it landed on the national register of historic places back in nineteen seventy two'
  const carriers = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      story(i, `A house of some note stands along this road, and ${NRHP}. Number ${i} of them, anyway.`),
    )

  test('a phrase shared by enough clips flags everyone EXCEPT the first to use it', () => {
    const findings = lint(carriers(5))
    const flagged = findings.filter((f) => f.reasons.some((r) => /shares the phrase/.test(r)))
    expect(flagged.map((f) => f.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]) // seq 0 kept
  })

  test('below the threshold it stays quiet — an occasional echo is not a habit', () => {
    const findings = lint(carriers(3)) // < SHARED_NGRAM_MIN_CLIPS
    expect(findings.some((f) => f.reasons.some((r) => /shares the phrase/.test(r)))).toBe(false)
  })

  test('⚠ the avoid note targets the WORDING and explicitly preserves the FACT', () => {
    // A note that reads as "stop mentioning the National Register" would trade grounding for variety —
    // the one trade this project never makes. The gate would then pass a clip that dropped a true claim.
    const f = lint(carriers(5)).find((x) => x.seq === 4)!
    const note = f.avoid.join(' ')
    expect(note).toMatch(/keep the fact/i)
    expect(note).toMatch(/your own way to say it/i)
  })

  test('overlapping windows of ONE phrase collapse to a single complaint', () => {
    // "on the national register of historic" and "the national register of historic places" are the
    // same grievance slid by a word; without the overlap guard every window would file its own note.
    const f = lint(carriers(6)).find((x) => x.seq === 5)!
    const shared = f.reasons.filter((r) => /shares the phrase/.test(r))
    expect(shared.length).toBeLessThanOrEqual(3)
  })

  test('a run of pure filler is not a phrase', () => {
    // Every word of the shared span is in FILLER, so no window clears the substance bar. Without that
    // bar, function-word runs — which every telling shares — would swamp the real findings.
    const tails = ['A mill ground grain.', 'A ferry crossed.', 'A hotel burned.', 'A dam holds.', 'A school stood.', 'A church rang.']
    const findings = lint(tails.map((t, i) => story(i, `Well now, and so it is up there on the out here just that. ${t}`)))
    expect(findings.some((f) => f.reasons.some((r) => /shares the phrase/.test(r)))).toBe(false)
  })
})

describe('lintScripts — opener SHAPE (the exact 4-word key under-counts)', () => {
  // Measured: "right about here…" opens 20 released clips and "here is a…" opens 25, yet the exact key
  // read "right about here" / "right about you are" / "right about once stood" as three unrelated
  // openers and found 2 collisions in the whole corpus.
  const openers = [
    'Right about here the road bends past an old mill that ground grain for the valley.',
    'Right about now you are passing a schoolhouse that served nine families for forty years.',
    'Right about there the ferry landing stood before the ice took it one hard winter.',
    'Right about where that fence runs, a hotel burned down twice and came back once.',
  ]

  test('a third clip sharing an opener shape is flagged; the first two ride free', () => {
    const findings = lint(openers.map((s, i) => story(i, s)))
    const flagged = findings.filter((f) => f.reasons.some((r) => /worn shape/.test(r))).map((f) => f.seq)
    expect(flagged).toEqual([2, 3]) // OPENER_SHAPE_MIN_PRIOR = 2
  })

  test('these SAME clips slip past the exact 4-word key — which is why the shape rule exists', () => {
    const findings = lint(openers.map((s, i) => story(i, s)))
    expect(findings.some((f) => f.reasons.some((r) => /opens like stop/.test(r)))).toBe(false)
  })

  test('distinct openers stay clean', () => {
    const findings = lint([
      story(0, 'The bay opens wide here, sixty feet of the clearest water you ever saw.'),
      story(1, 'Vikingsholm sits back in the trees, a castle somebody hauled across an ocean.'),
      story(2, 'A dam holds this lake, six feet of it answering to one concrete wall.'),
    ])
    expect(findings.some((f) => f.reasons.some((r) => /worn shape/.test(r)))).toBe(false)
  })
})
