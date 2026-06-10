import { Redirect, useLocalSearchParams } from 'expo-router'

// Public share path for skipper.fm/t/<tourId> universal links. A shared link lands here and
// redirects to the canonical tour screen — which is already anonymous-previewable (the couch
// preview funnel), so a recipient without an account still sees the tour + Preview CTA.
// Keeping /t/ as the short, shareable face means the in-app route tree (tours/[id]) is
// untouched. The AASA file claims /t/* for the app (apps/api/src/share.ts); universal links
// require a dev/EAS build with the associated-domains entitlement — they don't fire in Expo Go.
export default function SharedTourRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>()
  if (!id) return <Redirect href="/" />
  return <Redirect href={{ pathname: '/tours/[id]', params: { id } }} />
}
