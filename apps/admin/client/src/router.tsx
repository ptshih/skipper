import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { Layout } from './components/Layout'
import { RunsView } from './views/RunsView'
import { RegionsView } from './views/RegionsView'
import { ToursView } from './views/ToursView'
import { TourDetailView } from './views/TourDetailView'
import { CreateTourView } from './views/CreateTourView'
import { ReferenceView } from './views/ReferenceView'
import { PoisView } from './views/PoisView'
import { RoamView } from './views/RoamView'

// Code-based route tree (no file-based codegen) — the admin has a flat, fixed set of routes.
const rootRoute = createRootRoute({ component: Layout })

const toRuns = () => {
  throw redirect({ to: '/runs' })
}

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', beforeLoad: toRuns })
const runsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/runs', component: RunsView })
const regionsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/regions', component: RegionsView })
const toursRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tours', component: ToursView })
const tourDetailRoute = createRoute({ getParentRoute: () => rootRoute, path: '/tours/$id', component: TourDetailView })
const createTourRoute = createRoute({ getParentRoute: () => rootRoute, path: '/create', component: CreateTourView })
const referenceRoute = createRoute({ getParentRoute: () => rootRoute, path: '/reference', component: ReferenceView })
const poisRoute = createRoute({ getParentRoute: () => rootRoute, path: '/pois', component: PoisView })
const roamRoute = createRoute({ getParentRoute: () => rootRoute, path: '/roam', component: RoamView })
// Catch-all → /runs (replaces react-router's `path="*"` redirect).
const splatRoute = createRoute({ getParentRoute: () => rootRoute, path: '$', beforeLoad: toRuns })

const routeTree = rootRoute.addChildren([
  indexRoute,
  runsRoute,
  regionsRoute,
  toursRoute,
  tourDetailRoute,
  createTourRoute,
  referenceRoute,
  poisRoute,
  roamRoute,
  splatRoute,
])

export const router = createRouter({ routeTree, defaultPreload: 'intent', scrollRestoration: true })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
