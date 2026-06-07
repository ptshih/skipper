import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { signIn, signUp } from '@/lib/auth'

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
    <View style={styles.container}>
      <Stack.Screen options={{ title: mode === 'in' ? 'Sign in' : 'Create account' }} />
      {mode === 'up' ? (
        <TextInput style={styles.input} placeholder="Name" autoCapitalize="words" value={name} onChangeText={setName} />
      ) : null}
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput style={styles.input} placeholder="Password" secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={submit} disabled={busy}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{mode === 'in' ? 'Sign in' : 'Create account'}</Text>}
      </Pressable>
      <Pressable onPress={() => setMode(mode === 'in' ? 'up' : 'in')}>
        <Text style={styles.link}>{mode === 'in' ? 'Need an account? Sign up' : 'Have an account? Sign in'}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { backgroundColor: '#1e6fd9', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  link: { color: '#1e6fd9', textAlign: 'center', marginTop: 8 },
  error: { color: '#b00020' },
})
