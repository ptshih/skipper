import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, StyleSheet, View } from 'react-native'
import * as Linking from 'expo-linking'
import { Stack, useRouter } from 'expo-router'
import { errorMessage } from '@/lib/api'
import { deleteUser, isAdmin, signOut, updateUser, useSession } from '@/lib/auth'
import { useIsOffline } from '@/lib/connectivity'
import { PRIVACY_POLICY_URL, TERMS_URL } from '@/lib/licenses'
import {
  deleteRoamPack,
  downloadRoamPack,
  roamPackStatus,
  type PackProgress,
} from '@/lib/roam-pack'
import { formatBytes } from '@/lib/roam-pack-util'
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

  /* ---- The roam offline pack: pins + audio for the dead zones (see @/lib/roam-pack) ---- */
  const isOffline = useIsOffline()
  const [pack, setPack] = useState(() => roamPackStatus())
  const [packProgress, setPackProgress] = useState<PackProgress | null>(null)
  const [packError, setPackError] = useState<string | null>(null)
  const packAbort = useRef<AbortController | null>(null)
  // Cancel an in-flight save if the rider leaves — the run holds a network connection and writes
  // files; it must not outlive the screen that started it.
  useEffect(() => () => packAbort.current?.abort(), [])

  const savePack = useCallback(async () => {
    if (packProgress) return
    setPackError(null)
    setPackProgress({ done: 0, total: 0 })
    const ctrl = new AbortController()
    packAbort.current = ctrl
    try {
      await downloadRoamPack(undefined, setPackProgress, ctrl.signal)
    } catch (e) {
      // A cancel is the rider's own doing — silent. Everything else gets an honest line: offline
      // and storage already speak for themselves, so only the generic case needs the persona.
      if (!(e instanceof Error && e.name === 'AbortError')) {
        setPackError(errorMessage(e, voice.settings.roamPackFailed))
      }
    } finally {
      if (packAbort.current === ctrl) packAbort.current = null
      setPackProgress(null)
      setPack(roamPackStatus()) // re-read from disk: a partial save still saved something
    }
  }, [packProgress])

  const removePack = useCallback(() => {
    Alert.alert(voice.settings.roamPackRemove, voice.settings.roamPackRemoveBody, [
      { text: voice.confirm.keepRolling, style: 'cancel' },
      {
        text: voice.settings.roamPackRemoveCta,
        style: 'destructive',
        onPress: () => {
          deleteRoamPack()
          setPack(roamPackStatus())
        },
      },
    ])
  }, [])

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

      {/* RIDE ALONG OFFLINE — the roam pack (@/lib/roam-pack). Roam is the front door and the daily
          mode, and it used to be 100% online-only; this is the control that makes it work in a dead
          zone. It lives in Settings rather than on the roam screen because the roam canvas is
          deliberately calm and eyes-on-road, and because a ~138 MB download is a parked decision. */}
      <View style={styles.section}>
        <Text variant="label" color="inkFaint">
          {voice.settings.roamPack}
        </Text>
        <Text variant="dim" color="inkFaint">
          {voice.settings.roamPackIntro}
        </Text>

        {pack.state === 'stale' ? (
          // A pack written by an older build. It still occupies the space, so the honest thing is to
          // say so and keep the reclaim reachable — never let unreadable bytes become invisible ones.
          <>
            <Text variant="dim" color="inkDim">
              {voice.settings.roamPackStale}
            </Text>
            <Button variant="secondary" title={voice.settings.roamPackRemove} onPress={removePack} />
          </>
        ) : pack.state === 'none' ? (
          <Text variant="dim" color="inkDim">
            {voice.settings.roamPackNoAnchor}
          </Text>
        ) : (
          <>
            <Text variant="dim" color="inkDim">
              {pack.clipCount > 0
                ? `${pack.clipCount} ${pack.clipCount === 1 ? 'story' : 'stories'} saved · ${formatBytes(pack.bytes)}`
                : `${pack.pinCount} ${pack.pinCount === 1 ? 'story' : 'stories'} out there · about ${formatBytes(pack.estimatedBytes)} to save`}
            </Text>
            {pack.expired ? (
              <Text variant="dim" color="inkFaint">
                {voice.settings.roamPackExpired}
              </Text>
            ) : null}
            {packProgress ? (
              <Text variant="dim" color="inkFaint" accessibilityLiveRegion="polite">
                {packProgress.total > 0
                  ? `${voice.settings.roamPackSaving} ${packProgress.done} / ${packProgress.total}`
                  : voice.settings.roamPackSaving}
              </Text>
            ) : null}
            {packError ? (
              <Text variant="dim" color="danger">
                {packError}
              </Text>
            ) : null}
            {packProgress ? (
              <Button
                variant="secondary"
                title={voice.settings.roamPackCancel}
                onPress={() => packAbort.current?.abort()}
              />
            ) : (
              <Button
                variant="secondary"
                title={pack.clipCount > 0 ? voice.settings.roamPackUpdate : voice.settings.roamPackSave}
                // Saving needs the network to re-presign every clip; offline the tap can only fail.
                // Unlike the home CTAs there is no honest destination behind it — the whole action IS
                // the request — so this one is genuinely inert and says so.
                disabled={isOffline}
                onPress={() => void savePack()}
              />
            )}
            {pack.clipCount > 0 && !packProgress ? (
              <Button variant="ghost" title={voice.settings.roamPackRemove} onPress={removePack} />
            ) : null}
          </>
        )}
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
