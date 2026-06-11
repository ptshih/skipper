import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type TourCard } from '@/lib/api'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { fmtDuration, fmtMiles, timeAgo } from '@/lib/format'

const statusVariant = (s: TourCard['status']): BadgeProps['variant'] =>
  s === 'ready' ? 'success' : s === 'failed' ? 'destructive' : s === 'generating' ? 'default' : 'secondary'

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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tours</h1>
      {err && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">{err}</div>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              {['Tour', 'Region', 'Status', 'Stops', 'Authored', 'Distance', 'Duration', 'Updated'].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tours.map((t) => (
              <tr key={t.id} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2">
                  <Link to={`/tours/${t.id}`} className="font-medium hover:underline">{t.headline}</Link>
                  <div className="font-mono text-xs text-muted-foreground">{t.slug}</div>
                </td>
                <td className="px-3 py-2">{t.regionName}</td>
                <td className="px-3 py-2"><Badge variant={statusVariant(t.status)}>{t.status}</Badge></td>
                <td className="px-3 py-2">{t.stops} + {t.brackets}</td>
                <td className="px-3 py-2">
                  <Badge variant={t.authored === 'admin' ? 'default' : 'outline'}>{t.authored}</Badge>
                </td>
                <td className="px-3 py-2">{fmtMiles(t.distanceMeters)}</td>
                <td className="px-3 py-2">{fmtDuration(t.durationSeconds)}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{timeAgo(t.updatedAt)}</td>
              </tr>
            ))}
            {tours.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">No tours yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
