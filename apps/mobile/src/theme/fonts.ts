// Font loading for the Trailhead 89 type system. Three families:
//   Alfa Slab One — the WPA silkscreen display (single weight)
//   Bitter        — the screen-tuned slab body (regular / semibold / bold)
//   Space Mono    — the odometer / permit numerals (regular / bold)
//
// `_layout.tsx` holds the splash screen until `useAppFonts()` reports ready, so no
// child ever renders before its fonts resolve (avoids a system-font flash).
import { useFonts } from 'expo-font'
import { Ionicons } from '@expo/vector-icons'
import { AlfaSlabOne_400Regular } from '@expo-google-fonts/alfa-slab-one'
import { Bitter_400Regular, Bitter_600SemiBold, Bitter_700Bold } from '@expo-google-fonts/bitter'
import { SpaceMono_400Regular, SpaceMono_700Bold } from '@expo-google-fonts/space-mono'

export function useAppFonts(): [boolean, Error | null] {
  return useFonts({
    AlfaSlabOne_400Regular,
    Bitter_400Regular,
    Bitter_600SemiBold,
    Bitter_700Bold,
    SpaceMono_400Regular,
    SpaceMono_700Bold,
    // the Ionicons glyph font — preloaded so icons paint with the first frame
    ...Ionicons.font,
  })
}
