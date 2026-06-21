import { useQuery, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query'

type ListOptions<T> = Omit<UseQueryOptions<T[], Error, T[], readonly unknown[]>, 'queryKey' | 'queryFn'>

// A thin wrapper over `useQuery` for the admin's list endpoints: pass a typed key (from `qk`) and a
// fetcher that returns the array, and `data` is defaulted to `[]` so every caller drops the repeated
// `= []` at the destructure. The per-endpoint unwrap (`(await api.x()).field`) differs per endpoint and
// stays in the caller's fetcher; extra options (`refetchInterval`, `enabled`, …) pass straight through.
//
// NOTE: it defaults `data`, NOT `initialData` — `initialData: []` would force `isPending` to false and
// suppress the DataTable loading skeleton; the `?? []` default keeps the pending state intact.
export function useAdminList<T>(
  queryKey: readonly unknown[],
  queryFn: () => Promise<T[]>,
  options?: ListOptions<T>,
): UseQueryResult<T[], Error> & { data: T[] } {
  const query = useQuery<T[], Error, T[], readonly unknown[]>({ queryKey, queryFn, ...options })
  // The runtime object has every query field plus a non-null `data`; the cast just re-narrows `data`
  // away from `T[] | undefined` (spreading the result union loses that narrowing on its own).
  return { ...query, data: query.data ?? [] } as UseQueryResult<T[], Error> & { data: T[] }
}
