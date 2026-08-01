import { StyleSheet, View } from 'react-native'
import { Stack } from 'expo-router'
import { isAdmin, useSession } from '@/lib/auth'
import { useSimMode } from '@/lib/sim-mode'
import { space } from '@/theme/tokens'
import { Screen, SimModePicker, StateView, Text, voice } from '@/ui'

// Developer tools — simulated GPS, reached from Settings → Developer. The entry row is shown ONLY to admins, and this screen self-guards too so a
// deep link (skipper://developer) can't slip a non-admin past the hidden row.
//
// Gate = isAdmin() (`role === 'admin'`, Better Auth admin plugin, server-set) — the same shared
// helper settings.tsx uses, so the hidden row and this self-guard can't drift. `role` is only
// 'admin' on the founder/allowlist, so an anonymous or plain free user can never satisfy it.
export default function DeveloperScreen() {
  const { data: session, isPending } = useSession()
  const { simMode, setSimMode } = useSimMode()

  if (isPending) {
    return <StateView loading message={voice.settings.developerLoading} title={voice.settings.developerTitle} />
  }
  if (!isAdmin(session)) {
    return <StateView message={voice.settings.developerLocked} title={voice.settings.developerTitle} />
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
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  section: { gap: space.sm },
})
