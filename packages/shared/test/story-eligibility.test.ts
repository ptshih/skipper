import { describe, expect, test } from 'bun:test'
import { STORY_TASTE_DENYLIST, classifyStoryEligibility } from '../src/story-eligibility'

describe('STORY_TASTE_DENYLIST', () => {
  // Violent / personal crime — a joke-forward persona can't carry these. MUST be gated.
  test.each([
    'Kidnapping of Jaycee Dugard', // the canonical first-basin leak
    '2011 Carson City IHOP shooting', // "shooting" — the case the gate used to miss
    'Murder of Mary Phagan',
    'Stabbing of someone',
    'Homicide investigation',
    'Lynching in the West',
    'Manslaughter case',
    '2017 Las Vegas mass shooting',
    'Serial killer of the Sierra',
    'Execution of a prisoner',
  ])('denies %j', (title) => {
    expect(STORY_TASTE_DENYLIST.test(title)).toBe(true)
  })

  // Carve-out: historical / civic / natural tragedy + benign POIs the persona PLAYS STRAIGHT.
  // These must NOT be gated (silence on a charming stop is the failure here).
  test.each([
    'Donner Party', // iconic regional history — must stay narratable
    'Great Fire of 1879', // wildfire — civic tragedy, play straight
    'SS Tahoe shipwreck', // shipwreck — play straight
    '1914 Reno earthquakes', // natural — play straight
    'Carson City Shooting Range', // benign POI — the `(?! range)` guard
    'Grapevine Canyon', // contains "rape" — the `\brape\b` guard
    'Emerald Bay', // ordinary place
    'Cave Rock',
    'Virginia City gunfight', // wild-west lore (titled "gunfight", not "shooting/shootout")
  ])('allows %j', (title) => {
    expect(STORY_TASTE_DENYLIST.test(title)).toBe(false)
  })
})

describe('classifyStoryEligibility', () => {
  // A POI property — the same verdict whether the consumer is a tour or a roam encounter.
  // leadExtractChars is the measured `facts.extract` length, which is the FULL article now.
  const base = { source: 'wikipedia', name: 'Emerald Bay', leadExtractChars: 1200 }

  test('eligible when a wikipedia place passes every gate', () => {
    expect(classifyStoryEligibility(base)).toBe('eligible')
  })
  test('filtered-source for a non-wikipedia (scenic) pin', () => {
    expect(classifyStoryEligibility({ ...base, source: 'wikidata' })).toBe('filtered-source')
  })
  test('filtered-taste takes precedence over the stub check', () => {
    expect(classifyStoryEligibility({ ...base, name: 'IHOP shooting', leadExtractChars: 0 })).toBe('filtered-taste')
  })
  test('a short-but-present article is ELIGIBLE — the enricher decides, not a char floor', () => {
    // The 800-char floor was removed 2026-06-16: any wikipedia article with text is enrichable.
    expect(classifyStoryEligibility({ ...base, leadExtractChars: 120 })).toBe('eligible')
    expect(classifyStoryEligibility({ ...base, leadExtractChars: 799 })).toBe('eligible')
  })
  test('filtered-stub ONLY when there is no article text to enrich (empty extract)', () => {
    expect(classifyStoryEligibility({ ...base, leadExtractChars: 0 })).toBe('filtered-stub')
  })
})
