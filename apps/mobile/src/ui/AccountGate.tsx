// The freemium wall, shared by every gated screen (tour + preview). A "smart"
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

export function AccountGate({ note }: { note?: string }) {
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
          onPress={() => router.push('/sign-in')}
          style={styles.cta}
        />
        <Button variant="ghost" title={voice.gate.secondary} onPress={() => router.back()} />
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', gap: space.md, alignItems: 'center' },
  badge: { alignSelf: 'center' },
  cta: { marginTop: space.xs },
})
