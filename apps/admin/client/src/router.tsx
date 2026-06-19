import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { Layout } from './components/Layout'
import { RunsView } from './views/RunsView'
import { RegionsView } from './views/RegionsView'
import { ReferenceView } from './views/ReferenceView'
import { PoisView } from './views/PoisView'

// Code-based route tree (no file-based codegen) — the admin has a flat, fixed set of routes.
const rootRoute = createRootRoute({ component: Layout })

const toRuns = () => {
  throw redirect({ to: '/runs' })
}

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', beforeLoad: toRuns })
const runsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/runs', component: RunsView })
const regionsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/regions', component: RegionsView })
const referenceRoute = createRoute({ getParentRoute: () => rootRoute, path: '/reference', component: ReferenceView })
export type PoiAction = 'discover' | 'generate' | 'rescore'
export interface PoisSearch {
  /** Deep-link (one-shot, stripped after consuming): open this POI's detail sheet on mount. */
  poi?: string
  /** Deep-link (one-shot, stripped after consuming): open this header dialog on mount. */
  act?: PoiAction
}
// Plain validator (apps/admin has no zod dep) — coerce + whitelist, drop anything else.
const poisRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pois',
  component: PoisView,
  validateSearch: (search: Record<string, unknown>): PoisSearch => {
    const out: PoisSearch = {}
    if (typeof search.poi === 'string' && search.poi) out.poi = search.poi
    if (search.act === 'discover' || search.act === 'generate' || search.act === 'rescore') out.act = search.act
    return out
  },
})
// Catch-all → /runs (replaces react-router's `path="*"` redirect).
const splatRoute = createRoute({ getParentRoute: () => rootRoute, path: '$', beforeLoad: toRuns })

const routeTree = rootRoute.addChildren([
  indexRoute,
  runsRoute,
  regionsRoute,
  referenceRoute,
  poisRoute,
  splatRoute,
])

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
