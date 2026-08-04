// THE DOUBLE-PUSH GUARD. expo-router does NOT de-dupe identical pushes, so a fast double-tap on a
// drive card stacks two identical detail screens on top of each other — and the rider has to press
// back twice to leave one drive.
//
// ⚠ IT WAS TWO COPIES, comments included (home and MY DRIVES), which is how a guard rots: the two
// screens that push into a drive are the two that must agree about what one tap means, and nothing
// would have failed if only one of them had been fixed.
//
// The RESET is the half worth reading. The flag is cleared when the screen regains focus — i.e. when
// the pushed screen has been popped, or the push never happened — rather than on a timer or in the
// pushing callback, because that is the only moment that actually means "the navigation this guard
// was holding is over". Owning it here means a caller cannot take the guard and forget the release.
import { useCallback, useRef } from 'react'
import { useFocusEffect } from 'expo-router'

/**
 * Returns a wrapper that runs a navigation exactly once until this screen is focused again.
 *
 * ```ts
 * const navigateOnce = useNavigateOnce()
 * navigateOnce(() => router.push({ pathname: '/drives/[id]', params: { id } }))
 * ```
 */
export function useNavigateOnce(): (go: () => void) => void {
  const navigating = useRef(false)

  useFocusEffect(
    useCallback(() => {
      // Any in-flight navigation has settled, or the rider backed out of it.
      navigating.current = false
    }, []),
  )

  return useCallback((go: () => void) => {
    if (navigating.current) return
    navigating.current = true
    go()
  }, [])
}
