// Per-clip source credit — the CC BY-SA obligation, made visible.
//
// The app-wide Sources & Licenses screen (app/legal.tsx) credits the SOURCES in general; this
// credits the actual work THIS clip adapted, at the moment it plays. That distinction is the legal
// one: CC BY-SA asks for attribution wherever the adapted work is presented, naming the work and
// linking the license — a catalog on a settings sub-screen doesn't carry a specific narration's
// credit, and every clip already carries its own frozen snapshot (`narrations.attribution`,
// populated at generation). It was on the wire and rendered nowhere; this renders it.
//
// Deliberately quiet: a line of small faint text under the stop, not a banner. The credit has to be
// PRESENT and reachable, not loud — and this sits on a screen someone glances at while driving.
// Named SourceCredit, not Attribution, so it can't be confused with the `Attribution` wire type.
import { Pressable, StyleSheet, View } from 'react-native'
import * as Linking from 'expo-linking'
import type { Attribution } from '@skipper/shared'
import { attributionSourceLabel, licenseDeedUrl } from '@/lib/licenses'
import { space } from '@/theme/tokens'
import { Text } from './Text'

const openUrl = (url: string) => {
  Linking.openURL(url).catch(() => {})
}

/** One tappable credit atom. Falls back to plain text when we have no URL to point at — the credit
 *  itself is the obligation; the link is the bonus. */
function CreditAtom({ label, url }: { label: string; url?: string }) {
  if (!url) {
    return (
      <Text variant="dim" color="inkFaint">
        {label}
      </Text>
    )
  }
  return (
    <Pressable
      onPress={() => openUrl(url)}
      accessibilityRole="link"
      // Vertical slop only: these atoms sit inline separated by a thin "·", so horizontal slop
      // would overlap the neighbour's tap target (the legal.tsx LinkText precedent).
      hitSlop={{ top: space.sm, bottom: space.sm }}
    >
      <Text variant="dim" color="accent">
        {label}
      </Text>
    </Pressable>
  )
}

export interface SourceCreditProps {
  /** The clip's frozen attribution array. Undefined/empty renders nothing. */
  items?: Attribution[]
}

/**
 * Renders "Wikipedia · CC BY-SA 4.0" (linked where possible), one row per source a clip drew on.
 * Renders NOTHING when there's no attribution — scenic and break clips carry none by design (they
 * ground on no source text), so an empty row would be noise, not honesty.
 */
export function SourceCredit({ items }: SourceCreditProps) {
  if (!items?.length) return null
  return (
    <View style={styles.wrap}>
      {items.map((item) => {
        const deed = item.license ? licenseDeedUrl(item.license) : undefined
        return (
          <View key={`${item.source}:${item.sourceId}`} style={styles.row}>
            <Text variant="dim" color="inkFaint">
              Source:
            </Text>
            {/* The work itself — `title` when the snapshot froze one, else the source's name. */}
            <CreditAtom label={item.title ?? attributionSourceLabel(item.source)} url={item.url} />
            {item.license ? (
              <>
                <Text variant="dim" color="inkFaint">
                  ·
                </Text>
                <CreditAtom label={item.license} url={deed} />
              </>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  // Wraps rather than truncates: a long article title must not push the license (the part CC
  // actually requires a link to) off the edge of the screen.
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs },
})
