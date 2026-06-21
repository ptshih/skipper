import { getRouteApi } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { useAdminList } from '@/lib/useAdminList'
import { PageHeader } from '@/components/PageHeader'
import { Callout } from '@/components/ui/callout'
import { CorpusTab } from './pois/CorpusTab'

const poisRoute = getRouteApi('/pois')

// Thin shell: load the shared POI corpus once and hand it to CorpusTab (the corpus table + its bulk
// actions + the per-POI detail sheet, all in views/pois/). The corpus content resolves live via poiId.
export function PoisView() {
  const search = poisRoute.useSearch()

  // The shared place corpus, fetched once + cached under the ['pois'] key.
  const { data: pois, error: err, isPending } = useAdminList(qk.pois(), async () => (await api.pois()).pois)

  return (
    <div className="space-y-6">
      <PageHeader
        title="POIs"
        description="The shared place corpus — sources, narration coverage, attribution, and fact corrections. Roam + drives select from here. Discover new POIs from the Regions page."
      />

      {err && (
        <Callout variant="error">
          <span className="font-medium">Error loading POIs:</span> {errMsg(err)}
        </Callout>
      )}

      <CorpusTab pois={pois} loading={isPending} openPoiId={search.poi} />
    </div>
  )
}
