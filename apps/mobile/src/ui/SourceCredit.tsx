// The rows of source credit — one small "work · license" line per source a clip drew on, each
// part tappable (work → the article, license → the CC deed). This is the BODY of the unified
// attribution reveal: `AttributionButton` renders it inside the ⓘ tap-sheet on the drive player,
// and the anonymous sample. It is not mounted on its own anywhere —
// the ⓘ is the affordance, this is what the ⓘ shows.
//
// Naming the specific work + linking the license is the attribution CC BY-SA / CC BY require
// wherever the adapted work is presented (a general Settings catalog names the platform, not the
// article, so it can't stand in for this). Named SourceCredit, not Attribution, so it can't be
// confused with the `Attribution` wire type.
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
