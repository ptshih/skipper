import type { NativeStackHeaderProps } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../theme/ThemeProvider'
import { hit, space } from '../theme/tokens'
import { Text } from './Text'

/** Render the existing controls in React's accessible tree instead of a UIKit header wrapper. */
export function AppHeader({ back, options, route }: NativeStackHeaderProps) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const title = options.title ?? route.name
  const itemProps = { canGoBack: back != null, tintColor: colors.ink }
  return (
    <View pointerEvents="box-none" style={{ paddingTop: insets.top }}>
      <View pointerEvents="box-none" style={styles.row}>
        <View style={styles.left}>{options.headerLeft?.(itemProps)}</View>
        <View pointerEvents="none" style={styles.title}>
          {typeof options.headerTitle === 'function' ? (
            options.headerTitle({ children: title, tintColor: colors.ink })
          ) : (
            <Text variant="bodyStrong" color="ink" accessibilityRole="header" numberOfLines={1}>
              {options.headerTitle ?? title}
            </Text>
          )}
        </View>
        <View style={styles.right}>{options.headerRight?.(itemProps)}</View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { height: hit.min, justifyContent: 'center', marginHorizontal: space.lg },
  left: { position: 'absolute', left: 0 },
  right: { position: 'absolute', right: 0 },
  title: { marginHorizontal: hit.min + space.xxxl, alignItems: 'center' },
})
