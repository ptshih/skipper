import { eq, inArray } from 'drizzle-orm'
import { db } from '@skipper/db'
import { drives, narrations, pois, selectionSubject } from '@skipper/db/schema'
import { loadClusterTellings } from '@skipper/db/cluster-tellings'
import { resolveSelection, type SimSubject } from './selection'

/** Both simulator entrypoints resolve the same subject set, including the API's cluster geometry. */
export async function loadStops(driveId: string) {
  const [drive] = await db.select().from(drives).where(eq(drives.id, driveId)).limit(1)
  if (!drive) throw new Error(`No drive found for id "${driveId}".`)
  const subjects = drive.selection.map(selectionSubject)
  const poiIds = subjects.filter(s => s?.kind === 'poi').map(s => s!.id)
  const clusterIds = subjects.filter(s => s?.kind === 'cluster').map(s => s!.id)
  const [rows, clusters] = await Promise.all([
    poiIds.length ? db.select({
      subjectId: pois.id, name: pois.name, form: narrations.form,
      durationMs: narrations.audioDurationMs, key: narrations.audioUrl,
      lat: pois.lat, lng: pois.lng, kind: pois.kind,
      speakableLat: pois.speakableLat, speakableLng: pois.speakableLng,
    }).from(narrations).innerJoin(pois, eq(pois.id, narrations.poiId))
      .where(inArray(pois.id, poiIds)) : [],
    loadClusterTellings({ includeStaged: true, clusterIds }),
  ])
  const corpus: SimSubject[] = rows.map(r => ({ ...r, subjectKind: 'poi',
    lat: r.speakableLat ?? r.lat, lng: r.speakableLng ?? r.lng,
    anchored: r.speakableLat != null && r.speakableLng != null,
  }))
  corpus.push(...clusters.map(r => ({ ...r, subjectId: r.clusterId,
    subjectKind: 'cluster' as const, anchored: false,
  })))
  return { drive, ...resolveSelection(drive.selection, corpus) }
}
