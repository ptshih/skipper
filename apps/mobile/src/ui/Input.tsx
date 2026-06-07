// Themed text field. Token-driven, ≥48pt tall, with a pine focus ring.
import { useState } from 'react'
import { StyleSheet, TextInput, type TextInputProps } from 'react-native'
import { border, fonts, hit, radius, space } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'

export function Input({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <TextInput
      placeholderTextColor={colors.inkFaint}
      onFocus={(e) => {
        setFocused(true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(false)
        onBlur?.(e)
      }}
      style={[
        styles.input,
        {
          borderColor: focused ? colors.accent : colors.rule,
          backgroundColor: colors.surfaceRaised,
          color: colors.ink,
        },
        style,
      ]}
      {...props}
    />
  )
}

const styles = StyleSheet.create({
  input: {
    minHeight: hit.min,
    borderWidth: border.keyline,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    fontFamily: fonts.body,
    fontSize: 16,
  },
})
