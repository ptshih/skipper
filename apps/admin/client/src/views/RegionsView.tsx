import { useEffect, useState } from 'react'
import { Layers, Pencil, Plus } from 'lucide-react'
import { api, type Region } from '@/lib/api'
import { errMsg } from '@/lib/format'
import { PageHeader } from '@/components/PageHeader'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Callout } from '@/components/ui/callout'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type DialogMode = { mode: 'create' } | { mode: 'edit'; region: Region }

export function RegionsView() {
  const [regions, setRegions] = useState<Region[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogMode | null>(null)

  async function load() {
    try {
      setRegions((await api.regions()).regions)
      setErr(null)
    } catch (e) {
      setErr(errMsg(e))
    }
  }

  useEffect(() => { void load() }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regions"
        description="Geographic regions — the slug drives POI discovery, tour assignment, and the in-app region picker. The discovery bbox is passed to the POI sweep job."
        actions={
          <Button onClick={() => setDialog({ mode: 'create' })}>
            <Plus className="h-4 w-4" /> Add region
          </Button>
        }
      />

      {err && (
        <Callout variant="error">
          <span className="font-medium">Error loading regions:</span> {err}
        </Callout>
      )}

      <Callout variant="info">
        <span className="font-medium text-foreground">Discovery bbox</span> — the bounding box passed to{' '}
        <code className="font-mono text-xs">Discover POIs</code> as{' '}
        <code className="font-mono text-xs">--bbox "lng_min,lat_min,lng_max,lat_max"</code>. Leave blank to use the
        generator's built-in default (Tahoe basin). Set this before running a discovery sweep for any new region.
      </Callout>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Display name</TableHead>
              <TableHead>Discovery bbox</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {regions.map((r) => (
              <TableRow key={r.slug}>
                <TableCell className="font-mono text-sm">{r.slug}</TableCell>
                <TableCell className="font-medium">{r.displayName}</TableCell>
                <TableCell>
                  {r.discoveryBbox ? (
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{r.discoveryBbox}</code>
                  ) : (
                    <Badge variant="secondary">default (Tahoe)</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog({ mode: 'edit', region: r })}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {regions.length === 0 && !err && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4}>
                  <EmptyState icon={Layers}>No regions yet — add one to get started.</EmptyState>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {dialog && (
        <RegionDialog
          mode={dialog}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); void load() }}
        />
      )}
    </div>
  )
}

function RegionDialog({
  mode,
  onClose,
  onSaved,
}: {
  mode: DialogMode
  onClose: () => void
  onSaved: () => void
}) {
  const existing = mode.mode === 'edit' ? mode.region : null

  const [slug, setSlug] = useState(existing?.slug ?? '')
  const [displayName, setDisplayName] = useState(existing?.displayName ?? '')
  const [bbox, setBbox] = useState(existing?.discoveryBbox ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      if (mode.mode === 'create') {
        await api.createRegion({ slug: slug.trim(), displayName: displayName.trim(), discoveryBbox: bbox.trim() || null })
      } else {
        await api.updateRegion(mode.region.slug, { displayName: displayName.trim(), discoveryBbox: bbox.trim() || null })
      }
      onSaved()
    } catch (e) {
      setErr(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode.mode === 'create' ? 'Add region' : `Edit ${existing?.displayName}`}</DialogTitle>
          <DialogDescription>
            {mode.mode === 'create'
              ? 'Create a new region. The slug is permanent and used as the DB key — choose carefully.'
              : 'Update the display name or discovery bbox.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {mode.mode === 'create' && (
            <div className="space-y-1.5">
              <Label htmlFor="region-slug">Slug *</Label>
              <Input
                id="region-slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="yosemite-valley"
              />
              <p className="text-xs text-muted-foreground">Lowercase kebab-case. Permanent DB key.</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="region-name">Display name *</Label>
            <Input
              id="region-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Yosemite Valley"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="region-bbox">Discovery bbox (optional)</Label>
            <Input
              id="region-bbox"
              value={bbox}
              onChange={(e) => setBbox(e.target.value)}
              placeholder="-119.6,37.6,-119.4,37.8"
            />
            <p className="text-xs text-muted-foreground">
              Format: <code className="font-mono">lng_min,lat_min,lng_max,lat_max</code>. Leave blank to use the
              generator default (Tahoe basin).
            </p>
          </div>
        </div>

        {err && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {err}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            disabled={busy || !displayName.trim() || (mode.mode === 'create' && !slug.trim())}
            onClick={submit}
          >
            {busy ? 'Saving…' : mode.mode === 'create' ? 'Create region' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
