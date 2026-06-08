import { StyleSheet, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { signOut, useSession } from '@/lib/auth'
import { space } from '@/theme/tokens'
import { Button, Screen, Text, ThemeModePicker, voice } from '@/ui'

// Settings — the deliberate, parked-context home for preferences + account. The home
// body stays 100% drive-focused, so identity ("Riding as …") and the rare/destructive
// Sign out live HERE, behind the home's gear, not in the front-door chrome. Appearance
// (Auto / Day / Dusk) follows. Room to grow (joke level, voice) as M3 lands.
export default function SettingsScreen() {
  const router = useRouter()
  const { data: session } = useSession()

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: 'Settings' }} />

      <View style={styles.section}>
        <Text variant="label" color="inkFaint">
          {voice.settings.account}
        </Text>
        {session ? (
          <>
            <Text variant="dim" color="inkFaint" numberOfLines={1}>
              Riding as {session.user.email}
            </Text>
            <Button variant="secondary" title="Sign out" onPress={() => signOut()} />
          </>
        ) : (
          <>
            <Text variant="dim" color="inkFaint">
              {voice.guest}
            </Text>
            <Button
              variant="secondary"
              title="Sign in"
              onPress={() => router.push('/sign-in')}
            />
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text variant="label" color="inkFaint">
          {voice.settings.appearance}
        </Text>
        <ThemeModePicker />
        <Text variant="dim" color="inkFaint">
          {voice.settings.appearanceHint}
        </Text>
      </View>

      <View style={styles.section}>
        <Text variant="label" color="inkFaint">
          {voice.settings.credits}
        </Text>
        <Button
          variant="secondary"
          title={voice.settings.creditsAction}
          onPress={() => router.push('/legal')}
        />
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  section: { gap: space.sm },
})
