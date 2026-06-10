import { describe, expect, test } from 'bun:test'
import { compareVersions, versionResponse } from '@skipper/shared'
import { VERSION_POLICIES } from '../src/version-policy'

describe('VERSION_POLICIES', () => {
  test('covers both platforms', () => {
    const platforms = VERSION_POLICIES.map((p) => p.platform).sort()
    expect(platforms).toEqual(['android', 'ios'])
  })

  test('validates against the wire DTO', () => {
    expect(versionResponse.safeParse({ policies: VERSION_POLICIES }).success).toBe(true)
  })

  test('minimum is never above recommended', () => {
    for (const p of VERSION_POLICIES) {
      expect(compareVersions(p.minimum, p.recommended)).toBeLessThanOrEqual(0)
    }
  })
})
