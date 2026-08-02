import { useRef, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { track } from '@/lib/analytics'
import { PASSWORD_RESET_URL, requestPasswordReset, signIn, signUp } from '@/lib/auth'
import { space } from '@/theme/tokens'
import { Button, Input, Screen, Text, voice } from '@/ui'

// Email/password sign-in + sign-up. (Google/Apple are wired server-side and turn
// on once their OAuth creds are set; add provider buttons here when they are.)
export default function SignInScreen() {
  const router = useRouter()
  // The free-ticket AccountGate links here to CREATE an account (?mode=up); the
  // header/settings "Sign in" links omit the param and land on sign-in ('in').
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>()
  // 'reset' is reachable only from the in-screen "Forgot your password?" ghost — it's deliberately
  // NOT a ?mode= value, since nothing should deep-link a rider straight into a reset.
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>(modeParam === 'up' ? 'up' : 'in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Password reset. `resetSent` latches the enumeration-safe confirmation in place of the form —
  // the rider's next move is in their email app, not here.
  const [resetting, setResetting] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  // Chain the soft keyboard's return key through the form (email → password → submit)
  // so a rider never has to dismiss it to reach the next field or the CTA. (Name is
  // NOT collected at sign-up — it's an optional field in Settings after signing in.)
  const passwordRef = useRef<TextInput>(null)

  // Ask the server to mail a reset link. The reply is enumeration-safe on BOTH sides: the server
  // answers identically for a known and an unknown address, and so must this screen — hence a flat
  // `resetSent` latch with no branch on the result. The only error worth showing is a transport
  // failure, which is about THIS request, not about who exists.
  const sendReset = async () => {
    if (resetting || !email.trim()) return
    setResetting(true)
    setError(null)
    try {
      const res = await requestPasswordReset({
        email: email.trim(),
        // Resolves on the web — see PASSWORD_RESET_URL. Must be a server-trusted origin.
        redirectTo: PASSWORD_RESET_URL,
      })
      if (res.error) {
        setError(res.error.message ?? voice.error.generic)
        return
      }
      setResetSent(true)
    } catch {
      setError(voice.error.generic)
    } finally {
      setResetting(false)
    }
  }

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
      // ── signup_completed: past the error guard (so it means a real account exists), before the
      // navigation (which unmounts this screen).
      //
      // ⚠ SIGN-UP ONLY, never any successful submit. An existing-account sign-in is a RETURNING
      // rider, not a wall conversion — and the wall's conversion rate is the single number this
      // funnel exists to produce, so folding the two together makes the wall look like it works.
      // Hence `=== 'up'` rather than `!== 'in'`.
      //
      // ⚠ It reads the `mode` STATE, not the `?mode=` route param. The "Have an account? / Need an
      // account?" ghost below flips this state WITHOUT touching the route, so `modeParam` is stale
      // the instant a rider uses it: someone who arrived at ?mode=up from the AccountGate and
      // switched to signing in would be counted as a brand-new account. (`mode` can also be
      // 'reset', which never reaches here — the reset branch renders sendReset instead.)
      //
      // ⚠ No properties, deliberately: no email, no user id. INV-4 is why it costs nothing — Better
      // Auth hard-deletes the anonymous row at link, so PostHog's device distinct_id is already the
      // only spine that carries wall_shown → here → drive_created across the wall.
      if (mode === 'up') track('signup_completed', {})
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
      <Stack.Screen
        options={{
          title: mode === 'reset' ? 'Reset password' : mode === 'in' ? 'Sign in' : 'Create account',
        }}
      />

      <View style={styles.head}>
        <Text variant="display" color="ink">
          {mode === 'reset'
            ? voice.auth.resetHeader
            : mode === 'in'
              ? voice.auth.signInHeader
              : voice.auth.signUpHeader}
        </Text>
        <Text variant="body" color="inkDim">
          {mode === 'reset' ? voice.auth.resetHint : voice.auth.subhead}
        </Text>
      </View>

      {resetSent ? (
        // The link is out (or the address wasn't ours — same words either way, by design). The form
        // is gone because the rider's next move is in their mail app, not on this screen.
        <>
          <Text variant="body" color="ink">
            {voice.auth.resetSent}
          </Text>
          <Button
            variant="ghost"
            title="Back to sign in"
            onPress={() => {
              setResetSent(false)
              setMode('in')
            }}
          />
        </>
      ) : (
        <>
          <Input
            placeholder="Email"
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            returnKeyType={mode === 'reset' ? 'go' : 'next'}
            submitBehavior="submit"
            onSubmitEditing={mode === 'reset' ? sendReset : () => passwordRef.current?.focus()}
            value={email}
            onChangeText={setEmail}
          />
          {mode === 'reset' ? null : (
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
          )}

          {error ? (
            <Text variant="dim" color="danger">
              {error}
            </Text>
          ) : null}

          {mode === 'reset' ? (
            <>
              <Button
                title={voice.auth.resetSend}
                loading={resetting}
                disabled={!email.trim()}
                onPress={sendReset}
                style={styles.cta}
              />
              <Button variant="ghost" title="Back to sign in" onPress={() => setMode('in')} />
            </>
          ) : (
            <>
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
              {mode === 'in' ? (
                <Button
                  variant="ghost"
                  title={voice.auth.forgot}
                  onPress={() => {
                    setError(null)
                    setMode('reset')
                  }}
                />
              ) : null}
            </>
          )}
        </>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  head: { gap: space.xs, marginBottom: space.sm },
  cta: { marginTop: space.xs },
})
