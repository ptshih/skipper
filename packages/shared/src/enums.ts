import { z } from 'zod'

/**
 * A NARRATION's treatment/depth — "what kind of telling" (a `narrations` row's `form`):
 *   story  = fact-grounded telling + audio.
 *   scenic = delivery-only ambient audio, no facts.
 *   break  = food/rest stop; names the curated anchor only. NOTE: the break CLIP is stored
 *            place-anchored in the `detours` table, NOT as a poi-bound `narrations` row — this value
 *            is the played-form/treatment projection (see `driveClipForm`/`stopType`), not break storage.
 *   wave   = a free-roam passing call-out.
 *   bside  = a deferred "tell me more" alternate telling.
 * Keep in lockstep with the pg `narration_form` enum (@skipper/db/schema).
 */
export const narrationForm = z.enum(['story', 'scenic', 'break', 'wave', 'bside'])
export type NarrationForm = z.infer<typeof narrationForm>

/**
 * The WIRE projection of a stop's narration form down to the three the player renders as a
 * "stop" (story/scenic/break) — the icon/treatment switch. A read-DTO vocabulary, no longer
 * backed by its own pg enum: `narrations.form` (a superset) is the storage truth, projected
 * down by the API.
 */
export const stopType = z.enum(['story', 'scenic', 'break'])
export type StopType = z.infer<typeof stopType>

/** The WIRE form of one clip in a DRIVE manifest — the played narration forms (story/scenic/break/
 *  wave). The player's icon/treatment switch. (V2: the placeless intro/outro framing was deleted with
 *  the `asides` concept; see docs/decisions/geometry-first-regions.md. It returns in v3 with guided tours.) */
export const driveClipForm = z.enum(['story', 'scenic', 'break', 'wave'])
export type DriveClipForm = z.infer<typeof driveClipForm>

/**
 * A place's DELIVERY REGISTER — how the TTS voice should READ this stop, derived from the place's
 * TYPE (not its facts, and not the corniness of the telling). A stable property of the PLACE, stored once on the
 * POI (like `kind`), classified primarily from the Wikidata P31 "instance of" type (structural,
 * free) with an LLM fallback for the ambiguous tail. It picks a TTS style SUFFIX (`ttsStyleFor`)
 * on the shared persona base — the persona/voice/anti-fade base is unchanged; only pace/space/energy
 * shift, so it stays ONE host modulating his read, not different personas:
 *   landscape = natural features (mountain, lake, vista, geology) — slower, spacious, wonderstruck.
 *   story     = human history / built heritage (house, monument, event) — the warm storytelling BASE.
 *   town      = settlements / communities — folksier, lighter, neighborly.
 *   civic     = infrastructure / public works (dam, bridge, road, reservoir) — plain, quiet engineering pride.
 * Keep in lockstep with the pg `delivery_register` enum (@skipper/db/schema).
 */
export const deliveryRegister = z.enum(['landscape', 'story', 'town', 'civic'])
export type DeliveryRegister = z.infer<typeof deliveryRegister>

/** Where a POI came from (its DISCOVERY source) — Wikidata-spine ONLY (every poi has a QID).
 *  `wikipedia` = a story place with an article; `wikidata` = a named scenic pin (CC0). Google break
 *  anchors are NOT pois — they have no QID and live in the `places` table; `google_places` is an
 *  attribution source only (see `attributionSource`), never a discovery source. */
export const poiSource = z.enum(['wikipedia', 'wikidata'])
export type PoiSource = z.infer<typeof poiSource>

/**
 * Attribution source — a SUPERSET of `poiSource`. A clip may credit a source that
 * owns no `pois` row: enrichment layered onto an existing POI, not discovered as its
 * own POI — coordinate-keyed Macrostrat geology (CC BY 4.0), or QID-keyed Wikidata
 * structured facts (CC0). Keep in lockstep with the `AttributionSnapshot['source']`
 * union in @skipper/db/schema.
 */
export const attributionSource = z.enum(['wikipedia', 'google_places', 'macrostrat', 'wikidata'])
export type AttributionSource = z.infer<typeof attributionSource>

/**
 * Admin gen-job KINDS — the closed vocabulary of cloud-ops scripts the admin can launch, and the
 * SINGLE SOURCE OF TRUTH for it: the admin-api dispatch (`jobs.ts` SCRIPTS, typed `Record<JobKind>`),
 * the studio pipeline's `beginJob`, and the admin client's `JobKind` all derive from this. Deliberately
 * NOT a pg enum — `studio_jobs.kind` is an OBSERVABILITY label (nothing reads it for logic) and this
 * set CHURNS as ops scripts are added, so the vocabulary lives in code over a plain `text` column,
 * not a migration-bound DB type. Add a kind here + in `jobs.ts` SCRIPTS; no migration needed.
 */
export const jobKind = z.enum([
  'generate',
  'patch_clip',
  'resynth',
  'resynth_narration',
  'sweep_orphans',
  'discover_pois',
  'enrich_pois',
  'generate_narrations',
  'curate_places',
  'refetch_facts',
  'offline_audit',
])
export type JobKind = z.infer<typeof jobKind>

/**
 * DEFERRED axis (no variant matrix in v1). Not a stored tour column — kept only as the
 * studio pipeline's internal pacing key (config PACING). When the duration=skip-stops feature
 * lands it becomes a player-side trim, never separate tours.
 */
export const durationBucket = z.enum(['short', 'standard', 'long'])
export type DurationBucket = z.infer<typeof durationBucket>

/**
 * DEFERRED axis (no variant matrix in v1). When interests land they are a stop FILTER
 * (stop tags), never separate tours. Kept for forward use; not a stored tour column.
 */
export const interest = z.enum(['history', 'nature', 'geology', 'culture', 'food', 'quirky'])
export type Interest = z.infer<typeof interest>

/**
 * Access level (DERIVED per request, not a column):
 *  - `anonymous` = no/guest session (roam + the preview tour)
 *  - `free`      = a signed-in account
 * There is NO paid tier — premium is bought as CREDITS, not a plan flag, so every account is `free`
 * and the credit ledger governs what it can do (a comp = a big admin grant). `anonymous` is simply
 * the absence of an account. See docs/decisions/cut-tiers.md + credit-ledger.md.
 */
export const accessTier = z.enum(['anonymous', 'free'])
export type AccessTier = z.infer<typeof accessTier>

/** Mobile client platform — keys the per-platform app-version policy served by GET /version. */
export const platform = z.enum(['ios', 'android'])
export type Platform = z.infer<typeof platform>

/**
 * A credit-ledger entry's KIND — one immutable credit movement (the `credit_entries` table):
 *   grant   = credits added (+): the free allotment, a purchased pack, or an admin make-good.
 *   consume = credits spent (−1 per drive generation).
 *   reverse = a compensating entry (±): a platform refund clawback or a corrective reinstatement.
 * Keep in lockstep with the pg `credit_entry_kind` enum (@skipper/db/schema).
 */
export const creditEntryKind = z.enum(['grant', 'consume', 'reverse'])
export type CreditEntryKind = z.infer<typeof creditEntryKind>

/**
 * Where a credit came from (a `credit_entries.source`). `free_tier` (the lifetime free allotment)
 * is the only LIVE source today; `apple_iap`/`google_play` (purchased packs, provider-agnostic) and
 * `admin_grant` (make-goods) are RESERVED until the purchase plumbing lands. Keep in lockstep with
 * the pg `credit_source` enum (@skipper/db/schema).
 */
export const creditSource = z.enum(['free_tier', 'apple_iap', 'google_play', 'admin_grant'])
export type CreditSource = z.infer<typeof creditSource>
