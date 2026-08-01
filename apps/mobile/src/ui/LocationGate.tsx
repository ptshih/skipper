// The location-permission gate for the drive screen — a "smart" composite
// (like AccountGate) that owns the three-state message + action selection so the two screens
// can't drift: precise-location-off (reduced) and hard-denied-no-reprompt both route to
// Settings; only a still-askable denial offers the in-app "Switch on location" re-prompt. Each
// caller passes its own flag shape (useDrive's two booleans) + handlers, so the gate stays dumb.
import { StateView } from './StateView'
import { voice } from './voice'

export function LocationGate({
  title,
  reduced,
  canAskAgain,
  onAllow,
  onOpenSettings,
}: {
  title: string
  reduced: boolean
  canAskAgain: boolean
  onAllow: () => void
  onOpenSettings: () => void
}) {
  return (
    <StateView
      title={title}
      message={
        reduced ? voice.drive.locationReduced : canAskAgain ? voice.drive.locationNeeded : voice.drive.locationBlocked
      }
      tone="danger"
      action={
        reduced || !canAskAgain
          ? { label: voice.drive.locationSettings, onPress: onOpenSettings }
          : { label: voice.drive.locationAllow, onPress: onAllow }
      }
    />
  )
}
