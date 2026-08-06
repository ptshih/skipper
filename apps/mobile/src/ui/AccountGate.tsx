// The freemium wall, shared by every gated screen (drive detail + player). A "smart"
// composite — unlike the pure primitives, it knows the sign-in route + the skipper
// gate copy. `note` prefixes a context line (e.g. the preview's "sample only").
import { Stack, useRouter } from 'expo-router'
import { StyleSheet } from 'react-native'
import { space } from '../theme/tokens'
import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { Screen } from './Screen'
import { Text } from './Text'
import { voice } from './voice'

export function AccountGate({
  note,
  secondaryAction,
}: {
  note?: string
  /** Overrides the ghost button. Without it the label ("Just take the sample ride") is a no-op
   *  back() — so every call site that shows the gate SHOULD pass a real action (route to the
   *  preview, or dismiss the gate), keeping the funnel's one explicit offer honest. */
  secondaryAction?: { label: string; onPress: () => void }
}) {
  const router = useRouter()
  return (
    <Screen scroll center>
      <Stack.Screen options={{ title: voice.gate.title }} />
      <Card framed style={styles.card}>
        <Badge tone="amber" filled label="FREE" style={styles.badge} />
        <Text variant="placardTitle" color="ink" align="center">
          {voice.gate.title}
        </Text>
        <Text variant="body" color="inkDim" align="center">
          {note ? `${note} ` : ''}
          {voice.gate.body}
        </Text>
        <Button
          icon="ticket"
          title={voice.gate.action}
          // ⚠ No `?mode=up` any more: signing up and signing in are ONE call since 2026-08-05
          // (an emailed code creates the account when the address is new), so there is no
          // create-account branch left to select. See app/sign-in.tsx.
          onPress={() => router.push('/sign-in')}
          style={styles.cta}
        />
        <Button
          variant="ghost"
          title={secondaryAction?.label ?? voice.gate.secondary}
          onPress={secondaryAction?.onPress ?? (() => router.back())}
        />
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', gap: space.md, alignItems: 'center' },
  badge: { alignSelf: 'center' },
  cta: { marginTop: space.xs },
})
