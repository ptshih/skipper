import { StyleSheet, View } from 'react-native'
import { Stack } from 'expo-router'
import { space } from '@/theme/tokens'
import { Screen, Text, ThemeModePicker, voice } from '@/ui'

// Settings — the deliberate, parked-context home for preferences. First resident:
// Appearance (Auto / Day / Dusk). The mood control used to ride in every screen's
// header; it now lives here so a night drive just follows the phone (Auto) with no
// per-glance toggle in the chrome. Room to grow (joke level, voice) as M3 lands.
export default function SettingsScreen() {
  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: 'Settings' }} />

      <View style={styles.section}>
        <Text variant="label" color="inkFaint">
          {voice.settings.appearance}
        </Text>
        <ThemeModePicker />
        <Text variant="dim" color="inkFaint">
          {voice.settings.appearanceHint}
        </Text>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  section: { gap: space.sm },
})
