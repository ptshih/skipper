import { z } from 'zod'

/**
 * A NARRATION's treatment/depth — "what kind of telling" (a `narrations` row's `form`):
 *   story  = fact-grounded telling + audio.
 *   scenic = delivery-only ambient audio, no facts.
 *   break  = food/rest stop; names the curated anchor only. NOTE: the break CLIP is stored
 *            place-anchored in the `detours` table, NOT as a poi-bound `narrations` row — this value
 *            is the played-form/treatment projection (see `driveClipForm`/`stopType`), not break storage.
 *   wave   = RETIRED. It was roam's passing call-out, and roam was removed entirely in 1.1 — nothing
 *            generates one and no drive can play one. The VALUE survives only because this enum is
 *            paired member-for-member with the pg `narration_form` enum by `bun run lint:enums`, so
 *            narrowing it here forces a destructive migration in the same commit (see `driveClipForm`).
 *   bside  = a deferred "tell me more" alternate telling.
 * Keep in lockstep with the pg `narration_form` enum (@skipper/db/schema).
 */
export const narrationForm = z.enum(['story', 'scenic', 'break', 'wave', 'bside'])

/**
 * The three-way TREATMENT discriminator the studio branches on while building a prompt or grading a
 * clip. Not backed by its own pg enum: `narrations.form` (a superset) is the storage truth.
 *
 * ⚠ Despite living here, this is NOT a wire shape and nothing ever parses it (verified 2026-07-30:
 * the Zod value has zero importers; only the inferred TYPE is imported, by exactly three studio files
 * — `pipeline/narrate.ts`, `pipeline/lint.ts`, `eval/grounding.ts`). The DTO for a played clip is
 * `driveClipForm` (the played wire forms), and the player's icon/treatment switch is its own
 * plain-string map in `apps/mobile/src/ui/stops.ts` that does not import this. Reach for
 * `driveClipForm` if you want a stop's wire form. Studio-only today, so `@skipper/studio` is arguably
 * where it belongs — left here because moving it buys less than the churn costs.
 */
export const stopType = z.enum(['story', 'scenic', 'break'])
export type StopType = z.infer<typeof stopType>

/** The WIRE form of one clip in a DRIVE manifest — the player's icon/treatment switch. (V2: the
 *  placeless intro/outro framing was deleted with the `asides` concept; see
 *  docs/decisions/geometry-first-regions.md. It returns in v3 with guided tours.)
 *
 *  ⚠ `wave` came off this list in the 1.1 sweep. It was a FREE-ROAM passing call-out and roam was
 *  removed entirely in 1.1, so no drive can contain one — the live corpus is 458 rows, every one of
 *  them `story`. It stays in `narrationForm` above, which is paired byte-for-byte with the pg
 *  `narration_form` enum by `bun run lint:enums`: narrowing THAT forces a destructive migration in the
 *  same commit, which is a separate act from taking a value off the wire. Do not "finish the job" here
 *  without doing that one deliberately. */
export const driveClipForm = z.enum(['story', 'scenic', 'break'])
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
  'generate_cluster_narrations',
  'curate_places',
  'refetch_facts',
  'offline_audit',
])
export type JobKind = z.infer<typeof jobKind>

// ⚠ `durationBucket` and `interest` lived here until the 1.1 sweep, both labelled "kept for forward
// use". Neither was ever imported by anything, and both survived two product pivots untouched — which
// is the proof they were sediment rather than vocabulary. Deleted rather than re-justified: git is the
// archive, and six strings cost nothing to retype the day interests-as-a-filter is actually built.

/**
 * Access level (DERIVED per request, not a column):
 *  - `anonymous` = no/guest session (the planner, /sample, and the route preview)
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

/**
 * Where a credit came from (a `credit_entries.source`). `free_tier` (the lifetime free allotment)
 * is the only LIVE source today; `apple_iap`/`google_play` (purchased packs, provider-agnostic) and
 * `admin_grant` (make-goods) are RESERVED until the purchase plumbing lands. Keep in lockstep with
 * the pg `credit_source` enum (@skipper/db/schema).
 */
export const creditSource = z.enum(['free_tier', 'apple_iap', 'google_play', 'admin_grant'])
