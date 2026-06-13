// Sources & Licenses — the public attribution surface, reached from Settings → Credits.
// CC BY-SA / CC BY oblige us to credit our sources and link the license; this is where
// that credit lives app-wide (per-clip credit is frozen on tracks.attribution).
// The catalog is served by GET /sources (authoritative) so a new fact source credits
// without an App Store release; we seed from the bundled FALLBACK so the page never
// dead-ends offline, then upgrade to the live list. Theme roles only (no raw hex/font).
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import * as Linking from 'expo-linking'
import { Stack } from 'expo-router'
import { getSources } from '@/lib/api'
import {
  FALLBACK_DATA_SOURCES,
  MUSIC_CREDITS,
  MUSIC_FREE_NOTE,
  sourceHost,
  type DataSource,
} from '@/lib/licenses'
import { space } from '@/theme/tokens'
import { Card, Screen, Text, voice } from '@/ui'

const openUrl = (url: string) => {
  Linking.openURL(url).catch(() => {})
}

// `shrink` lets a long label (a host) give up width and ellipsize rather than push past the
// card edge — the fixed badge + separator hold their size, the host yields. Guards the row
// against deep URLs and large Dynamic Type sizes alike.
function LinkText({ label, url, shrink }: { label: string; url: string; shrink?: boolean }) {
  return (
    <Pressable
      onPress={() => openUrl(url)}
      accessibilityRole="link"
      // Clear the 48pt floor vertically (~23pt line + 2×12); keep horizontal slop tight so two
      // links sharing a row (license · source) don't overlap across the separator.
      hitSlop={{ top: space.md, bottom: space.md, left: space.xs, right: space.xs }}
      style={shrink ? styles.shrink : undefined}
    >
      <Text variant="bodyStrong" color="accent" numberOfLines={shrink ? 1 : undefined}>
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
                <LinkText label={sourceHost(source.sourceUrl)} url={source.sourceUrl} shrink />
              </View>
            </View>
          </Card>
        ))}
      </View>

      <View style={styles.section}>
        <Text variant="heading" color="ink">
          {voice.legal.musicHeading}
        </Text>
        <Text variant="dim" color="inkDim">
          {voice.legal.musicIntro}
        </Text>
      </View>

      <View style={styles.list}>
        {MUSIC_CREDITS.map((credit) => (
          <Card key={credit.artist}>
            <View style={styles.card}>
              <Text variant="heading" color="ink">
                {credit.artist}
              </Text>
              <Text variant="dim" color="inkDim">
                {credit.tracks.map((t) => `“${t}”`).join(', ')} · via {credit.via}
              </Text>
              <View style={styles.links}>
                <LinkText label={credit.license} url={credit.licenseUrl} />
                <Text variant="bodyStrong" color="inkFaint">
                  ·
                </Text>
                <LinkText label={sourceHost(credit.sourceUrl)} url={credit.sourceUrl} shrink />
              </View>
            </View>
          </Card>
        ))}
        <Text variant="dim" color="inkFaint">
          {MUSIC_FREE_NOTE}
        </Text>
      </View>

      <Text variant="dim" color="inkFaint">
        {voice.legal.footer}
      </Text>
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.lg },
  section: { gap: space.xs },
  list: { gap: space.md },
  card: { gap: space.sm },
  links: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  shrink: { flexShrink: 1 },
})
