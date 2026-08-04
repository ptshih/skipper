// THE AUDIO SESSION, and the one rule every skipper surface obeys.
//
// ⚠ EXCLUSIVE FOCUS IS A DECISION, NOT A DEFAULT (`docs/decisions/drive-audio-exclusive-focus.md`,
// and D35 for the pre-drive surfaces). The skipper takes the session outright whenever he speaks —
// the drive IS the audio, a curated soundtrack plus narration, not a voice-over that ducks under the
// rider's music. Ducking was tried and rejected. Both preview hooks argued the OPPOSITE ("a couch
// preview is polite, mix with others") until 1.1 step 8, which is exactly why the rule now has one
// home: it has already been softened once by someone reading only half of it.
//
// ⚠ AND IT IS PROCESS-WIDE, LAST WRITER WINS. Only one surface may own the mode at a time, so the
// difference between these two calls is not cosmetic: a drive plays in the BACKGROUND (the phone is
// in a mount, the screen sleeps, the drive continues), a preview does not (a clip that outlived the
// screen the rider left is the skipper talking to an empty car).
import { setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio'

/** Never `duckOthers`, never `mixWithOthers` — see the header before changing this. */
const SKIPPER_INTERRUPTION_MODE = 'doNotMix' as const

/** The DRIVING player's session: exclusive, and alive with the screen off. */
export function applyDriveAudioMode(): Promise<void> {
  return setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: SKIPPER_INTERRUPTION_MODE,
  }).catch(() => {})
}

/** A pre-drive preview clip: exclusive too, but foreground-only. */
export function applyPreviewAudioMode(): void {
  void setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: SKIPPER_INTERRUPTION_MODE,
  }).catch(() => {})
}

/**
 * Hand the session back to whatever the rider was playing.
 *
 * ⚠ THE OBLIGATION THAT PAIRS WITH TAKING IT, and it was written out twice — once for the drive,
 * once for previews — with two separate explanations of the same fact. Under `doNotMix` we STOPPED
 * the rider's music, and pausing a player does not give it back: iOS resumes them only once the
 * session is deactivated. Without this the car goes quiet after "you've arrived" and stays quiet
 * until something else happens to grab focus. A clip that FAILED took the session just as surely as
 * one that played, which is why the failure paths owe this call too.
 *
 * Fire-and-forget: a rejection here is never worth surfacing over whatever already went wrong, and
 * must never block finishing a drive.
 */
export function releaseAudioSession(): void {
  void setIsAudioActiveAsync(false).catch(() => {})
}
