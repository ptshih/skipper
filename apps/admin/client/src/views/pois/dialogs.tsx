import { useState } from 'react'
import { Activity, Sparkles, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { JobActionDialog } from '@/components/ui/job-action-dialog'
import type { EnrichSelection, ScopeDescriptor } from './types'

// The confirm-dialog scope readout: WHAT a run targets — the selection headline + the active filter
// chips — so a spend can never run on a scope the operator can't see. Shown atop every action dialog.
function ScopeSummary({ scope }: { scope: ScopeDescriptor }) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm">
      <div className="font-medium text-foreground">{scope.summary}</div>
      {scope.chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {scope.chips.map((c) => (
            <Badge key={c.label} variant="secondary" className="font-normal">
              <span className="text-muted-foreground">{c.label}:</span>&nbsp;{c.value}
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

/** Map a selection onto the createJob body fields a kind that takes region/query/includeIds/excludeIds
 *  understands (generate_narrations, offline_audit). enrich also takes `source`, added by its builder. */
function scopeBody(sel: EnrichSelection): Record<string, unknown> {
  if (sel.kind === 'explicit') return { includeIds: sel.ids }
  const body: Record<string, unknown> = {}
  if (sel.filter.region) body.region = sel.filter.region
  if (sel.filter.query) body.query = sel.filter.query
  if (sel.excludeIds.length) body.excludeIds = sel.excludeIds
  return body
}

/* ── NARRATE (generate_narrations — re-script + re-synth, spends) ── */

// Narrates + synthesizes a narration for every enriched, story-grade POI in the SELECTION. SPENDS
// Anthropic + TTS per narration (gated — JobActionDialog adds confirm:true on apply). `force` re-generates
// places that already have a narration (e.g. to fix a defect); without it, already-narrated places skip.
export function NarrateDialog({ open, onOpenChange, scope, onSubmitted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ScopeDescriptor
  onSubmitted: () => void
}) {
  const [force, setForce] = useState(false)
  return (
    <JobActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmitted={onSubmitted}
      icon={Zap}
      title="Generate narration"
      description="Narrates + synthesizes a narration for every enriched, story-grade POI in the selection. Run after Discover, then Enrich. Spends Anthropic + TTS credits per narration."
      buildBody={() => ({ kind: 'generate_narrations', ...scopeBody(scope.selection), ...(force ? { force: true } : {}) })}
      applyLabel="Generate"
      applyIcon={Zap}
      note={
        <>
          <span className="font-medium text-foreground">Preview</span> dry-runs free (no narration or TTS —
          prints the queue + a cost estimate); <span className="font-medium text-foreground">Generate</span> spends.
        </>
      }
    >
      <ScopeSummary scope={scope} />
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <Checkbox checked={force} onCheckedChange={setForce} aria-label="Re-generate existing narrations" />
        <span>
          <span className="font-medium text-foreground">Re-generate existing</span> — overwrite places that
          already have a narration (use this to fix a defect). Off = skip already-narrated places.
        </span>
      </label>
    </JobActionDialog>
  )
}

/* ── RE-SCORE CORPUS (offline_audit — read-only quality read on existing narrations) ── */

// Re-score the EXISTING narration corpus without regenerating: scores each region story narration's
// stored script for grounding (Opus) + tts + diversity and records an offline_audit eval_run, viewable
// on the Evals page. READ-ONLY on narrations/R2; --apply spends one Opus grounding call per clip
// (gated like the other paid dialogs); the Preview is a free count + estimate.
export function RescoreDialog({ open, onOpenChange, scope, onSubmitted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ScopeDescriptor
  onSubmitted: () => void
}) {
  const [charm, setCharm] = useState(false)
  const [veracity, setVeracity] = useState(false)
  return (
    <JobActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmitted={onSubmitted}
      icon={Activity}
      title="Re-score corpus"
      description="Re-scores the selection's EXISTING story narrations (grounding, tts-cleanliness, diversity; charm + veracity opt-in) WITHOUT regenerating or re-synthesizing — a quality read on what's already shipped. Records an offline_audit run, viewable on the Evals page."
      buildBody={() => ({ kind: 'offline_audit', ...scopeBody(scope.selection), ...(charm ? { charm: true } : {}), ...(veracity ? { veracity: true } : {}) })}
      applyLabel="Re-score"
      applyIcon={Activity}
      note={
        <>
          <span className="font-medium text-foreground">Preview</span> is free (counts the narrations +
          estimates the grounding spend); <span className="font-medium text-foreground">Re-score</span> spends
          one Opus call per clip. Read-only — it never changes a narration.
        </>
      }
    >
      <ScopeSummary scope={scope} />

      <div className="space-y-2">
        <Label>Advisory judges (Opus, opt-in)</Label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={charm} onCheckedChange={setCharm} aria-label="Score charm" />
          <span><span className="font-medium text-foreground">Charm</span> — one Opus call over the batch (cheap). Persona &amp; delivery quality.</span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={veracity} onCheckedChange={setVeracity} aria-label="Score veracity" />
          <span><span className="font-medium text-foreground">Veracity</span> — web-checks each story's claims (Opus + search, <span className="text-foreground">per clip — pricier</span>).</span>
        </label>
      </div>
    </JobActionDialog>
  )
}

/* ── ENRICH (the corpus fact-well step) ── */

// A focused Preview+apply dialog (shared JobActionDialog shell) for the corpus `enrich` step
// (enrich_pois): acts on the table SELECTION, then Preview (free dry-run — NO model calls, prints the
// count + a cost estimate) or Enrich (apply, SPENDS Anthropic; no TTS). THIS dialog is the paid-run gate:
// it names the scope + cost and needs an explicit Enrich click, so the server's confirm:true (added by
// JobActionDialog for the apply) is already human-gated — no extra window.confirm. The fact sheet it
// builds (pois.fact_sheet) is what the narration grounds on, so enrich ONCE between Discover and
// Generate Narration.
// Enrich only acts on ELIGIBLE story POIs (the CLI gates), so the Preview count is authoritative.
export function EnrichDialog({ open, onOpenChange, scope, onSubmitted }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: ScopeDescriptor
  onSubmitted: () => void
}) {
  // Advanced (collapsed): the model tier A/B + a smoke-test cap. The studio CLI defaults to sonnet
  // (only the literal 'opus' selects opus); `limit` caps how many places enrich. Server forwards both.
  const [advanced, setAdvanced] = useState(false)
  const [model, setModel] = useState<'sonnet' | 'opus'>('sonnet')
  const [limit, setLimit] = useState('')

  const buildBody = () => {
    const sel = scope.selection
    const body: Record<string, unknown> = { kind: 'enrich_pois', ...scopeBody(sel) }
    // enrich is the one kind that also filters by source (story is wikipedia-only anyway).
    if (sel.kind === 'all' && sel.filter.source) body.source = sel.filter.source
    if (model !== 'sonnet') body.model = model // sonnet is the CLI default — only send a non-default override
    const n = Number(limit)
    if (limit.trim() && Number.isFinite(n) && n > 0) body.limit = Math.floor(n)
    return body
  }

  return (
    <JobActionDialog
      open={open}
      onOpenChange={onOpenChange}
      onSubmitted={onSubmitted}
      icon={Sparkles}
      title="Enrich corpus"
      description={
        <>
          Scouts each story POI ONCE into a curated, verbatim <strong>fact well</strong> on the shared corpus —
          the narration grounds on it. Run after Discover, before generating. Spends Anthropic credits
          (no TTS). A re-discover now PRESERVES wells; rebuild one with Enrich after a material article change.
        </>
      }
      buildBody={buildBody}
      applyLabel="Enrich"
      applyIcon={Sparkles}
      note={
        <>
          <span className="font-medium text-foreground">Preview</span> dry-runs free (no model calls — prints the
          count + a cost estimate to the run log); <span className="font-medium text-foreground">Enrich</span> spends.
        </>
      }
    >
      <ScopeSummary scope={scope} />
      <p className="text-xs text-muted-foreground">Only eligible story POIs are enriched — Preview shows the exact count + cost.</p>

      <div className="space-y-2">
        <button
          type="button"
          className="text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? '▾' : '▸'} Advanced
        </button>
        {advanced && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-dashed px-3 py-3">
            <div className="space-y-1.5">
              <Label htmlFor="enrich-model" className="text-xs">Model</Label>
              <Select value={model} onValueChange={(v) => setModel(v as 'sonnet' | 'opus')}>
                <SelectTrigger id="enrich-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sonnet">Sonnet (default)</SelectItem>
                  <SelectItem value="opus">Opus (calibration A/B)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="enrich-limit" className="text-xs">Smoke-test first N</Label>
              <Input
                id="enrich-limit"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                placeholder="all eligible"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
              />
            </div>
          </div>
        )}
      </div>
    </JobActionDialog>
  )
}
