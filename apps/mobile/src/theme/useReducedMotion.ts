// Honor the OS "Reduce Motion" preference. Peripheral motion is a real night-driving
// distraction (DESIGN §8), and the same concern applies when the user has asked the system
// to quiet animations — so the player's celebratory beats (the drive-complete stamp cascade,
// the rig's pull-in) fall back to their END STATE instantly when this is true.
import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (active) setReduced(v)
    })
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced)
    return () => {
      active = false
      sub.remove()
    }
  }, [])
  return reduced
}
