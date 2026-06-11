// Font loading for the Trailhead 89 type system. Three families:
//   Zilla Slab    — constructed park-sign display slab (600 / 700)
//   Lora          — calligraphic screen slab for all body/UI text (400 / 600 / 700)
//   Overpass Mono — highway-sign / odometer numerals (400 / 600 / 700)
//
// `_layout.tsx` holds the splash screen until `useAppFonts()` reports ready, so no
// child ever renders before its fonts resolve (avoids a system-font flash).
import { useFonts } from 'expo-font'
import { Ionicons } from '@expo/vector-icons'
import { ZillaSlab_600SemiBold, ZillaSlab_700Bold } from '@expo-google-fonts/zilla-slab'
import { Lora_400Regular, Lora_600SemiBold, Lora_700Bold } from '@expo-google-fonts/lora'
import {
  OverpassMono_400Regular,
  OverpassMono_600SemiBold,
  OverpassMono_700Bold,
} from '@expo-google-fonts/overpass-mono'

export function useAppFonts(): [boolean, Error | null] {
  return useFonts({
    ZillaSlab_600SemiBold,
    ZillaSlab_700Bold,
    Lora_400Regular,
    Lora_600SemiBold,
    Lora_700Bold,
    OverpassMono_400Regular,
    OverpassMono_600SemiBold,
    OverpassMono_700Bold,
    // the Ionicons glyph font — preloaded so icons paint with the first frame
    ...Ionicons.font,
  })
}
