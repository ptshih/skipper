// Sources & Licenses — the public attribution surface, reached from Settings → Credits.
// CC BY-SA / CC BY oblige us to credit our sources and link the license; this is where
// that credit lives app-wide (per-clip credit is frozen on poi_content.attribution).
// The source list + license codes are FACTS — they live in @/lib/licenses; only the
// intro is the skipper's (delivery, never facts). Theme roles only (no raw hex/font).
import { Pressable, StyleSheet, View } from 'react-native'
import * as Linking from 'expo-linking'
import { Stack } from 'expo-router'
import { DATA_SOURCES, sourceHost } from '@/lib/licenses'
import { space } from '@/theme/tokens'
import { Card, Screen, Text, voice } from '@/ui'

const openUrl = (url: string) => {
  Linking.openURL(url).catch(() => {})
}

function LinkText({ label, url }: { label: string; url: string }) {
  return (
    <Pressable onPress={() => openUrl(url)} accessibilityRole="link" hitSlop={space.sm}>
      <Text variant="bodyStrong" color="accent">
        {label}
      </Text>
    </Pressable>
  )
}

export default function LegalScreen() {
  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: voice.legal.title }} />

      <Text variant="body" color="inkDim">
        {voice.legal.intro}
      </Text>

      <View style={styles.list}>
        {DATA_SOURCES.map((source) => (
          <Card key={source.name}>
            <View style={styles.card}>
              <Text variant="heading" color="ink">
                {source.name}
              </Text>
              <Text variant="dim" color="inkDim">
                {source.use}
              </Text>
              {source.note ? (
                <Text variant="dim" color="inkFaint">
                  {source.note}
                </Text>
              ) : null}
              <View style={styles.links}>
                {source.license ? (
                  source.licenseUrl ? (
                    <LinkText label={source.license} url={source.licenseUrl} />
                  ) : (
                    <Text variant="bodyStrong" color="ink">
                      {source.license}
                    </Text>
                  )
                ) : null}
                {source.license ? (
                  <Text variant="bodyStrong" color="inkFaint">
                    ·
                  </Text>
                ) : null}
                <LinkText label={sourceHost(source.sourceUrl)} url={source.sourceUrl} />
              </View>
            </View>
          </Card>
        ))}
      </View>

      <Text variant="dim" color="inkFaint">
        {voice.legal.footer}
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
  list: { gap: space.md },
  card: { gap: space.sm },
  links: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
})
