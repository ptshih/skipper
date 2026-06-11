import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { api, type TourCard } from '@/lib/api'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/PageHeader'
import { fmtDuration, fmtMiles, timeAgo } from '@/lib/format'

const statusVariant = (s: TourCard['status']): BadgeProps['variant'] =>
  s === 'ready' ? 'success' : s === 'failed' ? 'destructive' : s === 'generating' ? 'default' : 'secondary'

const COLS = ['Tour', 'Region', 'Status', 'Stops', 'Authored', 'Distance', 'Duration', 'Updated']

export function ToursView() {
  const [tours, setTours] = useState<TourCard[]>([])
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    api
      .tours()
      .then((r) => setTours(r.tours))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
  }, [])

  return (
    <div>
      <PageHeader
        title="Tours"
        description="Every tour in the catalog — drafts included."
        actions={
          <Button asChild>
            <Link to="/create">
              <Plus className="h-4 w-4" />
              Create tour
            </Link>
          </Button>
        }
      />
      {err && (
        <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>
      )}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              {COLS.map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tours.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <Link to={`/tours/${t.id}`} className="font-medium hover:underline">{t.headline}</Link>
                  <div className="font-mono text-xs text-muted-foreground">{t.slug}</div>
                </TableCell>
                <TableCell>{t.regionName}</TableCell>
                <TableCell><Badge variant={statusVariant(t.status)}>{t.status}</Badge></TableCell>
                <TableCell>{t.stops} + {t.brackets}</TableCell>
                <TableCell>
                  <Badge variant={t.authored === 'admin' ? 'default' : 'outline'}>{t.authored}</Badge>
                </TableCell>
                <TableCell>{fmtMiles(t.distanceMeters)}</TableCell>
                <TableCell>{fmtDuration(t.durationSeconds)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{timeAgo(t.updatedAt)}</TableCell>
              </TableRow>
            ))}
            {tours.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">No tours yet.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
