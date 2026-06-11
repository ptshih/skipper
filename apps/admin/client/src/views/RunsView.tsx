import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, type JobKind, type JobStatus, type RunEvent } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/PageHeader'
import { fmtCost, fmtDate, timeAgo } from '@/lib/format'

const statusVariant = (s: JobStatus): BadgeProps['variant'] =>
  s === 'succeeded' ? 'success' : s === 'failed' ? 'destructive' : s === 'running' ? 'default' : s === 'canceled' ? 'secondary' : 'warning'

const COLS = ['Source', 'Kind', 'Target', 'Result', 'Mode', 'Cost', 'Detail', 'When']

const KINDS: { value: JobKind; label: string }[] = [
  { value: 'generate', label: 'Generate' },
  { value: 'patch_clip', label: 'Patch clip' },
  { value: 'resynth', label: 'Resynth tour' },
  { value: 'sweep_orphans', label: 'Sweep orphans' },
]

export function RunsView() {
  const [runs, setRuns] = useState<RunEvent[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  async function refresh() {
    try {
      setRuns((await api.runs()).runs)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 5000)
    return () => clearInterval(t)
  }, [])

  return (
    <div>
      <PageHeader
        title="Runs"
        description="Every run — admin-triggered Cloud Run jobs and historical generations from the CLI."
        actions={<Button onClick={() => setOpen(true)}>New run</Button>}
      />
      {err && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>
      )}
      <div className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {COLS.map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={`${r.source}:${r.id}`}>
                <TableCell>
                  <Badge variant={r.source === 'job' ? 'default' : 'outline'}>{r.source}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{r.kind}</TableCell>
                <TableCell>
                  {r.slug ? (
                    r.tourId ? (
                      <Link to={`/tours/${r.tourId}`} className="hover:underline">{r.slug}</Link>
                    ) : (
                      r.slug
                    )
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>
                  {r.source === 'job' && r.status ? (
                    <Badge variant={statusVariant(r.status)}>
                      {r.status === 'running' && r.phase ? `running · ${r.phase}` : r.status}
                    </Badge>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Badge variant={r.pass ? 'success' : 'destructive'}>{r.pass ? 'pass' : 'fail'}</Badge>
                      {r.grounding != null && (
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">{r.grounding.toFixed(3)}</span>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {r.dryRun ? <Badge variant="secondary">dry-run</Badge> : <Badge variant="warning">spend</Badge>}
                </TableCell>
                <TableCell>{fmtCost(r.costUsd)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {r.source === 'job'
                    ? r.triggeredBy ?? '—'
                    : [r.narrationModel, r.gitSha?.slice(0, 7)].filter(Boolean).join(' · ') || '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground" title={fmtDate(r.createdAt)}>
                  {timeAgo(r.createdAt)}
                </TableCell>
              </TableRow>
            ))}
            {runs.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLS.length} className="py-10 text-center text-muted-foreground">No runs yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <NewRunDialog
        open={open}
        onOpenChange={setOpen}
        onSubmitted={() => {
          setOpen(false)
          void refresh()
        }}
      />
    </div>
  )
}

function NewRunDialog({
  open,
  onOpenChange,
  onSubmitted,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onSubmitted: () => void
}) {
  const [kind, setKind] = useState<JobKind>('generate')
  const [f, setF] = useState<Record<string, string>>({ maxCostUsd: '5', jokeLevel: 'dadpocalypse', duration: 'standard' })
  const [dryRun, setDryRun] = useState(true)
  const [apply, setApply] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: string) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }))

  const target = kind === 'generate' ? f.slug : kind === 'patch_clip' ? f.targetId : f.tourId
  const spends = kind === 'generate' ? !dryRun : apply
  const confirmed = !spends || confirmText.trim() === (target ?? '').trim()

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      const body: Record<string, unknown> = { kind }
      if (kind === 'generate')
        Object.assign(body, { slug: f.slug, dryRun, maxCostUsd: Number(f.maxCostUsd), jokeLevel: f.jokeLevel, duration: f.duration })
      if (kind === 'patch_clip') Object.assign(body, { targetId: f.targetId, find: f.find, replace: f.replace, apply })
      if (kind === 'resynth') Object.assign(body, { tourId: f.tourId, apply })
      if (kind === 'sweep_orphans') Object.assign(body, { tourId: f.tourId, apply })
      if (spends) body.confirm = true
      await api.createJob(body)
      onSubmitted()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New run</DialogTitle>
          <DialogDescription>Triggers a skipper-gen Cloud Run Job. Dry-run by default.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as JobKind)}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </Select>
          </Field>

          {kind === 'generate' && (
            <>
              <Field label="Tour slug"><Input value={f.slug ?? ''} onChange={set('slug')} placeholder="emerald-bay-run" /></Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="Max cost ($)"><Input value={f.maxCostUsd} onChange={set('maxCostUsd')} /></Field>
                <Field label="Joke level">
                  <Select value={f.jokeLevel} onChange={set('jokeLevel')}>
                    {['off', 'mild', 'dad', 'dadpocalypse'].map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
                <Field label="Duration">
                  <Select value={f.duration} onChange={set('duration')}>
                    {['short', 'standard', 'long'].map((o) => <option key={o}>{o}</option>)}
                  </Select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Dry-run (scripts only, no TTS spend)
              </label>
            </>
          )}

          {kind === 'patch_clip' && (
            <>
              <Field label="Stop / bracket id"><Input value={f.targetId ?? ''} onChange={set('targetId')} /></Field>
              <Field label="Find"><Input value={f.find ?? ''} onChange={set('find')} /></Field>
              <Field label="Replace"><Input value={f.replace ?? ''} onChange={set('replace')} /></Field>
              <ApplyToggle apply={apply} setApply={setApply} verb="re-synthesize the clip" />
            </>
          )}

          {kind === 'resynth' && (
            <>
              <Field label="Tour id"><Input value={f.tourId ?? ''} onChange={set('tourId')} /></Field>
              <ApplyToggle apply={apply} setApply={setApply} verb="re-synthesize every clip" />
            </>
          )}

          {kind === 'sweep_orphans' && (
            <>
              <Field label="Tour id"><Input value={f.tourId ?? ''} onChange={set('tourId')} /></Field>
              <ApplyToggle apply={apply} setApply={setApply} verb="delete orphaned R2 clips" />
            </>
          )}

          {spends && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="mb-2">This run spends money / deletes bytes. Type the target <span className="font-mono">{target || '…'}</span> to confirm.</p>
              <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder={target} />
            </div>
          )}

          {err && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">{err}</div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || !target || !confirmed}>
            {busy ? 'Triggering…' : spends ? 'Spend + run' : 'Run (dry)'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function ApplyToggle({ apply, setApply, verb }: { apply: boolean; setApply: (v: boolean) => void; verb: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={apply} onChange={(e) => setApply(e.target.checked)} /> Apply (actually {verb}) — off = dry-run preview
    </label>
  )
}
