import { useState } from 'react'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { Compass } from 'lucide-react'
import { api } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { useAdminList } from '@/lib/useAdminList'
import { PageHeader } from '@/components/PageHeader'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/callout'
import { DiscoverPoisDialog } from '@/components/DiscoverPoisDialog'
import { CorpusTab } from './pois/CorpusTab'

const poisRoute = getRouteApi('/pois')

// Thin shell: load the shared POI corpus once and hand it to CorpusTab (the corpus table + its bulk
// actions + the per-POI detail sheet, all in views/pois/). The corpus content resolves live via poiId.
export function PoisView() {
  const search = poisRoute.useSearch()
  const navigate = useNavigate()
  const [discoverOpen, setDiscoverOpen] = useState(false)

  // The shared place corpus, fetched once + cached under the ['pois'] key.
  const { data: pois, error: err, isPending } = useAdminList(qk.pois(), async () => (await api.pois()).pois)
  // Regions feed the Discover picker (shared ['regions'] cache — CorpusTab reads it too).
  const { data: regions } = useAdminList(qk.regions(), async () => (await api.regions()).regions)

  return (
    <div className="space-y-6">
      <PageHeader
        title="POIs"
        description="The shared place corpus — sources, narration coverage, attribution, and fact corrections. Drives select their stops from here."
        actions={
          <Button onClick={() => setDiscoverOpen(true)}>
            <Compass className="h-4 w-4" /> Discover POIs
          </Button>
        }
      />

      {err && (
        <Callout variant="error">
          <span className="font-medium">Error loading POIs:</span> {errMsg(err)}
        </Callout>
      )}

      <CorpusTab pois={pois} loading={isPending} openPoiId={search.poi} />

      <DiscoverPoisDialog
        open={discoverOpen}
        onOpenChange={setDiscoverOpen}
        options={regions.map((r) => ({ slug: r.slug, displayName: r.displayName }))}
        onSubmitted={() => { setDiscoverOpen(false); navigate({ to: '/jobs' }) }}
      />
    </div>
  )
}
