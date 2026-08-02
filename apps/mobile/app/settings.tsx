import { useEffect, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import * as Linking from 'expo-linking'
import { Stack, useRouter } from 'expo-router'
import { deleteUser, isAdmin, isSignedIn, signOut, updateUser, useSession } from '@/lib/auth'
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
  // Delete-account state. `confirmingDelete` gates the reveal of the password field (see
  // performDelete for why it's a two-step).
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
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
  // sign-up. Deliberately a TWO-STEP reveal rather than a single button: the password field only
  // appears after an explicit tap, so the most destructive control in the app can't be fired by one
  // stray thumb next to "Sign out". (An `Alert.prompt` would be a tighter flow but is iOS-ONLY —
  // it silently no-ops on Android — so the field is inline and cross-platform.)
  const performDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      // The password is what the server's sensitiveSessionMiddleware wants when the session isn't
      // fresh — and re-auth is the right bar for an irreversible erasure regardless of session age.
      const res = await deleteUser({ password })
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

  const confirmDelete = () => {
    if (deleting || !password) return
    Alert.alert(voice.settings.deleteTitle, voice.settings.deleteBody, [
      { text: 'Cancel', style: 'cancel' },
      { text: voice.settings.deleteCta, style: 'destructive', onPress: () => void performDelete() },
    ])
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
                {deleteError ? (
                  <Text variant="dim" color="danger">
                    {deleteError}
                  </Text>
                ) : null}
                <Button
                  variant="secondary"
                  title={voice.settings.deleteAction}
                  loading={deleting}
                  disabled={!password}
                  onPress={confirmDelete}
                />
                <Button
                  variant="ghost"
                  title="Cancel"
                  onPress={() => {
                    setConfirmingDelete(false)
                    setPassword('')
                    setDeleteError(null)
                  }}
                />
              </>
            ) : (
              <Button
                variant="ghost"
                title={voice.settings.deleteAccount}
                onPress={() => setConfirmingDelete(true)}
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
                • no Delete account — `deleteUser` sits behind better-auth's sensitiveSessionMiddleware
                  and an anonymous user has no credential to re-auth with, so the button could only
                  ever return an error. Advertising a deletion that cannot succeed is the exact
                  inverse of what App Store 5.1.1(v) asks for.
                ⚠ RISK-3 LIVES IN THIS BRANCH: the mint created a server-side row this rider cannot
                delete from inside the app. Whether that counts as "creating an account" under
                5.1.1(v) is a FOUNDER call before submission — see docs/designs/drives-first-1-1.md
                RISK-3. If the answer is yes, the fix is the installed plugin's own
                `deleteAnonymousUser`; do NOT wire it on your own initiative.
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
