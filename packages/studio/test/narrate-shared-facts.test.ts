import { describe, expect, test } from 'bun:test'
import { buildFactSheet } from '../src/pipeline/narrate'

// A fact the model cannot tell apart from a good one without being told. Measured on the live corpus:
// ONE Macrostrat map unit hands 24 Tahoe pois this byte-identical pair, and the carriers are not thin
// cards (most have 3-5 other facts) — so the model was choosing it 24 times, blind.
const GRANITE = 'This rock unit dates to the Late Cretaceous — roughly 66 to 101 million years old.'
const UNIQUE = 'The lodge burned down in nineteen fifty-five and was never rebuilt.'

const req = (sharedFacts?: Record<string, number>) => ({
  region: 'Lake Tahoe',
  stopType: 'story' as const,
  place: { name: 'Maggies Peaks', kind: 'mountain' },
  facts: [UNIQUE, GRANITE],
  ...(sharedFacts ? { sharedFacts } : {}),
})

describe('buildFactSheet — SHARED fact marking', () => {
  test('marks a shared line with its carrier count and adds the demotion note', () => {
    const sheet = buildFactSheet(req({ [GRANITE]: 23 }))
    expect(sheet).toContain('[SHARED — 23 other places near here carry this exact line]')
    expect(sheet).toMatch(/never open on it, never close on it/)
    // …and the unique fact is left completely alone.
    expect(sheet).toContain(`- ${UNIQUE}`)
    expect(sheet).not.toMatch(new RegExp(`- ${UNIQUE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\[SHARED`))
  })

  test('no sharedFacts ⇒ byte-identical to the old rendering (the default must not change)', () => {
    const before = buildFactSheet(req())
    const withEmpty = buildFactSheet(req({}))
    expect(before).toBe(withEmpty)
    expect(before).not.toContain('SHARED')
  })

  test('a fact below the caller threshold is simply absent from the map, so it renders plain', () => {
    // The generator filters before passing; the renderer marks exactly what it is handed.
    const sheet = buildFactSheet(req({}))
    expect(sheet).toContain(`- ${GRANITE}`)
    expect(sheet).not.toContain('SHARED')
  })

  test('the note appears once, not once per shared line', () => {
    const sheet = buildFactSheet(req({ [GRANITE]: 23, [UNIQUE]: 7 }))
    expect(sheet.match(/REGIONAL character/g)?.length).toBe(1)
  })
})
