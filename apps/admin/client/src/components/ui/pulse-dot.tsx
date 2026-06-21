// A small pulsing dot indicating a live / in-flight state (a running job, an active poll, …).
export function PulseDot() {
  return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-current" />
}
