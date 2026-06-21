import type { ElementType } from 'react'
import { Activity, Filter, MapPin, RefreshCw, Scissors, Sparkles, Trash2, Zap } from 'lucide-react'

// Shared run-presentation vocabulary for the two run pages (Jobs + Evals) and their drawers — they read
// the same ['runs'] cache, so this used to be duplicated verbatim in both views.

// Poll cadence for the shared ['runs'] cache. Both run lists auto-refresh at this interval AND label it
// (via <AutoRefreshControl>), from ONE constant so the cadence and its label can't drift apart.
export const RUNS_REFETCH_MS = 15_000

// Kind → label/icon. generate / resynth / patch_clip are LEGACY (deferred in V2) — kept so historical
// job rows render a readable label; they are no longer dispatchable here.
export const KIND_META: Record<string, { label: string; icon: ElementType }> = {
  generate:        { label: 'Generate',          icon: Sparkles },
  resynth:         { label: 'Resynth',           icon: RefreshCw },
  patch_clip:      { label: 'Patch clip',        icon: Scissors },
  resynth_narration: { label: 'Re-synth narration', icon: RefreshCw },
  refetch_facts:   { label: 'Re-fetch facts',    icon: RefreshCw },
  sweep_orphans:   { label: 'Sweep orphans',     icon: Trash2 },
  discover_pois:   { label: 'Discover POIs',     icon: Filter },
  enrich_pois:     { label: 'Enrich corpus',     icon: Sparkles },
  generate_narrations: { label: 'Generate Narration', icon: Zap },
  curate_places:   { label: 'Curate places',     icon: MapPin },
  offline_audit:   { label: 'Re-score corpus',   icon: Activity },
}

// A run targeting no region (whole-corpus) leaves its slug NULL → "All". Legacy sentinels map to a
// friendly label rather than a raw slug.
export const TARGET_SENTINELS: Record<string, string> = {
  'roam-corpus': 'All',
  'region-corpus': 'whole corpus',
  narration: 'all clips',
}

// The Target cell shared by both run lists + drawers: a null slug or a known sentinel renders
// italic + muted; anything else shows the raw slug.
export function RunTarget({ slug }: { slug: string | null }) {
  if (!slug) return <span className="italic text-muted-foreground">All</span>
  const sentinel = TARGET_SENTINELS[slug]
  if (sentinel) return <span className="italic text-muted-foreground">{sentinel}</span>
  return <>{slug}</>
}
