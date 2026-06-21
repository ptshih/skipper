import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { signOut, updateUser, useSession } from '@/lib/auth'
import { space } from '@/theme/tokens'
import { Button, Input, Screen, Text, ThemeModePicker, voice } from '@/ui'

// Settings — the deliberate, parked-context home for preferences + account. The home
// body stays 100% drive-focused, so identity ("Riding as …") and the rare/destructive
// Sign out live HERE, behind the home's gear, not in the front-door chrome. Appearance
// (Auto / Day / Dusk) follows. Room to grow (different narrators) as M4 lands.
export default function SettingsScreen() {
  const router = useRouter()
  const { data: session } = useSession()
  // Developer tools are admin-only. `role` is server-set (Better Auth admin plugin) and only
  // 'admin' on the founder/allowlist, so this excludes anonymous + plain free riders on its own.
  const isAdmin = session?.user?.role === 'admin'

  // Name is optional and lives HERE, not at sign-up. Seed the field from the saved
  // name and re-sync whenever it changes — a successful save pings $sessionSignal,
  // useSession refetches, and this effect flips the field back to "clean".
  const savedName = session?.user?.name ?? ''
  const [name, setName] = useState(savedName)
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  useEffect(() => {
    setName(session?.user?.name ?? '')
  }, [session?.user?.name])
  const nameDirty = name.trim() !== savedName.trim()

  const saveName = async () => {
    if (savingName || !nameDirty) return
    setSavingName(true)
    setNameError(null)
    try {
      const res = await updateUser({ name: name.trim() })
      if (res.error) setNameError(res.error.message ?? 'Could not save your name')
    } catch {
      setNameError(voice.error.generic)
    } finally {
      setSavingName(false)
    }
  }

  const handleSignOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      // signOut clears the local session first, so the UI flips to guest regardless — but a
      // network failure during the server call must be caught, or it's an unhandled rejection.
      await signOut()
    } catch {
      // Local session already cleared; nothing the rider needs to act on. Swallow quietly.
    } finally {
      setSigningOut(false)
    }
  }

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
              Riding as {savedName.trim() || session.user.email}
            </Text>
            <Input
              placeholder="Add your name"
              accessibilityLabel="Name"
              autoCapitalize="words"
              textContentType="name"
              autoComplete="name"
              returnKeyType="done"
              value={name}
              onChangeText={setName}
              onSubmitEditing={saveName}
            />
            {nameError ? (
              <Text variant="dim" color="danger">
                {nameError}
              </Text>
            ) : null}
            <Button
              variant="secondary"
              title="Save name"
              loading={savingName}
              disabled={!nameDirty}
              onPress={saveName}
            />
            <Button
              variant="secondary"
              title="Sign out"
              loading={signingOut}
              onPress={handleSignOut}
            />
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

      {isAdmin ? (
        <View style={styles.section}>
          <Text variant="label" color="inkFaint">
            {voice.settings.developer}
          </Text>
          <Button
            variant="secondary"
            title={voice.settings.developerAction}
            onPress={() => router.push('/developer')}
          />
        </View>
      ) : null}
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  section: { gap: space.sm },
})
