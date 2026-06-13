import { useRef, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { signIn, signUp } from '@/lib/auth'
import { space } from '@/theme/tokens'
import { Button, Input, Screen, Text, voice } from '@/ui'

// Email/password sign-in + sign-up. (Google/Apple are wired server-side and turn
// on once their OAuth creds are set; add provider buttons here when they are.)
export default function SignInScreen() {
  const router = useRouter()
  // The free-ticket AccountGate links here to CREATE an account (?mode=up); the
  // header/settings "Sign in" links omit the param and land on sign-in ('in').
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>()
  const [mode, setMode] = useState<'in' | 'up'>(modeParam === 'up' ? 'up' : 'in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Chain the soft keyboard's return key through the form (email → password → submit)
  // so a rider never has to dismiss it to reach the next field or the CTA. (Name is
  // NOT collected at sign-up — it's an optional field in Settings after signing in.)
  const passwordRef = useRef<TextInput>(null)

  const submit = async () => {
    if (busy) return // guard the unguarded ghost mode-switch from racing a submit
    setBusy(true)
    setError(null)
    try {
      const res =
        mode === 'in'
          ? await signIn.email({ email, password })
          : // Name is optional and set later in Settings, so sign-up starts it empty
            // (the DB column is NOT NULL; '' satisfies it without faking a name).
            await signUp.email({ email, password, name: '' })
      if (res.error) {
        setError(res.error.message ?? 'Authentication failed')
        return
      }
      // Normally we came from a screen that pushed us here (back returns to it). But a
      // DEEP LINK straight to /sign-in has nothing beneath it, so back is a no-op — fall
      // back to home so success never strands the rider on the (now-irrelevant) form.
      if (router.canGoBack()) router.back()
      else router.replace('/')
    } catch {
      // A rejected call (no connectivity, DNS/TLS failure, an unexpected throw) must
      // not wedge the button in its loading state forever — `finally` always clears
      // busy. Show the in-character generic rather than a raw fetch error string.
      setError(voice.error.generic)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: mode === 'in' ? 'Sign in' : 'Create account' }} />

      <View style={styles.head}>
        <Text variant="display" color="ink">
          {mode === 'in' ? voice.auth.signInHeader : voice.auth.signUpHeader}
        </Text>
        <Text variant="body" color="inkDim">
          {voice.auth.subhead}
        </Text>
      </View>

      <Input
        placeholder="Email"
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => passwordRef.current?.focus()}
        value={email}
        onChangeText={setEmail}
      />
      <Input
        ref={passwordRef}
        placeholder="Password"
        accessibilityLabel="Password"
        secureTextEntry
        textContentType={mode === 'in' ? 'password' : 'newPassword'}
        autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
        returnKeyType="go"
        onSubmitEditing={submit}
        value={password}
        onChangeText={setPassword}
      />

      {error ? (
        <Text variant="dim" color="danger">
          {error}
        </Text>
      ) : null}

      <Button
        title={mode === 'in' ? 'Sign in' : 'Create account'}
        loading={busy}
        onPress={submit}
        style={styles.cta}
      />
      <Button
        variant="ghost"
        title={mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        onPress={() => setMode(mode === 'in' ? 'up' : 'in')}
      />
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  head: { gap: space.xs, marginBottom: space.sm },
  cta: { marginTop: space.xs },
})
