// A rule. Hairline by default; `dashed` renders the atlas-trail dashed line used
// between sections and under the now-card hint.
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { border } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'

export interface DividerProps {
  dashed?: boolean
  style?: StyleProp<ViewStyle>
}

export function Divider({ dashed, style }: DividerProps) {
  const theme = useTheme()
  return (
    <View
      style={[
        dashed
          ? {
              borderTopWidth: border.keyline,
              borderStyle: 'dashed',
              borderColor: theme.colors.rule,
            }
          : { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.rule },
        style,
      ]}
    />
  )
}
