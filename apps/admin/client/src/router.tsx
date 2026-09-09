import { createRootRoute, createRoute, createRouter, Link, redirect } from '@tanstack/react-router'
import { Layout } from './components/Layout'
import { JobsView } from './views/JobsView'
import { EvalsView } from './views/EvalsView'
import { RegionsView } from './views/RegionsView'
import { ReferenceView } from './views/ReferenceView'
import { PoisView } from './views/PoisView'
import { PlacesView } from './views/PlacesView'
import { UsersView } from './views/UsersView'
import { ListeningView } from './views/ListeningView'
import { DrivesView } from './views/DrivesView'

// Code-based route tree (no file-based codegen) — the admin has a flat, fixed set of routes.
const rootRoute = createRootRoute({ component: Layout })

const toJobs = () => {
  throw redirect({ to: '/jobs' })
}

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', beforeLoad: toJobs })
export interface RunsSearch {
  /** Deep-link (one-shot, stripped after consuming): open this run's drawer on mount. */
  run?: string
}
// Shared deep-link search validator for the two run pages.
const validateRunSearch = (search: Record<string, unknown>): RunsSearch =>
  typeof search.run === 'string' && search.run ? { run: search.run } : {}
const jobsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/jobs',
  component: JobsView,
  validateSearch: validateRunSearch,
})
const evalsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/evals',
  component: EvalsView,
  validateSearch: validateRunSearch,
})
const regionsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/regions', component: RegionsView })
const placesRoute = createRoute({ getParentRoute: () => rootRoute, path: '/places', component: PlacesView })
const usersRoute = createRoute({ getParentRoute: () => rootRoute, path: '/users', component: UsersView })
export interface DrivesSearch {
  /** Deep-link (one-shot, stripped after consuming): open this drive's detail sheet on mount. */
  drive?: string
}
const drivesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/drives',
  component: DrivesView,
  validateSearch: (search: Record<string, unknown>): DrivesSearch =>
    typeof search.drive === 'string' && search.drive ? { drive: search.drive } : {},
})
const listeningRoute = createRoute({ getParentRoute: () => rootRoute, path: '/listening', component: ListeningView })
const referenceRoute = createRoute({ getParentRoute: () => rootRoute, path: '/reference', component: ReferenceView })
export interface PoisSearch {
  /** Deep-link (one-shot, stripped after consuming): open this POI's detail sheet on mount. */
  poi?: string
}
// Plain validator (apps/admin has no zod dep) — coerce + whitelist, drop anything else.
const poisRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pois',
  component: PoisView,
  validateSearch: (search: Record<string, unknown>): PoisSearch => {
    const out: PoisSearch = {}
    if (typeof search.poi === 'string' && search.poi) out.poi = search.poi
    return out
  },
})
const routeTree = rootRoute.addChildren([
  indexRoute,
  jobsRoute,
  evalsRoute,
  regionsRoute,
  placesRoute,
  usersRoute,
  drivesRoute,
  referenceRoute,
  listeningRoute,
  poisRoute,
])

// Unmatched paths (including the retired /runs) dead-end here — no redirect. Configuring this also
// replaces TanStack's bare <p>Not Found</p> default (and clears its dev warning).
function NotFound() {
  return (
    <div className="py-20 text-center">
      <p className="text-base font-medium text-foreground">Page not found</p>
      <p className="mt-1 text-sm text-muted-foreground">That page doesn’t exist.</p>
      <Link to="/jobs" className="mt-4 inline-block text-sm font-medium underline underline-offset-4">
        Go to Jobs
      </Link>
    </div>
  )
}

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
  defaultNotFoundComponent: NotFound,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
