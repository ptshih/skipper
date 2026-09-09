import { useRef, useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { track } from '@/lib/analytics'
import { emailOtp, PASSWORD_RESET_URL, requestPasswordReset, signIn } from '@/lib/auth'
import { space } from '@/theme/tokens'
import { Button, Input, Screen, Text, voice } from '@/ui'

// THE WAY IN. Since 2026-08-05 (founder call, docs/designs/lowest-friction-signup.md §8) that is an
// EMAILED CODE, and signing up and signing in are no longer different things: `signIn.emailOtp`
// creates the account when the address is new and signs the rider in when it isn't. This screen used
// to be a three-way `'in' | 'up' | 'reset'` machine with a `?mode=up` deep link picking the branch;
// the whole distinction is gone, which is most of why this file got shorter rather than longer.
//
// Password survives as a FALLBACK behind one ghost button, for two reasons worth keeping straight:
// App Review cannot receive an emailed code (they sign in as review@skipper.fm with a password held
// in App Store Connect), and a rider who set one in Settings has a way in that does not depend on
// mail arriving. ⚠ There is deliberately NO password SIGN-UP branch — nothing in the app calls
// `signUp.email` any more, and `@/lib/auth` no longer re-exports it.

/** How recently `user.createdAt` must sit for this to count as a NEW account.
 *
 *  ⚠ THIS IS A HEURISTIC AND IT REPLACED A FACT, so it is worth knowing why. The old screen knew it
 *  was a sign-UP because the rider had tapped a different button (`mode === 'up'`). With one call
 *  doing both, the client cannot know: better-auth returns a BYTE-IDENTICAL `{ token, user }` from
 *  both branches of `/sign-in/email-otp` — there is no `isNewUser` flag (verified in the installed
 *  1.6.23 source). `createdAt` is a core field and survives `parseUserOutput`, so its recency is the
 *  only signal left.
 *
 *  ⚠ IT COMPARES A SERVER TIMESTAMP TO THE DEVICE CLOCK, so a skewed phone can misread it. Five
 *  minutes, not five seconds, is the tolerance for that: a returning rider's account is days old, so
 *  the window can be wide without false positives, and a device running BEHIND still reads new
 *  accounts as new (the delta goes negative, which passes). The one lossy case is a device running
 *  more than five minutes FAST, which under-counts signups — a conservative failure, and the right
 *  direction for the number the wall's conversion rate is read against. */
const NEW_ACCOUNT_WINDOW_MS = 5 * 60 * 1000

/** Did this sign-in just CREATE the account? See NEW_ACCOUNT_WINDOW_MS for why this is a guess. */
function wasJustCreated(user: { createdAt?: string | Date } | undefined): boolean {
  if (!user?.createdAt) return false
  const created = new Date(user.createdAt).getTime()
  if (Number.isNaN(created)) return false
  return Date.now() - created < NEW_ACCOUNT_WINDOW_MS
}

export default function SignInScreen() {
  const router = useRouter()
  // 'email' → 'code' is the default path. 'password' and 'reset' are the fallback, reachable only by
  // an explicit tap. ⚠ No `?mode=` param any more: with signup and sign-in unified there is nothing
  // for a caller to select, and every call site now pushes a bare '/sign-in'.
  const [step, setStep] = useState<'email' | 'code' | 'password' | 'reset'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)
  const passwordRef = useRef<TextInput>(null)
  // Reject incomplete input locally; the server remains authoritative about credentials.
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  const codeValid = /^\d{6}$/.test(code.trim())
  const passwordValid = emailValid && password.length > 0
  const usePassword = () => {
    setError(null)
    setCode('')
    setStep('password')
  }

  /** Leave for wherever the rider came from. A DEEP LINK straight here has nothing beneath it, so
   *  back is a no-op — fall back to home so success never strands them on a form they're done with. */
  const leave = () => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  // Ask the server to mail a code. ⚠ Enumeration-safe on BOTH sides, exactly like the reset flow: the
  // server dispatches whether or not the address exists (better-auth's send route, with signup
  // enabled), and this screen must not branch on the result either — it always advances to the code
  // step. Anything else would turn the form into an oracle for who has an account.
  const sendCode = async () => {
    if (busy || !emailValid) return
    setBusy(true)
    setError(null)
    try {
      const res = await emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' })
      if (res.error) {
        setError(res.error.message ?? voice.error.generic)
        return
      }
      setCode('')
      setStep('code')
    } catch {
      setError(voice.error.generic)
    } finally {
      setBusy(false)
    }
  }

  // Redeem the code. This is the call that signs up OR signs in — see the file header.
  const submitCode = async () => {
    if (busy || !codeValid) return
    setBusy(true)
    setError(null)
    try {
      const res = await signIn.emailOtp({ email: email.trim(), otp: code.trim() })
      if (res.error) {
        setError(res.error.message ?? voice.error.generic)
        return
      }
      // ── signup_completed: past the error guard (so an account really exists), before the navigation
      // (which unmounts this screen). ⚠ NEW ACCOUNTS ONLY — a returning rider is not a wall
      // conversion, and folding the two together makes the wall look like it works. That distinction
      // used to be free (`mode === 'up'`); it is now the `wasJustCreated` guess above.
      // ⚠ No properties, deliberately: no email, no user id (INV-13 / the analytics no-person rule).
      if (wasJustCreated(res.data?.user)) track('signup_completed', {})
      leave()
    } catch {
      setError(voice.error.generic)
    } finally {
      setBusy(false)
    }
  }

  // The fallback. Sign-IN only — there is no password sign-up path any more.
  const submitPassword = async () => {
    if (busy || !passwordValid) return
    setBusy(true)
    setError(null)
    try {
      const res = await signIn.email({ email: email.trim(), password })
      if (res.error) {
        setError(res.error.message ?? 'Authentication failed')
        return
      }
      // ⚠ No `signup_completed` here, and not because of an oversight: this branch cannot create an
      // account, so every success is a returning rider by construction.
      leave()
    } catch {
      setError(voice.error.generic)
    } finally {
      setBusy(false)
    }
  }

  const sendReset = async () => {
    if (busy || !emailValid) return
    setBusy(true)
    setError(null)
    try {
      const res = await requestPasswordReset({
        email: email.trim(),
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
      setBusy(false)
    }
  }

  const title =
    step === 'reset' ? 'Reset password' : step === 'password' ? 'Sign in' : 'Get your ticket'
  const header =
    step === 'reset'
      ? voice.auth.resetHeader
      : step === 'password'
        ? voice.auth.signInHeader
        : step === 'code'
          ? voice.auth.codeHeader
          : voice.auth.header
  const sub =
    step === 'reset'
      ? voice.auth.resetHint
      : step === 'code'
        ? voice.auth.codeHint
        : step === 'password'
          ? voice.auth.subhead
          : voice.auth.emailHint

  const errorLine = error ? (
    <Text variant="dim" color="danger">
      {error}
    </Text>
  ) : null

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title }} />

      <View style={styles.head}>
        <Text variant="display" color="ink">
          {header}
        </Text>
        <Text variant="body" color="inkDim">
          {sub}
        </Text>
      </View>

      {resetSent ? (
        // The link is out (or the address wasn't ours — same words either way, by design). The form is
        // gone because the rider's next move is in their mail app, not on this screen.
        <>
          <Text variant="body" color="ink">
            {voice.auth.resetSent}
          </Text>
          <Button
            variant="ghost"
            title="Back to sign in"
            onPress={() => {
              setResetSent(false)
              setStep('password')
            }}
          />
        </>
      ) : step === 'code' ? (
        <>
          <Input
            placeholder="123456"
            accessibilityLabel="Emailed code"
            keyboardType="number-pad"
            // ⚠ The whole friction win rides on these two: iOS surfaces the code on the lock screen
            // and offers one-tap autofill straight into this field, so the rider never opens Mail.
            // That is why the code is in the email SUBJECT too (apps/api/src/email.ts).
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            returnKeyType="go"
            onSubmitEditing={submitCode}
            value={code}
            editable={!busy}
            onChangeText={setCode}
          />
          {errorLine}
          <Button
            title={voice.auth.codeCta}
            loading={busy}
            disabled={!codeValid}
            onPress={submitCode}
            style={styles.cta}
          />
          <Button
            variant="ghost"
            title={voice.auth.codeResend}
            disabled={busy}
            onPress={sendCode}
          />
          <Button
            variant="ghost"
            title={voice.auth.usePassword}
            disabled={busy}
            onPress={usePassword}
          />
          <Button
            variant="ghost"
            title={voice.auth.codeChangeEmail}
            disabled={busy}
            onPress={() => {
              setError(null)
              setCode('')
              setStep('email')
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
            returnKeyType={step === 'password' ? 'next' : 'go'}
            submitBehavior="submit"
            onSubmitEditing={
              step === 'password'
                ? () => passwordRef.current?.focus()
                : step === 'reset'
                  ? sendReset
                  : sendCode
            }
            value={email}
            editable={!busy}
            onChangeText={setEmail}
          />
          {step === 'password' ? (
            <Input
              ref={passwordRef}
              placeholder="Password"
              accessibilityLabel="Password"
              secureTextEntry
              textContentType="password"
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={submitPassword}
              value={password}
              editable={!busy}
              onChangeText={setPassword}
            />
          ) : null}

          {errorLine}

          {step === 'reset' ? (
            <>
              <Button
                title={voice.auth.resetSend}
                loading={busy}
                disabled={!emailValid}
                onPress={sendReset}
                style={styles.cta}
              />
              <Button
                variant="ghost"
                title="Back to sign in"
                disabled={busy}
                onPress={() => {
                  setError(null)
                  setStep('password')
                }}
              />
            </>
          ) : step === 'password' ? (
            <>
              <Button
                title="Sign in"
                loading={busy}
                disabled={!passwordValid}
                onPress={submitPassword}
                style={styles.cta}
              />
              <Button
                variant="ghost"
                title={voice.auth.useCode}
                disabled={busy}
                onPress={() => {
                  setError(null)
                  setPassword('')
                  setStep('email')
                }}
              />
              <Button
                variant="ghost"
                title={voice.auth.forgot}
                disabled={busy}
                onPress={() => {
                  setError(null)
                  setStep('reset')
                }}
              />
            </>
          ) : (
            <>
              <Button
                title={voice.auth.sendCode}
                loading={busy}
                disabled={!emailValid}
                onPress={sendCode}
                style={styles.cta}
              />
              <Button
                variant="ghost"
                title={voice.auth.usePassword}
                disabled={busy}
                onPress={usePassword}
              />
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
