// Region selection, as the PLATFORM's own picker (founder, 2026-08-03: "can we just use a native
// picker instead").
//
// ⚠ This was a hand-built bottom sheet — a transparent Modal with a scrim, a cream placard, a
// swallowed inner press and a Done row — and it is gone deliberately. It also never scrolled (no
// ScrollView), so a tenth region would have pushed its own dismiss control off the screen.
//
// ⚠ WHY A LIBRARY RATHER THAN `ActionSheetIOS` + an `Alert` FALLBACK, which is what the drive ⋯ menu
// still does: `Alert` accepts AT MOST THREE buttons on Android — documented, not a quirk ("Android
// has a concept of a neutral, negative and a positive button", RN docs) — so a region list of any
// real length silently lost rows on that path, with no error and no truncation notice. `Alert` is
// also the wrong component semantically: it announces, it does not offer a choice.
// `@expo/react-native-action-sheet` delegates to the REAL `ActionSheetIOS` on iOS (a
// UIAlertController that scrolls past any option count) and renders a scrollable sheet on Android,
// so there is one code path and no `Platform.OS` fork here at all.
//
// A HOOK, not a bare function: the sheet is served by a provider at the app root (`app/_layout`),
// which is also what makes it themeable per call. The caller still gets one imperative
// `open(args)` to hand to an onPress.
//
// ⚠ The current region keeps its CHECK, now as a "✓ " prefix on its label. The old sheet drew it as
// a glyph and the reasoning still holds — this is a list of roads the skipper knows, and a filled or
// highlighted row would borrow FilterChip's "pressed enamel" meaning. A sheet has no selected-row
// API (that is a UIMenu affordance, which none of this exposes), so the mark lives in the string.
// U+2713 is safe here specifically BECAUSE this is native chrome: the tofu risk that keeps glyphs
// out of our own labels is about the app's custom Lora/Zilla faces, and a native sheet renders in
// the system font.
import { useCallback } from 'react'
import { useThemedActionSheet } from './actionSheet'
import { voice } from './voice'

/** Just enough of a region to name and identify it — never the bbox, never the anchors. */
export interface PickableRegion {
  id: string
  displayName: string
}

export interface RegionPickerArgs {
  regions: readonly PickableRegion[]
  /** The region the conversation is currently pinned to, or null before one is chosen. */
  selectedId: string | null
  /** Called with the chosen id. Not called when the rider dismisses. */
  onSelect: (id: string) => void
}

export function useRegionPicker(): (args: RegionPickerArgs) => void {
  const showActionSheet = useThemedActionSheet()

  return useCallback(
    ({ regions, selectedId, onSelect }: RegionPickerArgs) => {
      // Nothing to choose between: never open an empty sheet the rider has to dismiss.
      if (regions.length === 0) return
      const label = (r: PickableRegion) => (r.id === selectedId ? `✓ ${r.displayName}` : r.displayName)
      showActionSheet(
        {
          title: voice.region.heading,
          // 'Cancel', not the old sheet's 'Done': picking a row commits immediately, so the trailing
          // button is a way OUT, not a way to confirm.
          options: [...regions.map(label), 'Cancel'],
          cancelButtonIndex: regions.length,
        },
        (i) => {
          const chosen = i == null ? undefined : regions[i]
          if (chosen) onSelect(chosen.id)
        },
      )
    },
    [showActionSheet],
  )
}
