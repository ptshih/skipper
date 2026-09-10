import { desc, eq } from 'drizzle-orm'
import type { DB } from '@skipper/db'
import { listeningReviewItems, listeningReviews } from '@skipper/db/schema'

/** Carry verdicts, never parent snapshots. A snapshot is several MB and selecting it
 * once per joined item exceeded Neon's 64 MB response limit on the second Yosemite review.
 * Keep only the newest verdict per clip version so repeated reviews don't multiply rows.
 */
export function previousListeningItems(db: DB, regionSlug: string) {
  return db.selectDistinctOn([listeningReviewItems.narrationId, listeningReviewItems.fingerprint], {
    item: listeningReviewItems,
  }).from(listeningReviewItems)
    .innerJoin(listeningReviews, eq(listeningReviews.id, listeningReviewItems.reviewId))
    .where(eq(listeningReviews.regionSlug, regionSlug))
    .orderBy(listeningReviewItems.narrationId, listeningReviewItems.fingerprint,
      desc(listeningReviewItems.updatedAt), desc(listeningReviewItems.id))
}

/** The picker needs metadata only. Fetch the frozen snapshot when opening one review. */
export function listeningReviewSummaries(db: DB, regionSlug: string) {
  return db.select({ id: listeningReviews.id, createdAt: listeningReviews.createdAt,
    approvedAt: listeningReviews.approvedAt }).from(listeningReviews)
    .where(eq(listeningReviews.regionSlug, regionSlug))
    .orderBy(desc(listeningReviews.createdAt)).limit(30)
}
