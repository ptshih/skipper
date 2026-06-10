import { describe, expect, test } from 'bun:test'
import { APPLE_APP_SITE_ASSOCIATION, IOS_APP_ID, shareLandingHtml } from '../src/share'

describe('APPLE_APP_SITE_ASSOCIATION', () => {
  test('uses the modern appIDs + components form (not the legacy appID + paths)', () => {
    const detail = APPLE_APP_SITE_ASSOCIATION.applinks.details[0]!
    expect(Array.isArray(detail.appIDs)).toBe(true)
    expect(Array.isArray(detail.components)).toBe(true)
    // On iOS 13+ a stray legacy `paths` next to `components` is silently IGNORED — the legacy
    // keys must be absent so we never half-adopt the old form.
    expect('paths' in detail).toBe(false)
    expect('appID' in detail).toBe(false)
    expect('apps' in APPLE_APP_SITE_ASSOCIATION.applinks).toBe(false)
  })

  test('appID is <10-char Team ID>.<bundle id> and is the one listed', () => {
    expect(IOS_APP_ID).toBe('L24UJYJ5DK.fm.skipper.app')
    expect(IOS_APP_ID).toMatch(/^[A-Z0-9]{10}\.[a-z0-9.]+$/)
    expect(APPLE_APP_SITE_ASSOCIATION.applinks.details[0]!.appIDs).toContain(IOS_APP_ID)
  })

  test('claims exactly the /t/* share path', () => {
    expect(APPLE_APP_SITE_ASSOCIATION.applinks.details[0]!.components[0]!['/']).toBe('/t/*')
  })
})

describe('shareLandingHtml', () => {
  test('embeds the tour title + description for the Open Graph unfurl', () => {
    const html = shareLandingHtml({
      title: 'Emerald Bay',
      description: 'A glacial jewel.',
      url: 'https://skipper.fm/t/abc',
    })
    expect(html).toContain('<title>Emerald Bay · Skipper</title>')
    expect(html).toContain('property="og:title" content="Emerald Bay"')
    expect(html).toContain('property="og:description" content="A glacial jewel."')
    expect(html).toContain('property="og:url" content="https://skipper.fm/t/abc"')
  })

  test('escapes HTML so a title cannot break out of an attribute or inject markup', () => {
    const html = shareLandingHtml({
      title: 'A & B <script>alert("x")</script>',
      description: "it's <b>bold</b>",
      url: 'https://skipper.fm/t/x',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&amp;')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;')
    expect(html).toContain('&#39;')
  })
})
