// Sources & Licenses — the public attribution surface, reached from Settings → Credits.
// CC BY-SA / CC BY oblige us to credit our sources and link the license; this is where
// that credit lives app-wide (per-clip credit is frozen on poi_content.attribution).
// The catalog is served by GET /sources (authoritative) so a new fact source credits
// without an App Store release; we seed from the bundled FALLBACK so the page never
// dead-ends offline, then upgrade to the live list. Theme roles only (no raw hex/font).
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import * as Linking from 'expo-linking'
import { Stack } from 'expo-router'
import { getSources } from '@/lib/api'
import { FALLBACK_DATA_SOURCES, sourceHost, type DataSource } from '@/lib/licenses'
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
  // Seed with the bundled fallback (instant render, survives offline), then upgrade to the
  // live /sources list. On failure we keep the fallback — a legal page must never dead-end.
  const [sources, setSources] = useState<DataSource[]>(FALLBACK_DATA_SOURCES)
  useEffect(() => {
    let cancelled = false
    getSources()
      .then((live) => {
        if (!cancelled && live.length > 0) setSources(live)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Screen scroll padded edges={['bottom']} contentContainerStyle={styles.body}>
      <Stack.Screen options={{ title: voice.legal.title }} />

      <Text variant="body" color="inkDim">
        {voice.legal.intro}
      </Text>

      <View style={styles.list}>
        {sources.map((source) => (
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
