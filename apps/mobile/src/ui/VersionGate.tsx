// The launch-time app-update gate. On mount it asks the server for the per-platform
// version policy (GET /version) and compares THIS app's version:
//   below `minimum`     → a BLOCKING "update required" wall (no dismiss)
//   below `recommended` → a DISMISSIBLE "update available" nudge (persisted per version,
//                         so it doesn't nag on every cold start)
// Fail-open by design: any unreachable API / parse error shows NO gate — a network blip
// must never wall a rider. Plain, conventional update copy (NOT the Skipper persona — a
// forced update is a utility moment, clarity over charm). Mounted once at the app root,
// above the navigator, so the wall covers everything.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform, StyleSheet, View } from 'react-native'
import * as Linking from 'expo-linking'
import * as SecureStore from 'expo-secure-store'
import { gateFor, type GateDecision, type VersionPolicy } from '@skipper/shared'
import { getVersion } from '@/lib/api'
import { Button } from './Button'
import { Screen } from './Screen'
import { Text } from './Text'
import Constants from 'expo-constants'

/**
 * This build's semver, single-sourced from `app.json`'s `expo.version`.
 *
 * ⚠ `Constants.expoConfig`, NOT `Application.nativeApplicationVersion`, and the difference is not
 * cosmetic. expoConfig resolves to the app config attached to the JS bundle that is actually running
 * (for an EAS Update it is the published manifest's, falling back to the embedded config only on an
 * embedded launch); nativeApplicationVersion is `CFBundleShortVersionString` — the store BINARY's
 * version, which an OTA update cannot change. Capabilities live in the JS, so the JS bundle's own
 * version is the honest answer.
 *
 * There is no `expo-updates` in the project today, so the two would agree — which is precisely why
 * this comment exists: the wrong choice would not fail until OTA lands, and would then quietly report
 * a stale version for a bundle with newer JS. (Reaching for nativeApplicationVersion also means
 * adding `expo-application`, i.e. a new native dep and a native rebuild.)
 *
 * Can be undefined — `Constants.expoConfig` is nullable and VersionGate already fails open on it.
 */
export const APP_VERSION: string | undefined = Constants.expoConfig?.version

type Gate = Exclude<GateDecision, 'ok'> // 'nudge' | 'force'

const DISMISS_KEY = 'skipper.updateNudgeDismissed'

const COPY: Record<Gate, { title: string; body: string }> = {
  force: {
    title: 'Update required',
    body: 'A new version of Skipper is required to keep going.',
  },
  nudge: {
    title: 'Update available',
    body: 'A new version of Skipper is available.',
  },
}

export function VersionGate() {
  const [gate, setGate] = useState<Gate | null>(null)
  // Hold the resolved policy in a ref so the store-open callback stays stable.
  const policyRef = useRef<VersionPolicy | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const current = APP_VERSION
      if (!current) return // no version to compare against → fail-open
      try {
        const policies = await getVersion()
        const policy = policies.find((p) => p.platform === Platform.OS)
        if (!policy || cancelled) return
        policyRef.current = policy
        const decision = gateFor(current, policy)
        if (decision === 'force') {
          setGate('force')
        } else if (decision === 'nudge') {
          const dismissed = await SecureStore.getItemAsync(DISMISS_KEY).catch(() => null)
          if (!cancelled && dismissed !== current) setGate('nudge')
        }
      } catch {
        // Fail-open: an unreachable API or a parse error never walls the app here.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const openStore = useCallback(() => {
    const url = policyRef.current?.storeUrl
    if (url) Linking.openURL(url).catch(() => {})
  }, [])

  const dismiss = useCallback(() => {
    const current = APP_VERSION
    if (current) SecureStore.setItemAsync(DISMISS_KEY, current).catch(() => {})
    setGate(null)
  }, [])

  if (!gate) return null
  const copy = COPY[gate]

  return (
    <View style={StyleSheet.absoluteFill}>
      <Screen scroll center>
        <Text variant="placardTitle" color="ink" align="center">
          {copy.title}
        </Text>
        <Text variant="body" color="inkDim" align="center">
          {copy.body}
        </Text>
        <Button title="Update" onPress={openStore} />
        {gate === 'nudge' ? <Button variant="ghost" title="Later" onPress={dismiss} /> : null}
      </Screen>
    </View>
  )
}
