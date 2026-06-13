// The centered loading / error / empty state, shared across screens (kills the
// repeated `<Screen center><ActivityIndicator/><Text/>…` boilerplate). Pure
// presentation — the caller supplies the action's onPress.
import { useEffect } from 'react'
import { AccessibilityInfo, ActivityIndicator } from 'react-native'
import { Stack } from 'expo-router'
import { useTheme } from '../theme/ThemeProvider'
import { Button } from './Button'
import { Screen } from './Screen'
import { Text } from './Text'

export interface StateViewProps {
  message: string
  /** Show a spinner above the message (a loading state). */
  loading?: boolean
  /** Text tone — `danger` for errors, `dim` (default) for loading/empty. */
  tone?: 'dim' | 'danger'
  /** Sets the Stack header title while this state is shown. */
  title?: string
  /** Optional action button (retry / go back). */
  action?: { label: string; onPress: () => void }
}

export function StateView({ message, loading, tone = 'dim', title, action }: StateViewProps) {
  const theme = useTheme()
  const isError = tone === 'danger'
  // iOS doesn't honor accessibilityLiveRegion (Android-only), so when a fetch flips to the
  // error surface we also actively push the message to VoiceOver. The polite live region +
  // alert role below cover Android / a re-announce when the message text changes.
  useEffect(() => {
    if (isError) AccessibilityInfo.announceForAccessibility(message)
  }, [isError, message])
  return (
    <Screen scroll center>
      {title ? <Stack.Screen options={{ title }} /> : null}
      {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
      <Text
        variant={loading ? 'dim' : 'body'}
        color={isError ? 'danger' : loading ? 'inkFaint' : 'inkDim'}
        align="center"
        accessibilityRole={isError ? 'alert' : undefined}
        accessibilityLiveRegion={isError ? 'polite' : 'none'}
      >
        {message}
      </Text>
      {action ? (
        <Button
          variant="secondary"
          title={action.label}
          fullWidth={false}
          onPress={action.onPress}
        />
      ) : null}
    </Screen>
  )
}
