// The pre-permission PRIMING screen — the in-character "why I need your location", shown ONCE,
// right before the OS location prompt (the live drive). iOS gives one shot at that prompt and
// a cold ask gets denied, so we explain first. HARD RULE (App Store Guideline 5.1.1(iv), forum
// thread 817672): a pre-prompt must NOT carry a "Not Now"/dismiss button — the single CTA leads
// straight into the system prompt; the rider abandons (if at all) via the nav-bar back, BEFORE
// the prompt. A "smart" composite like AccountGate: it knows the skipper prime copy.
import { Stack } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { space } from '../theme/tokens'
import { Button } from './Button'
import { Card } from './Card'
import { Icon } from './Icon'
import { Screen } from './Screen'
import { Text } from './Text'
import { voice } from './voice'

export function LocationPrime({
  title,
  onContinue,
}: {
  /** Screen-header title — matches the host screen ("Drive"). */
  title: string
  /** Fire the OS permission prompt. The ONLY action on this screen (no dismiss button). */
  onContinue: () => void
}) {
  return (
    <Screen scroll center>
      <Stack.Screen options={{ title }} />
      <Card framed style={styles.card}>
        <View style={styles.icon}>
          <Icon name="locate" size={28} color="accent" />
        </View>
        <Text variant="label" color="accentWarm" align="center">
          {voice.drive.locationPrimeKicker}
        </Text>
        <Text variant="placardTitle" color="ink" align="center">
          {voice.drive.locationPrimeTitle}
        </Text>
        <Text variant="body" color="inkDim" align="center">
          {voice.drive.locationPrimeBody}
        </Text>
        <Text variant="dim" color="inkFaint" align="center">
          {voice.drive.locationPrimeReassure}
        </Text>
        <Button
          icon="locate"
          title={voice.drive.locationPrimeCta}
          onPress={onContinue}
          style={styles.cta}
        />
      </Card>
    </Screen>
  )
}

const styles = StyleSheet.create({
  card: { alignSelf: 'stretch', gap: space.sm, alignItems: 'center' },
  icon: { marginBottom: space.xs },
  cta: { marginTop: space.sm },
})
