import { useCallback, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import { Stack, useFocusEffect } from 'expo-router'
import { isAdmin, useSession } from '@/lib/auth'
import { useSimMode } from '@/lib/sim-mode'
import { deleteTrace, listTraces, shareTrace, type StoredTrace } from '@/lib/trace-export'
import { space } from '@/theme/tokens'
import { Button, Divider, Screen, SimModePicker, StateView, Text, voice } from '@/ui'

// Developer tools — simulated GPS + the recorded drive traces, reached from Settings → Developer. The
// entry row is shown ONLY to admins, and this screen self-guards too so a deep link
// (skipper://developer) can't slip a non-admin past the hidden row.
//
// Gate = isAdmin() (`role === 'admin'`, Better Auth admin plugin, server-set) — the same shared
// helper settings.tsx uses, so the hidden row and this self-guard can't drift. `role` is only
// 'admin' on the founder/allowlist, so an anonymous or plain free user can never satisfy it.
//
// ⚠ The traces list is the ONLY way a recorded drive leaves the phone, and traces are local-only by
// design (precise location data — see trace-recorder.ts). Nothing here uploads; sharing is an
// explicit tap into the system share sheet.
export default function DeveloperScreen() {
  const { data: session, isPending } = useSession()
  const { simMode, setSimMode } = useSimMode()
  const [traces, setTraces] = useState<StoredTrace[]>([])
  const [traceError, setTraceError] = useState<string | null>(null)

  // Re-read on focus rather than once on mount: the whole point is to come here straight after a
  // drive, and a list that still says "no traces yet" would read as the recorder having failed.
  useFocusEffect(
    useCallback(() => {
      setTraces(listTraces())
    }, []),
  )

  const onDelete = useCallback((name: string) => {
    Alert.alert(voice.settings.tracesDeleteConfirmTitle, voice.settings.tracesDeleteConfirmBody, [
      { text: voice.settings.tracesDeleteConfirmCancel, style: 'cancel' },
      {
        text: voice.settings.tracesDeleteConfirmOk,
        style: 'destructive',
        onPress: () => {
          setTraceError(deleteTrace(name) ? null : voice.settings.tracesDeleteFailed)
          setTraces(listTraces())
        },
      },
    ])
  }, [])

  if (isPending) {
    return (
      <StateView
        loading
        message={voice.settings.developerLoading}
        title={voice.settings.developerTitle}
      />
    )
  }
  if (!isAdmin(session)) {
    return (
      <StateView message={voice.settings.developerLocked} title={voice.settings.developerTitle} />
    )
  }

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: voice.settings.developerTitle }} />

      <Text variant="dim" color="inkFaint">
        {voice.settings.developerIntro}
      </Text>

      <View style={styles.section}>
        <Text variant="label" color="inkFaint">
          {voice.settings.simModeLabel}
        </Text>
        <SimModePicker value={simMode} onChange={setSimMode} />
        <Text variant="dim" color="inkFaint">
          {voice.settings.developerHint}
        </Text>
      </View>

      {/* ⚠ THE "RESET FIRST-TIME EXPERIENCE" SECTION WAS DELETED HERE (founder, 2026-08-05) together
          with the onboarding gate, `/sample` and `src/lib/client-flags.ts` — there is no once-per-
          install state left on this phone to reset. See docs/designs/onboarding-gate-reconsidered.md.
          ⚠ If a once-per-install surface is ever added back, it needs a dev reset like this one from
          the start: without it, re-checking that surface means deleting and reinstalling the app,
          which also throws away the drives, the downloads and the session. */}

      <View style={styles.section}>
        <Text variant="label" color="inkFaint">
          {voice.settings.tracesLabel}
        </Text>
        <Text variant="dim" color="inkFaint">
          {voice.settings.tracesHint}
        </Text>
        {traceError ? (
          <Text variant="dim" color="danger">
            {traceError}
          </Text>
        ) : null}
        {traces.length === 0 ? (
          <Text variant="dim" color="inkFaint">
            {voice.settings.tracesEmpty}
          </Text>
        ) : (
          traces.map((t, i) => (
            <View key={t.name}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.traceRow}>
                <View style={styles.traceMeta}>
                  <Text>{t.name}</Text>
                  <Text variant="dim" color="inkFaint">
                    {formatBytes(t.sizeBytes)}
                  </Text>
                </View>
                <View style={styles.traceActions}>
                  <Button
                    title={voice.settings.tracesShare}
                    accessibilityLabel={`${voice.settings.tracesShare} ${t.name}`}
                    variant="secondary"
                    fullWidth={false}
                    onPress={async () => {
                      setTraceError(
                        (await shareTrace(t.name)) ? null : voice.settings.tracesShareFailed,
                      )
                    }}
                  />
                  <Button
                    title={voice.settings.tracesDelete}
                    accessibilityLabel={`${voice.settings.tracesDelete} ${t.name}`}
                    variant="ghost"
                    fullWidth={false}
                    onPress={() => onDelete(t.name)}
                  />
                </View>
              </View>
            </View>
          ))
        )}
      </View>
    </Screen>
  )
}

/** Size is the one property that tells you at a glance whether a drive actually recorded anything. */
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  section: { gap: space.sm },
  traceRow: { gap: space.sm, paddingVertical: space.sm },
  traceMeta: { gap: space.xs },
  traceActions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
})
