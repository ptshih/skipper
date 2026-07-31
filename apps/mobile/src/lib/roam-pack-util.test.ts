import { describe, expect, test } from 'bun:test'
import type { RoamPin } from '@skipper/shared'
import {
  clipFileName,
  packCoversPoint,
  playablePins,
  preferLocalUrls,
  stripUrl,
} from './roam-pack-util'

const pin = (poiId: string, over: Partial<RoamPin> = {}): RoamPin => ({
  poiId,
  name: `Pin ${poiId}`,
  lat: 39.0,
  lng: -120.0,
  durationMs: 90_000,
  url: `https://r2.example/${poiId}?sig=abc`,
  contentType: 'audio/mp4',
  ...over,
})

describe('stripUrl', () => {
  test('drops the presigned credential and keeps everything the engine needs', () => {
    const p = pin('a', {
      radiusM: 400,
      area: { ring: [[-120, 39], [-120.1, 39], [-120.1, 39.1]], marginM: 50 },
      attribution: [{ source: 'wikipedia', sourceId: 'Q1' }],
    })
    const saved = stripUrl(p)
    expect('url' in saved).toBe(false)
    expect(saved.poiId).toBe('a')
    expect(saved.radiusM).toBe(400)
    expect(saved.area?.marginM).toBe(50)
    expect(saved.attribution?.[0]?.sourceId).toBe('Q1')
    expect(saved.durationMs).toBe(90_000)
  })

  test('leaves the source pin untouched', () => {
    const p = pin('a')
    stripUrl(p)
    expect(p.url).toBe('https://r2.example/a?sig=abc')
  })
})

describe('clipFileName', () => {
  test('names by poiId with the extension the served contentType implies', () => {
    expect(clipFileName('abc', 'audio/mp4')).toBe('abc.m4a')
    expect(clipFileName('abc', 'audio/mpeg')).toBe('abc.mp3')
  })
})

describe('playablePins', () => {
  const saved = [stripUrl(pin('a')), stripUrl(pin('b')), stripUrl(pin('c'))]

  test('rebuilds file:// uris for the clips that landed', () => {
    const out = playablePins(saved, (id) => `file:///roam-pack/${id}.m4a`)
    expect(out).toHaveLength(3)
    expect(out[0]?.url).toBe('file:///roam-pack/a.m4a')
  })

  // The load-bearing one: an un-downloaded pin would fire its trigger and then stall for
  // CLIP_STALL_MS before being silently skipped — a sheet buffering forever over a dead zone.
  test('DROPS a pin whose audio never landed, rather than shipping a trigger with no sound', () => {
    const out = playablePins(saved, (id) => (id === 'b' ? null : `file:///roam-pack/${id}.m4a`))
    expect(out.map((p) => p.poiId)).toEqual(['a', 'c'])
  })

  test('an empty pack narrates nothing', () => {
    expect(playablePins(saved, () => null)).toEqual([])
  })
})

describe('preferLocalUrls', () => {
  test('swaps in local bytes where the pack has them and streams the rest', () => {
    const fresh = [pin('a'), pin('b')]
    const out = preferLocalUrls(fresh, (id) => (id === 'a' ? 'file:///roam-pack/a.m4a' : null))
    expect(out[0]?.url).toBe('file:///roam-pack/a.m4a')
    expect(out[1]?.url).toBe('https://r2.example/b?sig=abc')
  })

  test('keeps the FRESH metadata, not the pack copy — only the url is substituted', () => {
    const fresh = [pin('a', { name: 'Renamed', durationMs: 12_345 })]
    const out = preferLocalUrls(fresh, () => 'file:///roam-pack/a.m4a')
    expect(out[0]?.name).toBe('Renamed')
    expect(out[0]?.durationMs).toBe(12_345)
  })

  test('an empty pack leaves every pin streaming', () => {
    const fresh = [pin('a'), pin('b')]
    expect(preferLocalUrls(fresh, () => null)).toEqual(fresh)
  })
})

describe('packCoversPoint', () => {
  const anchor = { lat: 39.0968, lng: -120.0324 } // somewhere in the Tahoe basin

  test('a point inside the fetched circle is covered', () => {
    expect(packCoversPoint(anchor, 50, { lat: 39.15, lng: -120.1 })).toBe(true)
  })

  test('the anchor itself is covered', () => {
    expect(packCoversPoint(anchor, 50, anchor)).toBe(true)
  })

  test('another basin entirely is NOT covered (never promise pins from 200 km away)', () => {
    expect(packCoversPoint(anchor, 50, { lat: 37.7749, lng: -122.4194 })).toBe(false)
  })

  test('a nonsense radius never reads as covering anything', () => {
    expect(packCoversPoint(anchor, 0, anchor)).toBe(false)
    expect(packCoversPoint(anchor, -1, anchor)).toBe(false)
    expect(packCoversPoint(anchor, Number.NaN, anchor)).toBe(false)
  })
})
