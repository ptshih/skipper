import { useEffect, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import * as Linking from 'expo-linking'
import { Stack, useRouter } from 'expo-router'
import { setAccountPassword } from '@/lib/api'
import {
  deleteUser,
  emailOtp,
  isAdmin,
  isSignedIn,
  listAccounts,
  signOut,
  updateUser,
  useSession,
} from '@/lib/auth'
import { PRIVACY_POLICY_URL, TERMS_URL } from '@/lib/licenses'
import { deleteAllDriveDownloads } from '@/lib/offline'
import { space } from '@/theme/tokens'
import { Button, Input, Screen, Text, ThemeModePicker, voice } from '@/ui'

// Settings — the deliberate, parked-context home for preferences + account. The home
// body stays 100% drive-focused, so identity ("Riding as …") and the rare/destructive
// Sign out + Delete account live HERE, behind the home's gear, not in the front-door chrome.
// Appearance (Auto / Day / Dusk) follows. Room to grow (different narrators) as M4 lands.

// Legal documents open in the browser — they live on skipper.fm (see @/lib/licenses), not in the
// bundle. Failures swallow: a dead link is not worth an alert mid-drive.
const openUrl = (url: string) => {
  Linking.openURL(url).catch(() => {})
}

export default function SettingsScreen() {
  const router = useRouter()
  const { data: session } = useSession()
  // ⚠ INV-9: a truthy `session` is NOT "signed in" — after 1.1's anonymous mint every rider has one.
  // Everything account-shaped on this screen keys on the one helper, mirroring the server's tierOf.
  const signedIn = isSignedIn(session)
  // Developer tools are admin-only (isAdmin = role === 'admin', server-set). Shared with
  // developer.tsx's self-guard so the gate has exactly one definition.
  const showDeveloper = isAdmin(session)

  // Name is optional and lives HERE, not at sign-up. Seed the field from the saved
  // name and re-sync whenever it changes — a successful save pings $sessionSignal,
  // useSession refetches, and this effect flips the field back to "clean".
  const savedName = session?.user?.name ?? ''
  const [name, setName] = useState(savedName)
  const [savingName, setSavingName] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  // Delete-account state. `confirmingDelete` gates the reveal of the confirmation (see performDelete
  // for why it's a two-step). ⚠ `deleteMode` is which PROOF we ask for, and it is resolved at tap
  // time rather than assumed: an account that signed up with an emailed code has NO password to
  // type, so the old unconditional password field would have made it undeletable.
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteMode, setDeleteMode] = useState<'resolving' | 'password' | 'code'>('resolving')
  const [password, setPassword] = useState('')
  const [deleteCode, setDeleteCode] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // Set-a-password state (§8.6). Lazy reveal: the field only appears on an explicit tap.
  const [settingPassword, setSettingPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaved, setPasswordSaved] = useState(false)
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

  // Account deletion — required in-app by App Store Guideline 5.1.1(v) for any app that offers
  // sign-up. Deliberately a TWO-STEP reveal rather than a single button: the confirmation only
  // appears after an explicit tap, so the most destructive control in the app can't be fired by one
  // stray thumb next to "Sign out". (An `Alert.prompt` would be a tighter flow but is iOS-ONLY —
  // it silently no-ops on Android — so the field is inline and cross-platform.)
  //
  // ⚠ WHICH PROOF WE ASK FOR IS RESOLVED HERE, AT TAP TIME, and it is the 5.1.1(v) fix. Since
  // 2026-08-05 most accounts are created by an emailed code and have NO password, so the old
  // unconditional password field (with `disabled={!password}`) would have left them permanently
  // undeletable — a guaranteed rejection on the one guideline CLAUDE.md calls non-negotiable.
  // `providerId === 'credential'` is the real answer to "does this account have a password"; nothing
  // on the session carries it.
  // ⚠ FAILS TO 'code', not to 'password'. A rider we can't classify must still be able to delete: the
  // code path works for every account, the password path only for the minority that has one. (The one
  // caller who NEEDS the password path — App Review, who cannot receive email — is also the one whose
  // network is working, so the classification succeeds for them.)
  const beginDelete = async () => {
    setConfirmingDelete(true)
    setDeleteMode('resolving')
    setDeleteError(null)
    try {
      const res = await listAccounts()
      const hasPassword = (res.data ?? []).some((a) => a.providerId === 'credential')
      setDeleteMode(hasPassword ? 'password' : 'code')
    } catch {
      setDeleteMode('code')
    }
  }

  // Mail a code for the deletion confirmation. Same endpoint the sign-in screen uses — `type:
  // 'sign-in'` is the only OTP type this app enables, and reusing it keeps one code vocabulary
  // rather than standing up a second one for a once-in-an-account-lifetime action.
  const sendDeleteCode = async () => {
    const email = session?.user?.email
    if (!email || deleting) return
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await emailOtp.sendVerificationOtp({ email, type: 'sign-in' })
      if (res.error) setDeleteError(res.error.message ?? voice.error.generic)
    } catch {
      setDeleteError(voice.error.generic)
    } finally {
      setDeleting(false)
    }
  }

  const performDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      // ⚠ THE RE-AUTH BAR HERE IS OURS, NOT THE SERVER'S — do not remove it because the API would
      // accept the call without it. better-auth's `/delete-user` sits on `sensitiveSessionMiddleware`,
      // which resolves an AUTHORITATIVE session but does not check freshness (it is
      // `freshSessionMiddleware`, a different middleware, that does) — and it only verifies `password`
      // when one is SENT. So `deleteUser({})` from any live session would erase the account outright.
      // This screen's original note called re-auth "the right bar for an irreversible erasure
      // regardless of session age"; that judgement did not change just because the password did.
      if (deleteMode === 'code') {
        const email = session?.user?.email
        if (!email) {
          setDeleteError(voice.settings.deleteFailed)
          return
        }
        // Verifies WITHOUT consuming the code or rotating the session mid-erasure (better-auth's
        // check route leaves the verification value in place); it enforces its own 3-attempt cap.
        const checked = await emailOtp.checkVerificationOtp({
          email,
          type: 'sign-in',
          otp: deleteCode.trim(),
        })
        if (checked.error) {
          setDeleteError(checked.error.message ?? voice.settings.deleteCodeFailed)
          return
        }
      }
      // `password` is omitted entirely on the code path — better-auth verifies it only when present,
      // and sending an empty string would trip its CREDENTIAL_ACCOUNT_NOT_FOUND instead.
      const res = await deleteUser(deleteMode === 'password' ? { password } : {})
      if (res.error) {
        setDeleteError(res.error.message ?? voice.settings.deleteFailed)
        return
      }
      // Erasure is immediate and TOTAL (CLAUDE.md), and the server half is only half. The saved
      // drives on this phone are the same rider's data, and after this flow they are also
      // unreachable by every other cleanup path: the rider is anonymous, so home takes its
      // signed-out branch and `listDownloadedDrives` would hand the deleted account's drives to
      // whoever picks the phone up next — and with the server rows gone, no future drive list can
      // ever mention them for the ownership sweep to act on.
      deleteAllDriveDownloads()
      // The account (and its sessions) are gone server-side, but the token still sits in this
      // device's SecureStore — clear it, or the app keeps believing it's signed in until some
      // later call 401s. Best-effort: the session it would revoke no longer exists.
      await signOut().catch(() => {})
      router.replace('/')
    } catch {
      setDeleteError(voice.error.generic)
    } finally {
      setDeleting(false)
    }
  }

  // ⚠ ONE EXPRESSION for "is the confirmation satisfied", read by BOTH the guard below and the
  // button's `disabled`. Two copies is how a dialog ends up authorising something its own button
  // said was unavailable (the repo's "count, authorise and act from one expression" rule).
  const deleteReady = deleteMode === 'password' ? password.length > 0 : deleteCode.trim().length > 0

  const confirmDelete = () => {
    if (deleting || !deleteReady) return
    Alert.alert(voice.settings.deleteTitle, voice.settings.deleteBody, [
      { text: 'Cancel', style: 'cancel' },
      { text: voice.settings.deleteCta, style: 'destructive', onPress: () => void performDelete() },
    ])
  }

  // Set a password on an account that has none (§8.6) — the way in that doesn't depend on an email
  // arriving, now that a code IS the default way in.
  // ⚠ Deliberately does NOT pre-check whether a password already exists. The server answers that
  // authoritatively with a 409 (`password_already_set`), whose message this renders verbatim, so a
  // pre-flight `listAccounts()` on every Settings mount would buy a network call per open to
  // duplicate a fact the write already returns — and could disagree with it.
  const savePassword = async () => {
    if (savingPassword || !newPassword) return
    setSavingPassword(true)
    setPasswordError(null)
    try {
      await setAccountPassword(newPassword)
      setPasswordSaved(true)
      setNewPassword('')
      setSettingPassword(false)
    } catch (err) {
      // ApiError carries the server's `message` — including the 409's "this account already has a
      // password" — so it renders as itself rather than as the generic failure.
      setPasswordError(err instanceof Error ? err.message : voice.error.generic)
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: 'Settings' }} />

      <View style={styles.section}>
        <Text variant="label" color="inkFaint">
          {voice.settings.account}
        </Text>
        {signedIn ? (
          <>
            <Text variant="dim" color="inkFaint" numberOfLines={1}>
              {/* `session?.` because `signedIn` is a boolean, not a type guard — the branch is
                  correct at runtime but TypeScript can't narrow through it. */}
              Riding as {savedName.trim() || session?.user?.email}
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
            {confirmingDelete ? (
              <>
                <Text variant="dim" color="inkFaint">
                  {voice.settings.deleteIntro}
                </Text>
                {deleteMode === 'resolving' ? (
                  // One round-trip, and only after an explicit tap. Nothing to confirm with yet.
                  <Text variant="dim" color="inkFaint">
                    {voice.settings.developerLoading}
                  </Text>
                ) : deleteMode === 'password' ? (
                  <Input
                    placeholder={voice.settings.deletePasswordLabel}
                    accessibilityLabel={voice.settings.deletePasswordLabel}
                    secureTextEntry
                    textContentType="password"
                    autoComplete="current-password"
                    autoCapitalize="none"
                    returnKeyType="done"
                    value={password}
                    onChangeText={setPassword}
                    onSubmitEditing={confirmDelete}
                  />
                ) : (
                  <>
                    <Text variant="dim" color="inkFaint">
                      {voice.settings.deleteCodeIntro}
                    </Text>
                    <Button
                      variant="secondary"
                      title={voice.settings.deleteSendCode}
                      loading={deleting}
                      onPress={sendDeleteCode}
                    />
                    <Input
                      placeholder={voice.settings.deleteCodeLabel}
                      accessibilityLabel={voice.settings.deleteCodeLabel}
                      keyboardType="number-pad"
                      textContentType="oneTimeCode"
                      autoComplete="one-time-code"
                      returnKeyType="done"
                      value={deleteCode}
                      onChangeText={setDeleteCode}
                      onSubmitEditing={confirmDelete}
                    />
                  </>
                )}
                {deleteError ? (
                  <Text variant="dim" color="danger">
                    {deleteError}
                  </Text>
                ) : null}
                {deleteMode === 'resolving' ? null : (
                  <Button
                    variant="secondary"
                    title={voice.settings.deleteAction}
                    loading={deleting}
                    disabled={!deleteReady}
                    onPress={confirmDelete}
                  />
                )}
                <Button
                  variant="ghost"
                  title="Cancel"
                  onPress={() => {
                    setConfirmingDelete(false)
                    setPassword('')
                    setDeleteCode('')
                    setDeleteError(null)
                  }}
                />
              </>
            ) : (
              <Button
                variant="ghost"
                title={voice.settings.deleteAccount}
                onPress={() => void beginDelete()}
              />
            )}
          </>
        ) : (
          <>
            {/* ⚠ THE ANONYMOUS RIDER LANDS HERE, not in the account block above — that is what the
                isSignedIn re-key buys (INV-9). Every omission below is deliberate:
                • no "Riding as" line — the anonymous plugin writes a synthetic `temp-…@….com` and
                  the name "Anonymous" (better-auth's anonymous plugin, not our copy); printing
                  either tells the rider they have an account they do not have.
                • no name field / Save name — it would write to a row better-auth HARD-DELETES at
                  link-to-account, with no cascade and no purgeUserData (INV-4). The edit evaporates.
                • no Sign out — signing out of an anonymous session strands the row server-side and,
                  because the mint's guard is module-level, leaves the app session-less until the
                  next cold start. A control whose only effect is to make things worse.
                • no Delete account — a FOUNDER DECISION (2026-08-03), NOT a technical impossibility.
                  The anonymous plugin already mounts POST /delete-anonymous-user, and it needs only
                  a session plus `isAnonymous` — no credential, no re-auth (its
                  sensitiveSessionMiddleware just resolves an authoritative session), and it is LIVE
                  here because we don't set `disableDeleteAnonymousUser`. Verified in the installed
                  source: better-auth@1.6.23 dist/plugins/anonymous/index.mjs. (The old reasoning
                  here cited `deleteUser` — a different endpoint, which really does demand a
                  password — and concluded the button could only error. It couldn't; it would work.)
                  The call is that the mint does not constitute account CREATION under App Store
                  5.1.1(v): in-app deletion already exists for real accounts, and an anonymous row
                  holds no rider data by invariant — INV-4 forbids writing a drive or a credit entry
                  against it, so there is nothing to erase.
                ⚠ RISK-3 (opened in docs/designs/drives-first-1-1.md) is CLOSED by that decision, not
                open: see docs/decisions/anonymous-mint-and-account-deletion.md. If it is ever
                REOPENED, the fix is the plugin endpoint named above, wired deliberately — do NOT
                wire it on your own initiative.
                ⚠ Do not delete this branch as "unreachable after the mint" — it is also what a cold
                start in a dead zone and an explicit sign-out land on. */}
            <Text variant="dim" color="inkFaint">
              {voice.guest}
            </Text>
            <Button
              icon="ticket"
              title={voice.gate.action}
              onPress={() => router.push('/sign-in?mode=up')}
            />
            <Button
              variant="secondary"
              title="Sign in"
              onPress={() => router.push('/sign-in')}
            />
          </>
        )}
      </View>

      {/* PASSWORD — signed-in riders only. The hedge for email OTP being the default way in: once a
          code is how you sign in, mail deliverability is load-bearing on the FRONT DOOR, not just on
          recovery, and a rider whose code lands in spam has no way in at all. A password they set on
          purpose is the way back that doesn't depend on an email arriving.
          ⚠ Sits BELOW the account block (which owns sign-out + deletion) so the destructive controls
          keep their distance from a routine one. */}
      {signedIn ? (
        <View style={styles.section}>
          <Text variant="label" color="inkFaint">
            {voice.settings.password}
          </Text>
          <Text variant="dim" color="inkFaint">
            {voice.settings.passwordHint}
          </Text>
          {passwordSaved ? (
            <Text variant="dim" color="ink">
              {voice.settings.passwordSaved}
            </Text>
          ) : null}
          {settingPassword ? (
            <>
              <Input
                placeholder={voice.settings.passwordLabel}
                accessibilityLabel={voice.settings.passwordLabel}
                secureTextEntry
                // `newPassword` (not `password`) so iOS offers to GENERATE and save a strong one
                // rather than autofilling an existing credential into a field that is creating one.
                textContentType="newPassword"
                autoComplete="new-password"
                autoCapitalize="none"
                returnKeyType="done"
                value={newPassword}
                onChangeText={setNewPassword}
                onSubmitEditing={savePassword}
              />
              {passwordError ? (
                <Text variant="dim" color="danger">
                  {passwordError}
                </Text>
              ) : null}
              <Button
                variant="secondary"
                title={voice.settings.passwordAction}
                loading={savingPassword}
                disabled={!newPassword}
                onPress={savePassword}
              />
              <Button
                variant="ghost"
                title="Cancel"
                onPress={() => {
                  setSettingPassword(false)
                  setNewPassword('')
                  setPasswordError(null)
                }}
              />
            </>
          ) : (
            <Button
              variant="secondary"
              title={voice.settings.passwordAction}
              onPress={() => {
                setPasswordSaved(false)
                setPasswordError(null)
                setSettingPassword(true)
              }}
            />
          )}
        </View>
      ) : null}

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
          {voice.settings.sources}
        </Text>
        <Button
          variant="secondary"
          title={voice.settings.sourcesAction}
          onPress={() => router.push('/legal')}
        />
      </View>

      <View style={styles.section}>
        <Text variant="label" color="inkFaint">
          {voice.settings.legal}
        </Text>
        <Button
          variant="secondary"
          title={voice.settings.privacyAction}
          onPress={() => openUrl(PRIVACY_POLICY_URL)}
        />
        <Button
          variant="secondary"
          title={voice.settings.termsAction}
          onPress={() => openUrl(TERMS_URL)}
        />
      </View>

      {showDeveloper ? (
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
