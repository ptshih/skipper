// The app's ONE action sheet — every native sheet's look, in one expression.
//
// ⚠ WHY THIS EXISTS RATHER THAN `useActionSheet()` AT EACH CALL SITE. A sheet takes six styling
// options (the iOS interface style plus the five that colour Android's own sheet), and there are two
// callers already — the region picker and the drive ⋯ menu. Two copies of six values is precisely the
// drift this repo keeps paying for: the second sheet would have looked right on the day it was
// written and then quietly stopped matching the first the next time a role changed. Callers pass what
// is DIFFERENT (title, options, which one is destructive); the theme is not theirs to restate.
//
// On iOS the library delegates to the real `ActionSheetIOS`, so `userInterfaceStyle` is the only
// styling that applies — UIKit draws the rest. On Android the sheet is drawn in JS, which is why it
// takes our semantic roles directly.
import { useCallback } from 'react'
import { useActionSheet, type ActionSheetOptions } from '@expo/react-native-action-sheet'
import { useTheme } from '../theme/ThemeProvider'

export type ShowActionSheet = (
  options: ActionSheetOptions,
  callback: (index?: number) => void,
) => void

export function useThemedActionSheet(): ShowActionSheet {
  const { showActionSheetWithOptions } = useActionSheet()
  const { colors, isDark } = useTheme()

  return useCallback(
    (options, callback) => {
      showActionSheetWithOptions(
        {
          userInterfaceStyle: isDark ? 'dark' : 'light',
          containerStyle: { backgroundColor: colors.surfaceRaised },
          textStyle: { color: colors.ink },
          titleTextStyle: { color: colors.inkFaint },
          tintColor: colors.ink,
          destructiveColor: colors.danger,
          // Caller last: it owns the CONTENT (and may override a colour deliberately), never the
          // other way round — a spread that put the theme last would silently ignore every call.
          ...options,
        },
        callback,
      )
    },
    [showActionSheetWithOptions, colors, isDark],
  )
}
