import { describe, expect, test } from 'bun:test'
import { buildIntroSheet, buildOutroSheet } from '../src/pipeline/narrate'

describe('frame sheets (intro/outro)', () => {
  test('intro frames destination + direction, position-agnostic, no place-fact, meet-your-host', () => {
    const sheet = buildIntroSheet({
      region: 'Lake Tahoe',
      startAnchor: 'Tahoe City',
      endAnchor: 'South Lake Tahoe',
      jokeLevel: 'dadpocalypse',
      headline: 'Emerald Bay',
      hostName: 'Skipper',
    })
    expect(sheet).toContain('FRAME: INTRO')
    expect(sheet).toContain('THIS DRIVE: Emerald Bay')
    expect(sheet).toContain('FROM: Tahoe City')
    expect(sheet).toContain('TO: South Lake Tahoe')
    expect(sheet).toContain('JOKE NOTCH: DADPOCALYPSE')
    expect(sheet).toContain('YOUR NAME: Skipper')
    expect(sheet).toMatch(/never "you are now at/i) // position-agnostic guard
    expect(sheet).toMatch(/no place-fact/i)
    expect(sheet).toContain('meet your host')
  })

  test('outro names the arrival anchor and houses the sign-off bow', () => {
    const sheet = buildOutroSheet({
      region: 'Lake Tahoe',
      endAnchor: 'South Lake Tahoe',
      jokeLevel: 'off',
    })
    expect(sheet).toContain('FRAME: OUTRO')
    expect(sheet).toContain('ARRIVING AT: South Lake Tahoe')
    expect(sheet).toContain('JOKE NOTCH: OFF')
    expect(sheet).toMatch(/sign-off|bow/i)
    expect(sheet).toMatch(/no place-fact/i)
  })

  test('optional fields are omitted cleanly', () => {
    const intro = buildIntroSheet({
      region: 'Lake Tahoe',
      startAnchor: 'Tahoe City',
      endAnchor: 'South Lake Tahoe',
      jokeLevel: 'dad',
    })
    expect(intro).not.toContain('THIS DRIVE:')
    expect(intro).not.toContain('YOUR NAME:')

    const outro = buildOutroSheet({ region: 'Lake Tahoe', endAnchor: 'Tahoe City', jokeLevel: 'mild' })
    expect(outro).not.toContain('INTRO HOOK')
  })
})
