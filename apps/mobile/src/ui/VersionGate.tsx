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
import Constants from 'expo-constants'
import * as Linking from 'expo-linking'
import * as SecureStore from 'expo-secure-store'
import { gateFor, type GateDecision, type VersionPolicy } from '@skipper/shared'
import { getVersion } from '@/lib/api'
import { Button } from './Button'
import { Screen } from './Screen'
import { Text } from './Text'

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
      const current = Constants.expoConfig?.version
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
    const current = Constants.expoConfig?.version
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
