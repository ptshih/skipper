// A worker-pool `map` for the admin's fan-out paths. Its own module rather than a local in index.ts
// for one reason: index.ts serves on import, so nothing there is reachable from a test — which is why
// grant-ceiling.test.ts has to read that file as TEXT. A primitive the PAID curate path depends on
// should be callable by a test, not grepped.

/**
 * Run `fn` over `items` with at most `limit` in flight, returning the results IN INPUT ORDER.
 *
 * ⚠ BOUNDED, never a bare `Promise.all(items.map(…))`, and that is the whole reason this exists rather
 * than the one-liner. Callers fan out to a PAID third-party API and to Neon; a 160-wide burst is how you
 * turn a run that has already spent money into a pile of rate-limit errors, which is strictly worse than
 * being slow. The pool keeps the tail-latency win without the burst.
 *
 * ⚠ `fn` MUST NOT THROW — resolve to a value that encodes the failure instead. A rejection here would
 * escape `Promise.all` while the other workers keep pulling from the queue, so the fan-out would carry
 * on unobserved behind a request that has already failed. Pinned by a test.
 *
 * Order is preserved by writing into a pre-sized array at the item's own index, so a caller may still
 * zip the results back against its input — the curate route relies on exactly that to keep an
 * operator's per-draft report in the order their list was in.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}
