import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type PoiCorrections } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { qk } from '@/lib/queryKeys'

/**
 * The one read/write path for a POI's corrections row, shared by the two tabs that edit it: Corrections
 * (fact overrides) and Location (the speakable anchor + exclusion). Both write through the SAME endpoint
 * — the anchor rides in the corrections payload — so they were carrying byte-identical query + mutation +
 * error wiring, and a change to the cache-write rule had to be made twice to stay true.
 *
 * ⚠ The save writes the response STRAIGHT into the cache rather than invalidating: the endpoint returns
 * the updated corrections, so a refetch would be a second round-trip for a value already in hand — and,
 * more to the point, the two tabs share one cache key, so a write from Location must leave Corrections
 * showing the new row without either tab knowing the other is mounted.
 *
 * `validationErr` is the CLIENT-side complaint (a missing reason, a non-numeric coordinate); it is folded
 * into one `err` string ahead of the load and save errors, and cleared by a successful save.
 */
export function usePoiCorrections(poiId: string) {
  const qc = useQueryClient()
  const [validationErr, setValidationErr] = useState<string | null>(null)

  const { data, isLoading: loading, error: loadErr } = useQuery({
    queryKey: qk.poiCorrections(poiId),
    queryFn: () => api.poiCorrections(poiId),
  })

  const saveMut = useMutation({
    mutationFn: (input: Parameters<typeof api.saveCorrection>[1]) => api.saveCorrection(poiId, input),
    onSuccess: (updated: PoiCorrections) => {
      qc.setQueryData(qk.poiCorrections(poiId), updated)
      setValidationErr(null)
    },
  })

  const saving = saveMut.isPending

  return {
    data,
    loading,
    saving,
    saveMut,
    setValidationErr,
    err: validationErr ?? (loadErr ? errMsg(loadErr) : saveMut.error ? errMsg(saveMut.error) : null),
  }
}
