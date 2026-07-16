// Curated "postcard" artwork for the /sample screen, keyed by the clip's poi QID.
//
// The sample is one founder-curated clip (SAMPLE_NARRATION_QID, server-side). Its postcard image is a
// WPA-style travel-poster illustration of that place — bundled (offline, no R2), not AI-photo (a faked
// photo of a real landmark fights the "honest, grounded, never invents" doctrine; a stylized poster
// doesn't claim to be real). Keyed by QID so it can NEVER show the wrong place: if the founder changes
// the sample clip, an unmapped QID falls back to the generic framed placeholder rather than mislabeling
// the art. Drop a new poster in `assets/brand/` and add one line here.
//
// If postcards ever generalize beyond the sample, move this to a server-served imageUrl on the DTO;
// for one curated clip, bundling is the least machinery.
import type { ImageSourcePropType } from 'react-native'

/** QID → bundled poster. Add one line per curated sample clip.
 *  (Q1335376 = Emerald Bay State Park, the current sample — see SAMPLE_NARRATION_QID.
 *   Art: a WPA-style Emerald Bay travel poster, founder-provided; resized to 1200×800 JPG.) */
const POSTCARDS: Record<string, ImageSourcePropType> = {
  Q1335376: require('../../assets/brand/postcard-emerald-bay.jpg'),
}

/** The poster for a sample clip, or undefined → the caller renders the generic framed placeholder. */
export function postcardImageFor(qid: string | undefined): ImageSourcePropType | undefined {
  return qid ? POSTCARDS[qid] : undefined
}
