import { useEffect, useState } from 'react'
import { Combine } from 'lucide-react'
import { JobActionDialog } from '@/components/ui/job-action-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

type RegionRef = { slug: string; displayName: string }

/* ── FUSE CLUSTERS (generate_cluster_narrations — the fused telling, SPENDS on preview too) ──
 *
 * Writes ONE telling for a group of places a driver experiences as a single stop (Emerald Bay =
 * Vikingsholm + Fannette Island + Eagle Falls): a `narrations` row with `cluster_id` set and
 * `poi_id` NULL. Members keep their own clips — this only ADDS.
 *
 * ⚠ Preview is NOT free here, and that is the one way this differs from Generate narration. The solo
 * generator exits its dry run BEFORE narrating ("nothing narrated, synthesized, or written"); this one
 * narrates and scores first and only gates the PERSISTENCE, so a preview costs an apply minus the TTS.
 * The confirm gate therefore fires on Preview as well (jobs.ts returns spends:true for this kind).
 */
export function FuseClustersDialog({
  open,
  onOpenChange,
  onSubmitted,
  region,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmitted: () => void
  region: RegionRef | null
}) {
  // The CLI defaults to 1 for a reason: clusters are picked WIDEST first, and each one is a paid
  // narration. Starting small is the cost control.
  const [limit, setLimit] = useState('1')
  useEffect(() => { if (open) setLimit('1') }, [open])

  return (
    <JobActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmitted={onSubmitted}
      icon={Combine}
      title="Fuse clusters"
      description="Writes one fused telling per cluster in this region — a single narration covering a group of places a driver experiences as one stop. Member clips are left untouched."
      buildBody={() => ({
        kind: 'generate_cluster_narrations',
        ...(region ? { region: region.slug } : {}),
        ...(Number(limit) > 0 ? { limit: Number(limit) } : {}),
      })}
      applyLabel="Fuse"
      applyIcon={Combine}
      // ⚠ This kind spends on PREVIEW too (jobs.ts returns spends:true unconditionally, because the
      // CLI narrates and scores before deciding what to keep). Without this the Preview button 412s
      // for every input — the cheap rehearsal the note below advertises did not exist, so every real
      // use of the feature was the full paid apply.
      confirmOnPreview
      note={
        <>
          ⚠ <span className="font-medium text-foreground">Preview also spends</span> — unlike Generate
          narration, this one narrates and scores before it decides what to keep, so a preview costs an
          apply minus the TTS. <span className="font-medium text-foreground">Fuse</span> adds the TTS and
          persists. A fused clip lands STAGED and publishes with the region release.
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
          <div className="font-medium text-foreground">Region</div>
          {region ? (
            <Badge variant="secondary" className="font-normal">{region.displayName}</Badge>
          ) : (
            <span className="text-muted-foreground">None selected</span>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fuse-limit">Clusters (widest first)</Label>
          <Input
            id="fuse-limit"
            inputMode="numeric"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="w-28"
          />
          <p className="text-xs text-muted-foreground">
            Each cluster is a paid narration. Start at 1 and listen before widening.
          </p>
        </div>
      </div>
    </JobActionDialog>
  )
}
