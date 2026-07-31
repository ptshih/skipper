import { describe, expect, test } from 'bun:test'
import { isOfflineSnapshot } from './connectivity-util'

describe('isOfflineSnapshot', () => {
  test('an explicit disconnect reads OFFLINE', () => {
    expect(isOfflineSnapshot({ isConnected: false, isInternetReachable: false })).toBe(true)
  })

  test('connected + reachable reads ONLINE', () => {
    expect(isOfflineSnapshot({ isConnected: true, isInternetReachable: true })).toBe(false)
  })

  test('connected but unreachable (a captive portal) reads OFFLINE', () => {
    // Android-only in practice; on iOS the two fields are the same value.
    expect(isOfflineSnapshot({ isConnected: true, isInternetReachable: false })).toBe(true)
  })

  // The whole safety property: anything we did not explicitly observe as `false` must read ONLINE.
  // A false OFFLINE verdict short-circuits every request in the app; a false ONLINE only costs the
  // request timeout we already pay today.
  test('an unobserved snapshot reads ONLINE (unknown is never offline)', () => {
    expect(isOfflineSnapshot(null)).toBe(false)
    expect(isOfflineSnapshot(undefined)).toBe(false)
    expect(isOfflineSnapshot({})).toBe(false)
  })

  test('a partially-reported snapshot reads ONLINE unless a field is explicitly false', () => {
    expect(isOfflineSnapshot({ isConnected: true })).toBe(false)
    expect(isOfflineSnapshot({ isInternetReachable: true })).toBe(false)
    expect(isOfflineSnapshot({ isConnected: false })).toBe(true)
    expect(isOfflineSnapshot({ isInternetReachable: false })).toBe(true)
  })
})
