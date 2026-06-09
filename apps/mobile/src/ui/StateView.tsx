// The centered loading / error / empty state, shared across screens (kills the
// repeated `<Screen center><ActivityIndicator/><Text/>…` boilerplate). Pure
// presentation — the caller supplies the action's onPress.
import { ActivityIndicator } from 'react-native'
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
  return (
    <Screen scroll center>
      {title ? <Stack.Screen options={{ title }} /> : null}
      {loading ? <ActivityIndicator color={theme.colors.accent} /> : null}
      <Text
        variant={loading ? 'dim' : 'body'}
        color={tone === 'danger' ? 'danger' : loading ? 'inkFaint' : 'inkDim'}
        align="center"
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
