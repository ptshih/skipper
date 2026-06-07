import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { signIn, signUp } from '@/lib/auth'
import { space } from '@/theme/tokens'
import { Button, Input, Screen, Text, voice } from '@/ui'

// Email/password sign-in + sign-up. (Google/Apple are wired server-side and turn
// on once their OAuth creds are set; add provider buttons here when they are.)
export default function SignInScreen() {
  const router = useRouter()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    setError(null)
    const res =
      mode === 'in'
        ? await signIn.email({ email, password })
        : await signUp.email({ email, password, name: name || email })
    setBusy(false)
    if (res.error) {
      setError(res.error.message ?? 'Authentication failed')
      return
    }
    router.back()
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

      {mode === 'up' ? (
        <Input
          placeholder="Name"
          accessibilityLabel="Name"
          autoCapitalize="words"
          textContentType="name"
          autoComplete="name"
          value={name}
          onChangeText={setName}
        />
      ) : null}
      <Input
        placeholder="Email"
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
      />
      <Input
        placeholder="Password"
        accessibilityLabel="Password"
        secureTextEntry
        textContentType={mode === 'in' ? 'password' : 'newPassword'}
        autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
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
