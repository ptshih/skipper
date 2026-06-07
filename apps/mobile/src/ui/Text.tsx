// The one text primitive. `variant` picks a type-scale entry; `color` is a
// SEMANTIC role only (no raw hex reaches a screen). Default body/ink.
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native'
import { typeScale, type TypeVariant } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'
import type { ThemeColors } from '../theme/theme'

export interface TextProps extends RNTextProps {
  variant?: TypeVariant
  color?: keyof ThemeColors
  align?: TextStyle['textAlign']
}

export function Text({ variant = 'body', color = 'ink', align, style, ...rest }: TextProps) {
  const theme = useTheme()
  return (
    <RNText
      style={[
        typeScale[variant],
        { color: theme.colors[color] },
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    />
  )
}
