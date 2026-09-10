import { useState } from 'react'
import { Pencil, Plus, Trash2, Wrench } from 'lucide-react'
import { type CorrectionOverride, type CorrectionSource } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ErrorCallout } from '@/components/ui/error-callout'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { usePoiCorrections } from './usePoiCorrections'

// Operator surface for a POI's upstream-fact corrections. Corrections take effect on the NEXT
// source refresh and enrichment, then regeneration — they do not rewrite audio. (The speakable anchor moved to the Location tab.)
export function Corrections({ poiId }: { poiId: string }) {
  // Add-correction form
  const [editing, setEditing] = useState(false)
  const [source, setSource] = useState<CorrectionSource | undefined>()
  const [find, setFind] = useState('')
  const [replace, setReplace] = useState('')
  const [reason, setReason] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')

  const { data, loading, saving, saveMut, setValidationErr, err } = usePoiCorrections(poiId)

  // One shared submit path. The buttons only disable AFTER the first mutate re-renders, so guard at the
  // top here — a fast double-tap can't double-submit.
  const save = (...args: Parameters<typeof saveMut.mutate>) => {
    if (saving) return
    saveMut.mutate(...args)
  }

  function addCorrection() {
    if (!find.trim() || !reason.trim()) {
      setValidationErr('A find string and a reason are both required.')
      return
    }
    save(
      { kind: 'fact_edit', source, find, replace, reason: reason.trim(), ...(sourceUrl.trim() ? { sourceUrl: sourceUrl.trim() } : {}) },
      { onSuccess: () => { setFind(''); setReplace(''); setReason(''); setSourceUrl(''); setEditing(false) } },
    )
  }

  function edit(o: CorrectionOverride) {
    setSource(o.source); setFind(o.find ?? ''); setReplace(o.replace ?? '')
    setReason(o.reason); setSourceUrl(o.sourceUrl ?? ''); setEditing(true)
  }

  function retire(o: CorrectionOverride) {
    save({ kind: 'retire', source: o.source, find: o.find! }, { onSuccess: () => {
      if (editing && source === o.source && find === o.find) {
        setEditing(false); setFind(''); setReplace(''); setReason(''); setSourceUrl('')
      }
    } })
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4 pt-3" aria-hidden>
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-12 w-full rounded-md" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-14 w-full rounded-md" />
        </div>
        <Skeleton className="h-28 w-full rounded-md" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 pt-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Wrench className="h-3.5 w-3.5" /> Corrections
      </div>
      <div className="rounded-md border bg-background px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        Wikipedia corrections need a fact refetch, then forced enrichment. Wikidata corrections need
        forced enrichment. Regenerate the narration afterward to produce corrected audio.
      </div>

      {err && <ErrorCallout error={err} className="rounded-lg px-3 py-2 text-xs" />}

      {/* Existing fact-edits */}
      <div className="flex flex-col gap-2">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Fact edits</div>
        {data && data.overrides.length === 0 && (
          <div className="text-xs text-muted-foreground">No corrections yet.</div>
        )}
        {data?.overrides.map((o: CorrectionOverride, i) => (
          <div
            key={`${o.find ?? '∅'}-${i}`}
            className={cn(
              'flex items-start gap-2 rounded-md border bg-background px-3 py-2',
              !o.active && 'opacity-60',
            )}
          >
            <div className="min-w-0 flex-1">
              <div className="mb-1 text-xs text-muted-foreground">{o.source} · {o.sourceId}</div>
              <div className="break-words text-xs">
                <code className="font-mono">{o.find ?? '∅'}</code>
                <span className="mx-1.5 text-muted-foreground">→</span>
                <code className="font-mono">{o.replace === '' ? '(deleted)' : o.replace ?? '∅'}</code>
                {!o.active && <Badge variant="secondary" className="ml-2">retired</Badge>}
                {o.upstreamStatus !== 'not_filed' && <Badge variant="outline" className="ml-1.5">{o.upstreamStatus}</Badge>}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{o.reason}</div>
              {o.sourceUrl && (
                <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-xs text-primary underline-offset-2 hover:underline">
                  {o.sourceUrl}
                </a>
              )}
            </div>
            {o.active && o.find && <Button variant="ghost" size="sm" disabled={saving} onClick={() => edit(o)}><Pencil className="h-3 w-3" /> Edit</Button>}
            {o.active && o.find && (
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => retire(o)} className="shrink-0">
                <Trash2 className="h-3 w-3" /> Retire
              </Button>
            )}
          </div>
        ))}
      </div>

      {/* Add correction */}
      <div className="flex flex-col gap-3 rounded-md border border-dashed px-3 py-3">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{editing ? 'Edit correction' : 'Add correction'}</div>
        <div className="space-y-1.5">
          <Label htmlFor="corr-channel" className="text-xs">Fact source</Label>
          <select disabled={editing || saving} id="corr-channel" className="w-full rounded-md border bg-background px-3 py-2 text-xs"
            value={source ?? data?.sources[0]?.source ?? ''}
            onChange={(e) => setSource(e.target.value as CorrectionSource)}>
            {data?.sources.map((s) => <option key={s.source} value={s.source}>{s.source} · {s.sourceId}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="corr-find" className="text-xs">Find (exact substring)</Label>
            <Input disabled={editing || saving} id="corr-find" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Leonard Palme" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="corr-replace" className="text-xs">Replace (blank = delete)</Label>
            <Input id="corr-replace" value={replace} onChange={(e) => setReplace(e.target.value)} placeholder="Lennart Palme" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="corr-reason" className="text-xs">Reason *</Label>
          <Input id="corr-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the source is wrong (required)" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="corr-source" className="text-xs">Source URL (optional)</Label>
          <Input id="corr-source" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://… authoritative source for the fix" />
        </div>
        <div>
          <Button variant="outline" size="sm" disabled={saving} onClick={addCorrection}>
            <Plus className="h-3 w-3" /> {saving ? 'Saving…' : editing ? 'Save correction' : 'Add correction'}
          </Button>
          {editing && <Button variant="ghost" size="sm" disabled={saving} onClick={() => { setEditing(false); setFind(''); setReplace(''); setReason(''); setSourceUrl('') }}>Cancel edit</Button>}
        </div>
      </div>
    </div>
  )
}
