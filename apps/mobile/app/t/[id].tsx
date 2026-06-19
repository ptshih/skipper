import { Redirect, useLocalSearchParams } from 'expo-router'

// Public share path for skipper.fm/t/<id> universal links — the short, shareable face that keeps
// the in-app route tree (drives/[id]) untouched. The AASA file claims /t/* for the app
// (apps/api/src/share.ts); universal links require a dev/EAS build with the associated-domains
// entitlement — they don't fire in Expo Go.
//
// V2 NOTE: drives are user-OWNED (account-gated), not anonymous-shareable like V1 tours, so a
// recipient who doesn't own this drive lands on the account/empty gate at the drive screen.
// Cross-user drive sharing isn't a V2 feature yet — this redirect just keeps the link valid for
// the owner's own devices.
export default function SharedDriveRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>()
  if (!id) return <Redirect href="/" />
  return <Redirect href={{ pathname: '/drives/[id]', params: { id } }} />
}
