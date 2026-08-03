import { describe, expect, test } from 'bun:test'
import { decideStart, routePermission, type PermissionFacts } from './location-util'

const perm = (o: Partial<PermissionFacts> = {}): PermissionFacts => ({
  granted: true,
  canAskAgain: true,
  reduced: false,
  ...o,
})

describe('decideStart', () => {
  test('never asked → prime, so the one-shot OS prompt is never spent without context', () => {
    // iOS prompts ONCE. Burning it cold is how an app earns a permanent denial from a rider who had
    // no idea what it was for — and the explainer is also an App Store 5.1.1(iv) obligation.
    expect(decideStart({ undetermined: true })).toBe('prime')
  })

  test('already decided → request straight through, NOT prime', () => {
    // The other direction matters just as much: an explainer shown to someone who already answered
    // leads to a CTA that opens no dialog at all. requestForegroundPermissionsAsync renders no UI on
    // a settled status, so requesting through is safe and a grant just rolls.
    expect(decideStart({ undetermined: false })).toBe('request')
  })
})

describe('routePermission', () => {
  test('granted and precise → proceed', () => {
    expect(routePermission(perm())).toEqual({ kind: 'proceed' })
  })

  test('GRANTED BUT REDUCED IS A DENIAL — the rule that looks like dead code', () => {
    // `granted` is TRUE here. A check that reads only `granted` compiles, reviews clean, and lets a
    // live drive start on iOS approximate location — and the whole trigger core is distance-based and
    // speed-adaptive, so approximate fixes fire stops in the wrong place or not at all. It presents
    // as "the triggering is broken", not as a permission problem, which is why it must be pinned.
    const route = routePermission(perm({ granted: true, reduced: true }))
    expect(route.kind).toBe('denied')
    // The caller splits on `granted` to tell "denied" apart from "granted but approximate" — so the
    // flag must survive the routing rather than being flattened to false.
    expect(route.kind === 'denied' && route.denial.granted).toBe(true)
    expect(route.kind === 'denied' && route.denial.reduced).toBe(true)
  })

  test('a hard denial routes to the gate with granted:false', () => {
    const route = routePermission(perm({ granted: false, reduced: false }))
    expect(route.kind).toBe('denied')
    expect(route.kind === 'denied' && route.denial.granted).toBe(false)
  })

  test('canAskAgain survives, because it decides the RECOVERY', () => {
    // false means the OS will not prompt again and the only way back is system Settings. Losing it
    // would leave the gate offering a re-ask that can never produce a dialog.
    const route = routePermission(perm({ granted: false, canAskAgain: false }))
    expect(route.kind === 'denied' && route.denial.canAskAgain).toBe(false)
    const again = routePermission(perm({ granted: false, canAskAgain: true }))
    expect(again.kind === 'denied' && again.denial.canAskAgain).toBe(true)
  })

  test('the denial is a COPY — the caller stores it in state', () => {
    const p = perm({ granted: false })
    const route = routePermission(p)
    p.canAskAgain = false
    expect(route.kind === 'denied' && route.denial.canAskAgain).toBe(true)
  })
})
