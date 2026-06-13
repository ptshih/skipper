// Honor the OS "Reduce Motion" preference. Peripheral motion is a real night-driving
// distraction (DESIGN §8), and the same concern applies when the user has asked the system
// to quiet animations — so the player's celebratory beats (the drive-complete stamp cascade,
// the rig's pull-in) fall back to their END STATE instantly when this is true.
import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

export function useReducedMotion(): boolean {
  // ACCEPTED ONE-FRAME RACE: there is no synchronous read of the OS Reduce-Motion flag —
  // AccessibilityInfo.isReduceMotionEnabled() is async — so the hook seeds `false` and flips
  // on resolve. A Reduce-Motion user can therefore see at most ONE animated frame before the
  // first effect resolves (entrance beats). We tolerate that: the alternative (threading a
  // synchronously-seeded value down from a provider in _layout) is out of this hook's scope,
  // and our motion is short/celebratory, not strobing. The subscription below also keeps the
  // value live if the user toggles the setting while a screen is mounted.
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) setReduced(v)
    })
    // Subscribe so a mid-session toggle of the OS setting updates consumers; clean up on unmount.
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      active = false
      sub.remove()
    }
  }, [])
  return reduced
}
