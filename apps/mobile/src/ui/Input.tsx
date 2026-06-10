// Themed text field. Token-driven, ≥48pt tall, with a pine focus ring. Forwards a
// ref to the underlying TextInput so forms can chain the return key (email → password).
import { forwardRef, useState } from 'react'
import { StyleSheet, TextInput, type TextInputProps } from 'react-native'
import { border, hit, radius, space, typeScale } from '../theme/tokens'
import { useTheme } from '../theme/ThemeProvider'

export const Input = forwardRef<TextInput, TextInputProps>(function Input(
  { style, onFocus, onBlur, ...props },
  ref,
) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <TextInput
      ref={ref}
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
})

const styles = StyleSheet.create({
  input: {
    ...typeScale.body, // compose the body variant (font + size) — no parallel copy
    // …but NOT its 23px lineHeight: an explicit lineHeight on a single-line TextInput
    // clips descenders (g/p/y) on iOS. Let the control center text with natural metrics.
    lineHeight: undefined,
    minHeight: hit.min,
    borderWidth: border.keyline,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
})
