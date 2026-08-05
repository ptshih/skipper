import { useCallback, useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import { listRegions } from '@/lib/api'
import { markOnboarded } from '@/lib/client-flags'
import { readCachedRegion, writeCachedRegion } from '@/lib/region-cache'
import { pickRegionId } from '@/lib/region-select'
import type { Region } from '@skipper/shared'
import { space } from '@/theme/tokens'
import { Button, RegionChip, Screen, StateView, Text, useRegionPicker, voice } from '@/ui'

// /region-setup — onboarding step 2 of 2: "where are we driving?", asked once per install, between the
// postcard and the cold open.
//
// ⚠ WHY THIS SCREEN EXISTS AT ALL, given home already auto-selects a region: because the auto-select
// is SILENT. `pickRegionId` lands every rider on a region so the composer is never dead (its own header
// has the account of the dead-screen bug that rule was written for), but a rider who was never asked
// does not know a choice was made, does not know what the alternatives are, and — the part that
// matters — does not learn the shape of the product's coverage. Asking once, up front, converts an
// invisible default into an answer the rider gave. See docs/designs/onboarding-taste-then-where.md.
//
// ⚠ THE PICKER IS REAL FROM DAY ONE, with one region live. That is deliberate and it is the SECOND
// time this call has been made: `home-cold-open-declutter.md` §18 shipped the home chip as a plain
// label "until region 2", which combined with an auto-select that only fired at length 1 to produce an
// unrecoverable dead screen on installed builds. Regions are SERVER data — releasing one is a
// `released_at` flip, not an App Store submission — so anything here that behaves differently at
// length 1 than at length 2 is a latent kill switch. A one-row sheet is not embarrassing; it tells a
// newcomer the truth about coverage, which is what the postcard before it earned the goodwill for.
//
// ⚠ NO LOCATION PERMISSION IS ASKED HERE OR ANYWHERE IN ONBOARDING (founder, 2026-08-04). iOS's
// prompt is one-shot and a denial is recoverable only through Settings, so it is spent at the one
// moment it is obviously worth granting — "Let's roll", and only if we do not already have it. A
// "use my location" shortcut on this screen was designed, then cut: with one region it would spend
// that single prompt to compute an answer identical to the default.
//
// ⚠ IT MUST NOT BE REACHABLE ONCE ONBOARDING IS DONE. Nothing links here except the postcard's two
// exits, and home only redirects into the flow while `shouldShowOnboarding()` is true. The region is
// changeable forever afterwards from home's chip — the same `useRegionPicker` sheet — so this screen
// is a first-run question, never the settings surface for it.

// A module constant, not an inline literal: `Screen` pushes `options` through `navigation.setOptions`
// from a layout effect keyed on that object, and a fresh literal re-commits the native header on every
// render. (Blank on purpose — this is a full-bleed onboarding card, not a titled page, and there is no
// back chevron because the postcard `replace`d itself away.)
const BLANK_HEADER = { title: '' } as const

export default function RegionSetupScreen() {
  const router = useRouter()
  const pickRegion = useRegionPicker()

  const [regions, setRegions] = useState<Region[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [regionId, setRegionId] = useState<string | null>(null)

  // ⚠ `.then(…)` RATHER THAN `async/await`, AND IT IS NOT A STYLE CHOICE. The mount effect below calls
  // this, and `react-hooks/set-state-in-effect` follows the call: an `async` version sets state
  // "synchronously within an effect" as far as the rule is concerned, even with an `await` in front of
  // it, and fails the build. Written this way every `setState` lives inside a promise CALLBACK, which
  // is the shape the rule's own message names as correct ("subscribe for updates from some external
  // system, calling setState in a callback"). The alternative was a new entry in
  // `eslint-suppressions.json`, which is a BACKLOG to shrink, not a mute button (apps/mobile/CLAUDE.md).
  // ⚠ No unmount guard, matching the house pattern: React 18+ makes a setState on an unmounted
  // component a silent no-op, and this screen's only exit already replaces the whole route.
  const load = useCallback(() => {
    listRegions().then(
      (rs) => {
        setRegions(rs)
        // ⚠ SEEDED THROUGH `pickRegionId`, NOT `rs[0]`, so this screen and home can never disagree
        // about what "the current region" means. It also honours a cached choice, which is not dead
        // code here: a rider reinstalling over a restored backup arrives with a region already
        // remembered, and overriding it with the alphabetical first would be a worse answer.
        setRegionId(pickRegionId(rs, readCachedRegion()?.regionId))
        setFailed(false)
      },
      () => setFailed(true),
    )
  }, [])

  const retry = useCallback(() => {
    // Clear the error FIRST so the loading branch below can take over — the failure surface is keyed on
    // `failed && regions === null`, so leaving it set would hold the retry button on screen through the
    // whole re-fetch and read as a dead tap.
    setFailed(false)
    load()
  }, [load])

  useEffect(() => {
    load()
  }, [load])

  const region = regions?.find((r) => r.id === regionId) ?? null

  const openPicker = useCallback(() => {
    pickRegion({ regions: regions ?? [], selectedId: regionId, onSelect: setRegionId })
  }, [pickRegion, regions, regionId])

  const finish = useCallback(() => {
    // Persist the CHOICE before the flag, and the flag before navigating. Home re-reads both at mount:
    // it seeds its region from `readCachedRegion()` and decides whether to redirect from
    // `shouldShowOnboarding()`, so writing either one after `replace('/')` races the mount that reads
    // it — and losing the flag race is an onboarding loop rather than a cosmetic glitch.
    if (region) {
      // Names only, for the degraded/offline cards. `region-cache.ts`'s header owns what may live here;
      // `rotation` is deliberately not set, so home's cold open starts at window 0 on the first launch.
      writeCachedRegion({
        regionId: region.id,
        displayName: region.displayName,
        exampleAnchors: region.exampleAnchors,
      })
    }
    markOnboarded()
    // `replace`, so the back gesture from home cannot walk a finished rider into onboarding again.
    router.replace('/')
  }, [region, router])

  if (regions === null && !failed)
    return (
      <>
        <Stack.Screen options={BLANK_HEADER} />
        <StateView loading message={voice.region.setupTitle} />
      </>
    )

  // ⚠ THE FAILURE PATH STILL LETS THEM THROUGH, and that is the important decision on this screen. A
  // dead `/regions` on first launch must not trap a new install behind a retry button forever: home is
  // built to survive having no region (it shows the in-persona outage card and retries the same load),
  // so the honest move is to offer the retry AND a way past it. Marking onboarded on the way past is
  // correct — the rider has seen both screens; the network failed, not the flow. This is hand-rolled
  // rather than a `StateView` because that primitive carries exactly one action, and the second one is
  // the whole point here.
  if (failed && regions === null)
    return (
      <Screen padded center contentContainerStyle={styles.body}>
        <Stack.Screen options={BLANK_HEADER} />
        <Text variant="body" color="danger" align="center" accessibilityRole="alert">
          {voice.error.generic}
        </Text>
        <View style={styles.actions}>
          <Button title={voice.error.retry} onPress={retry} />
          <Button variant="ghost" title={voice.region.setupCta} onPress={finish} />
        </View>
      </Screen>
    )

  return (
    <Screen padded center contentContainerStyle={styles.body}>
      <Stack.Screen options={BLANK_HEADER} />
      <View style={styles.copy}>
        <Text variant="display" color="ink" align="center">
          {voice.region.setupTitle}
        </Text>
        <Text variant="body" color="inkDim" align="center">
          {voice.region.setupBody}
        </Text>
      </View>

      <View style={styles.field}>
        <Text variant="label" color="inkDim">
          {voice.region.setupLabel}
        </Text>
        {/* ⚠ `onPress` is passed WHENEVER A LIST EXISTS, never gated on "is there more than one" —
            RegionChip's own header is a monument to that bug. With a list of one the sheet is a
            one-row answer to "which roads?", which is a real answer. */}
        <RegionChip
          regionName={region?.displayName ?? null}
          onPress={(regions?.length ?? 0) > 0 ? openPicker : undefined}
        />
      </View>

      {/* Disabled until something is selected: this screen's whole job is to come away with an answer,
          and `finish` with no region would write no cache and land home on its silent auto-select —
          the exact outcome the screen exists to replace. */}
      <Button title={voice.region.setupCta} onPress={finish} disabled={!region} />
    </Screen>
  )
}

const styles = StyleSheet.create({
  body: { gap: space.xl },
  // ⚠ NO SUNBURST HERE, and it was tried. The postcard end card floats one at `top: -40`, which works
  // there because that card is not vertically centred; on this screen the absolute child measures from
  // the parent's BORDER BOX, so the same offset threw the motif off the top of the screen and straight
  // into the Dynamic Island. Caught on the simulator, invisible to typecheck. The screen is calmer
  // without it anyway — the postcard immediately before it is carrying the visual weight.
  copy: { gap: space.md },
  field: { gap: space.sm, alignItems: 'center' },
  actions: { gap: space.sm, alignSelf: 'stretch' },
})
