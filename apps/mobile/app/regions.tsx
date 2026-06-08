import { StyleSheet, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { useDrivesFilter } from '@/lib/drives-filter'
import { space } from '@/theme/tokens'
import { Card, Divider, HeaderIconButton, Icon, Screen, Text, voice } from '@/ui'

// The "Where are we headed?" location picker — a modal sheet (chosen over an inline expand)
// for a focused "board" moment. Lists the regions the skipper has charted (derived from the
// catalog, published into the filter context by the home screen) + an "All regions" reset.
// Picking a row sets the filter and dismisses. No GPS, no geocoder, no map — the curated set
// is small and known, so a tap-list beats a search box and works offline in Tahoe dead
// zones. The "Drives near you" shortcut is deferred (v2, behind expo-location) and absent.
export default function RegionsScreen() {
  const router = useRouter()
  const { regions, selectedRegion, setSelectedRegion } = useDrivesFilter()

  const choose = (region: string | null) => {
    setSelectedRegion(region)
    router.back()
  }

  // A modal dismisses, it doesn't go "back" — so the global back-chevron is replaced by an
  // X (and the iOS-26 Liquid Glass capsule stripped, like the rest of our header chrome).
  const closeButton = (
    <HeaderIconButton name="close" accessibilityLabel="Close" onPress={() => router.back()} />
  )

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen
        options={{
          headerTitle: () => (
            <Text variant="title" color="ink">
              {voice.home.where.title}
            </Text>
          ),
          headerLeft: () => closeButton,
          unstable_headerLeftItems: () => [
            { type: 'custom', hidesSharedBackground: true, element: closeButton },
          ],
        }}
      />

      <RegionRow
        label={voice.home.where.all}
        selected={selectedRegion === null}
        onPress={() => choose(null)}
      />
      <Divider />
      {regions.map((opt) => (
        <RegionRow
          key={opt.region}
          label={opt.region}
          meta={`${opt.count} ${opt.count === 1 ? 'drive' : 'drives'}`}
          selected={selectedRegion === opt.region}
          onPress={() => choose(opt.region)}
        />
      ))}
    </Screen>
  )
}

function RegionRow({
  label,
  meta,
  selected,
  onPress,
}: {
  label: string
  meta?: string
  selected: boolean
  onPress: () => void
}) {
  return (
    <Card onPress={onPress} active={selected}>
      <View style={styles.row}>
        <Icon name={selected ? 'check' : 'region'} size={20} color={selected ? 'accent' : 'inkDim'} />
        <Text variant="title" color="ink" style={styles.flex} numberOfLines={1}>
          {label}
        </Text>
        {meta ? (
          <Text variant="dim" color="inkFaint">
            {meta}
          </Text>
        ) : null}
      </View>
    </Card>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  flex: { flex: 1 },
})
