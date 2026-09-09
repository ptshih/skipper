import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CircleCheck, RefreshCw, Rocket, Zap } from 'lucide-react'
import { api } from '@/lib/api'
import { errMsg, fmtDate } from '@/lib/format'
import { qk } from '@/lib/queryKeys'
import { Badge } from '@/components/ui/badge'
import { PendingButton } from '@/components/ui/pending-button'
import { Callout } from '@/components/ui/callout'
import { ErrorCallout } from '@/components/ui/error-callout'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'

// The POI's one shared telling — audio player + script + a re-synth action. Moved here from the
// retired /roam page (roam itself is gone — 1.1 D1); a narration is 1:1 with its poi (resolves via
// poiId), so it lives in the POI.
export function NarrationTab({ poiId, hasNarration }: { poiId: string; hasNarration: boolean }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const confirm = useConfirm()

  const { data: clip, isLoading, error } = useQuery({
    queryKey: qk.poiNarration(poiId),
    queryFn: async () => (await api.poiNarration(poiId)).narration,
    enabled: hasNarration,
  })

  const resynthMut = useMutation({
    mutationFn: () => api.createJob({ kind: 'resynth_narration', poiId, apply: true, confirm: true }),
    onSuccess: ({ job }) => { void qc.invalidateQueries({ queryKey: qk.runs() }); navigate({ to: '/jobs', search: { run: job.id } }) },
  })
  async function handleResynth() {
    if (!(await confirm({
      title: 'Re-synthesize narration?',
      body: 'Spends ~$0.01 in TTS credits and replaces this POI’s current narration audio.',
      confirmLabel: 'Re-synth',
    }))) return
    resynthMut.mutate()
  }

  // Regenerate = re-NARRATE this one POI from its current facts + corrections (a fresh script), then
  // re-score + re-synthesize — the single-POI form of generate_narrations (include-ids implies --force).
  // Closes the ear-pass → fix-a-fact → re-hear loop without re-running the whole region. Spends Anthropic + TTS.
  const regenMut = useMutation({
    mutationFn: () =>
      api.createJob({ kind: 'generate_narrations', includeIds: [poiId], force: true, apply: true, confirm: true }),
    onSuccess: ({ job }) => { void qc.invalidateQueries({ queryKey: qk.runs() }); navigate({ to: '/jobs', search: { run: job.id } }) },
  })
  async function handleRegenerate() {
    if (!(await confirm({
      title: 'Regenerate narration?',
      body: 'Re-narrates this POI from its CURRENT facts + corrections (a fresh script), then re-scores and re-synthesizes. Spends Anthropic + TTS credits. Use this after a fact-edit; Re-synth only re-voices the existing script.',
      confirmLabel: 'Regenerate',
    }))) return
    regenMut.mutate()
  }

  if (!hasNarration) {
    return (
      <EmptyState icon={Zap} className="rounded-xl border bg-muted/30">
        No narration yet — enrich this POI, then Generate Narration for its region.
      </EmptyState>
    )
  }
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 pt-1" aria-hidden>
        <Skeleton className="h-9 w-full rounded-md" />
        <div className="flex items-center gap-2.5">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3 w-14" />
        </div>
        <Skeleton className="h-24 w-full rounded-md" />
      </div>
    )
  }
  if (error) return <div className="py-2 text-xs text-destructive">{errMsg(error)}</div>
  if (!clip) return null

  const durationSec = Math.round(clip.audioDurationMs / 1000)
  const mins = Math.floor(durationSec / 60)
  const secs = durationSec % 60
  const durLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  const wordCount = clip.script?.trim().split(/\s+/).filter(Boolean).length ?? 0
  const wpm = wordCount > 0 ? Math.round(wordCount / (clip.audioDurationMs / 1000 / 60)) : 0
  const suspicious = wpm > 0 && wpm < 90

  return (
    <div className="flex flex-col gap-2 pt-1">
      <audio controls preload="none" src={clip.url} className="h-9 w-full" />
      <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
        <span className="font-mono">{durLabel}</span>
        {wpm > 0 && (
          <span className={cn('font-mono', suspicious && 'text-destructive')}>
            {wpm} wpm{suspicious ? ' ⚠ suspicious' : ''}
          </span>
        )}
        {clip.factsHash && <code className="font-mono">{clip.factsHash.slice(0, 7)}</code>}
        {clip.releasedAt ? (
          <Badge variant="success" title={`Released ${fmtDate(clip.releasedAt)}`}>
            <CircleCheck className="h-3 w-3" /> Released
          </Badge>
        ) : (
          <Badge variant="warning" title="Staged — heard by testers in-app, not yet public. Release to publish.">
            Staged
          </Badge>
        )}
        <span className="flex-1" />
        {!clip.releasedAt && (
          <PendingButton
            variant="default"
            size="sm"
            onClick={() => { location.href = `/listening?narration=${clip.id}` }}
            pending={false}
            icon={<Rocket className="h-3 w-3" />}
            idleLabel="Review release"
            pendingLabel="Releasing…"
          />
        )}
        <PendingButton
          variant="outline"
          size="sm"
          onClick={() => void handleRegenerate()}
          pending={regenMut.isPending}
          disabled={resynthMut.isPending}
          icon={<Zap className="h-3 w-3" />}
          idleLabel="Regenerate"
          pendingLabel="Queuing…"
        />
        <PendingButton
          variant="outline"
          size="sm"
          onClick={() => void handleResynth()}
          pending={resynthMut.isPending}
          disabled={regenMut.isPending}
          icon={<RefreshCw className="h-3 w-3" />}
          idleLabel="Re-synth"
          pendingLabel="Queuing…"
        />
      </div>
      {resynthMut.error && <ErrorCallout error={`Re-synth failed — ${errMsg(resynthMut.error)}`} className="rounded-lg px-3 py-2 text-xs" />}
      {regenMut.error && <ErrorCallout error={`Regenerate failed — ${errMsg(regenMut.error)}`} className="rounded-lg px-3 py-2 text-xs" />}
      {suspicious && (
        <Callout variant="error" className="rounded-lg px-3 py-2 text-xs">
          Narration duration ({durLabel} for {wordCount} words) looks like a TTS duplicate-audio defect. Re-synth to fix.
        </Callout>
      )}
      <div className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{clip.script}</div>
    </div>
  )
}
