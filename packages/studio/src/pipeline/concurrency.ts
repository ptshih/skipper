// Bounded fan-out for independent async work (TTS clips, scout runs, poi upserts).
//
// Plain worker-pool mapLimit: results keep ITEM ORDER (callers zip them back against
// the input array), concurrency never exceeds `limit`, and the pool FAILS FAST — the
// first rejection stops workers from pulling new items and propagates to the caller
// (in-flight siblings settle in the background; their results are dropped). That
// the caller owns fault isolation: the generate loops wrap each item in try/catch (skip + warn +
// continue), so mapLimit fails fast ONLY on an uncaught throw — it just no longer wastes a serial tail.

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async (): Promise<void> => {
    while (!failed) {
      const i = next++
      if (i >= items.length) return
      try {
        results[i] = await fn(items[i]!, i)
      } catch (e) {
        failed = true // stop every worker from PULLING more; in-flight items settle unobserved
        throw e
      }
    }
  }
  // NaN-proof: a non-finite limit must degrade to serial, never to ZERO workers
  // (Array.from({length: NaN}) is empty — the pool would "succeed" with a hole-filled result).
  const width = Math.min(items.length, Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1)
  await Promise.all(Array.from({ length: width }, worker))
  return results
}
