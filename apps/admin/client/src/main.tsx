import React from 'react'
import ReactDOM from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { router } from './router'
import { ErrorBoundary, renderBootError } from './components/ErrorBoundary'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
})

const root = document.getElementById('root')!

// Guard the blank-white-screen failure mode (TODO.md "admin local-dev resilience"): if a fatal
// error fires before React paints anything (e.g. a dual-React mismatch, which an ErrorBoundary
// can't catch because it crashes during the deferred first render), show a legible fallback
// instead of nothing. Only fires while #root is still empty — once the app paints, this no-ops.
const onFatal = (error: unknown) => {
  if (root.childElementCount === 0) renderBootError(root, error)
}
window.addEventListener('error', (e) => onFatal(e.error ?? e.message))
window.addEventListener('unhandledrejection', (e) => onFatal(e.reason))

try {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>,
  )
} catch (e) {
  renderBootError(root, e)
}
