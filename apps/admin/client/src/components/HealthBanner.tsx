import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Callout } from '@/components/ui/callout'

// A top-of-page banner that makes an unhealthy admin-api VISIBLE instead of letting every view
// degrade into its own scattered "Error loading…" callout (the "just errors out" failure mode in
// TODO "Admin local-dev resilience"). Polls GET /health?deep=1 and distinguishes the two ways the
// backend breaks: the process being down/restarting (the probe rejects) vs. the process being up
// but unable to reach the DB (DATABASE_URL unset / DB unreachable — `db: false` in the body).
export function HealthBanner() {
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: api.health,
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 0,
  })

  // Probe rejected (fetch error) or the vite proxy 502'd — the api process is down or restarting.
  if (isError) {
    return (
      <Callout variant="error" className="mb-6">
        <span className="font-medium">admin-api unreachable.</span> The ops server (<code className="font-mono">:8788</code>)
        is down or restarting. Check the <code className="font-mono">server</code> pane of{' '}
        <code className="font-mono">bun run dev:admin</code> — it auto-restarts on save/crash, so this should clear on its own.
      </Callout>
    )
  }

  // Probe reached the api but its DB ping failed — DATABASE_URL is likely unset or the DB is down.
  if (data?.db === false) {
    return (
      <Callout variant="error" className="mb-6">
        <span className="font-medium">admin-api can't reach the database.</span> The server is up but the DB is
        unreachable — <code className="font-mono">DATABASE_URL</code> may be unset. Every data view will 500 until it recovers.
        {data.dbError ? <span className="mt-1 block font-mono text-xs opacity-80">{data.dbError}</span> : null}
      </Callout>
    )
  }

  return null
}
