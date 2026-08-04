/**
 * The curated-endpoint address guard — and the wrong version of it that must never come back.
 *
 * `autocompletePlaceId` sends a HARD bbox restriction and takes the FIRST prediction, with nothing
 * checking that the result resembles the query. So a draft naming a place just OUTSIDE the box cannot
 * be returned, and Autocomplete answers with the nearest in-box NAME-ALIKE — routinely a residential
 * street. Details then confirms it IS in the box, so every pre-existing check passed and the row landed
 * in `places` as a curated endpoint. Measured on the first bbox-scoped run (2026-08-03): Hope Valley
 * (lat 38.75, below the box) resolved to "Hope Court" in Truckee, and Carson Pass (38.69) to "Carson
 * Court" — both stored ENDPOINT-eligible, so the planner could offer a rider a drive to a cul-de-sac.
 *
 * ⚠ THE POINT OF THIS FILE is the second block. The obvious guard — "reject a resolve with no
 * primaryType" — is WRONG and would delete the most important endpoints in every region, because
 * Google returns NO primaryType for a locality. That is not a guess: of 98 curated Tahoe rows, 31 had a
 * null primaryType, including Truckee, Tahoe City, South Lake Tahoe, Incline Village, Kings Beach,
 * Stateline and Glenbrook. Towns and streets are indistinguishable through `primaryType`; only the
 * plural `types` separates them.
 */
import { describe, expect, it } from 'bun:test'
import { isAddressLike, isBusinessLike, isParkingLike, nameDisagrees } from './places'
import {
  isAddressLike as isAddressLikeStudio,
  isBusinessLike as isBusinessLikeStudio,
  isParkingLike as isParkingLikeStudio,
  nameDisagrees as nameDisagreesStudio,
} from '../../../packages/studio/src/pipeline/places'

// Shapes as the Places API (New) returns them — address-component types vs a locality's types.
const TOWN = ['locality', 'political']
const STREET = ['route']
const STREET_ADDRESS = ['street_address']
const STATE_PARK = ['state_park', 'park', 'tourist_attraction']
const TRANSIT = ['transit_station', 'train_station']

describe('isAddressLike', () => {
  it('rejects the street resolves that actually shipped', () => {
    // "Hope Court" / "Carson Court" — the substitutions this guard exists to stop.
    expect(isAddressLike(STREET)).toBe(true)
    expect(isAddressLike(STREET_ADDRESS)).toBe(true)
  })

  it('rejects every address-component type', () => {
    for (const t of ['street_address', 'route', 'premise', 'subpremise', 'intersection', 'plus_code', 'postal_code']) {
      expect(isAddressLike([t])).toBe(true)
    }
  })

  it('ADMITS a town — the case the primaryType version of this guard would have killed', () => {
    expect(isAddressLike(TOWN)).toBe(false)
  })

  it('admits ordinary establishments', () => {
    expect(isAddressLike(STATE_PARK)).toBe(false)
    expect(isAddressLike(TRANSIT)).toBe(false)
  })

  it('admits when types are absent rather than failing closed', () => {
    // A missing `types` must not silently delete a legitimate place. The bbox + coords guards already
    // ran by this point; this one only ever removes something it can positively identify as an address.
    expect(isAddressLike(undefined)).toBe(false)
    expect(isAddressLike([])).toBe(false)
  })

  it('rejects a mixed list containing an address type', () => {
    // Google can return several types; one address component is enough to disqualify an endpoint.
    expect(isAddressLike(['establishment', 'route'])).toBe(true)
  })
})

/**
 * The CAR-PARK guard — the second way a resolve substitutes, and the one no prompt can prevent.
 *
 * The address guard above catches a draft naming something OUTSIDE the box. This catches a draft that
 * was entirely RIGHT: asked for `Heavenly Mountain Resort` — a real, top-ranked destination inside the
 * box — the bbox-restricted Autocomplete returns `California Main Lodge Parking`, the resort's own
 * parking structure. Details confirms it is in the box, so it landed as a curated endpoint at RANK 2,
 * and the planner would have offered a rider a drive ending in a ski resort's parking garage.
 *
 * ⚠ It also poisoned the routability sweep, because a rank-2 row is used as a probe ORIGIN: every route
 * measured FROM the car park read "restricted usage or private roads", so the sweep reported South Lake
 * Tahoe and Stateline as undrivable and proposed an access point 25 km from Downtown's pin.
 */
describe('isParkingLike', () => {
  // Verified against the live Places API, 2026-08-04 — this is the exact payload that shipped the bug.
  const MAIN_LODGE = ['parking_lot', 'parking', 'transportation_service', 'service', 'point_of_interest', 'establishment']

  it('rejects the car park Google returns for a resort name', () => {
    expect(isParkingLike(MAIN_LODGE)).toBe(true)
  })

  it('⚠ KEEPS the real destination, whose types OVERLAP the car park\'s', () => {
    // `Heavenly Mountain Scenic Gondola` — the row that replaced it — shares point_of_interest and
    // establishment with the lot above. A guard written against those would delete the fix along with
    // the bug, which is why only the two parking types are matched.
    expect(isParkingLike(['tourist_attraction', 'point_of_interest', 'establishment'])).toBe(false)
  })

  it('⚠ KEEPS a town — the failure mode the sibling guard already documents', () => {
    // A locality carries no primaryType and no parking type. Rejecting broadly here would repeat the
    // "reject a null primaryType" mistake the block above exists to prevent.
    expect(isParkingLike(['locality', 'political'])).toBe(false)
  })

  it('is empty-safe, like its sibling', () => {
    expect(isParkingLike(undefined)).toBe(false)
    expect(isParkingLike([])).toBe(false)
  })
})

/**
 * The NAME-AGREEMENT guard — the general case the two type guards are corners of.
 *
 * `isAddressLike` catches a street and `isParkingLike` catches a car park, but both are lists of shapes
 * we happened to get burned by. The real defect is that the resolve substitutes, and it has now shipped
 * five times. The one no type list could have caught: a draft naming `Reno` came back as **"Downtown"**
 * and was stored under that name, so the planner carried Reno in its roster under a word no rider would
 * ever say — and a rider asking for Reno got "not my country yet".
 */
describe('nameDisagrees', () => {
  it('catches the two substitutions that actually shipped', () => {
    expect(nameDisagrees('Reno', 'Downtown')).toBe(true)
    expect(nameDisagrees('Heavenly Mountain Resort', 'California Main Lodge Parking')).toBe(true)
  })

  it('⚠ KEEPS a subset and a superset — neither is close by any string metric', () => {
    // The reason this compares TOKENS rather than substrings or edit distance. Both of these are real
    // resolves from the live curation and both must survive.
    expect(nameDisagrees('Truckee, California', 'Truckee')).toBe(false)
    expect(nameDisagrees('Echo Summit', 'Site of Echo Summit (California Historical Landmark No. 1048)')).toBe(false)
    expect(nameDisagrees('Northstar Village', 'The Village At Northstar')).toBe(false)
    expect(nameDisagrees('Mt. Rose Ski Tahoe', 'Mt. Rose - Ski Tahoe')).toBe(false)
  })

  it('⚠ DOES NOT catch a same-word substitution — that is the address guard\'s job', () => {
    // `Hope Valley` (below the box) resolving to `Hope Court` in Truckee shares "hope", so this guard
    // passes it. The guards are complements, not alternatives; deleting either reopens a real hole.
    expect(nameDisagrees('Hope Valley', 'Hope Court')).toBe(false)
    expect(isAddressLike(['route'])).toBe(true)
  })

  it('⚠ THE ACCEPTED FALSE POSITIVE: a legitimate rename is dropped', () => {
    // Palisades Tahoe really was called Squaw Valley until 2021, so the resolve is CORRECT and this
    // guard rejects it anyway — the two names share nothing. Documented rather than tuned around,
    // because the skip line prints both names and an operator can add it back manually.
    expect(nameDisagrees('Squaw Valley', 'Palisades Tahoe')).toBe(true)
  })

  it('fails OPEN when either name is all noise', () => {
    // A name with nothing comparable left is not evidence of a substitution.
    expect(nameDisagrees('The', 'Truckee')).toBe(false)
    expect(nameDisagrees('', 'Truckee')).toBe(false)
  })
})

describe('isBusinessLike', () => {
  // Types as the 2026-08-04 deep run actually returned them.
  const PAINTER = ['painter', 'point_of_interest', 'establishment']
  const REALTY = ['real_estate_agency', 'point_of_interest', 'establishment']
  const COWORKING = ['coworking_space', 'point_of_interest', 'establishment']
  const BUS_STOP = ['bus_stop', 'transit_station', 'point_of_interest', 'establishment']

  it('rejects the business rows that actually landed in the allowlist', () => {
    // `Sierra Rainbow Painting Inc` reached rank 10 — a painting contractor the planner could offer a
    // rider as a destination. `Serene Lakes Realty` is the shape that names it: a real place ("Serene
    // Lakes") whose name a local business also carries.
    expect(isBusinessLike(PAINTER)).toBe(true)
    expect(isBusinessLike(REALTY)).toBe(true)
    expect(isBusinessLike(COWORKING)).toBe(true)
    expect(isBusinessLike(BUS_STOP)).toBe(true)
  })

  it('ADMITS the hospitality + landmark types a broader rule would have eaten', () => {
    // ⚠ THIS IS THE POINT OF THE GUARD'S NARROWNESS, and the reason `lodging`/`hotel`/restaurant types
    // are absent from it. Camp Richardson, Edgewood Tahoe and Sunnyside Restaurant & Lodge are real
    // top-of-mind Tahoe destinations; a rule broad enough to catch a motel takes them too.
    expect(isBusinessLike(['resort_hotel', 'lodging', 'point_of_interest'])).toBe(false)
    expect(isBusinessLike(['american_restaurant', 'bar', 'restaurant', 'food'])).toBe(false)
    expect(isBusinessLike(['lodging', 'point_of_interest', 'establishment'])).toBe(false)
    expect(isBusinessLike(['campground', 'lodging', 'point_of_interest'])).toBe(false)
    expect(isBusinessLike(['museum', 'point_of_interest', 'establishment'])).toBe(false)
    expect(isBusinessLike(['ski_resort', 'point_of_interest', 'establishment'])).toBe(false)
  })

  it('leaves a rail depot alone — a station can BE the landmark', () => {
    // Deliberately narrower than "transit": `transit_station`/`train_station` are excluded so Truckee's
    // depot survives. `bus_stop` alone catches the observed failure because Google tags a stop with both.
    expect(isBusinessLike(TRANSIT)).toBe(false)
    expect(isBusinessLike(['train_station', 'transit_station', 'point_of_interest'])).toBe(false)
  })

  it('admits towns and parks, and does not fail closed on absent types', () => {
    expect(isBusinessLike(TOWN)).toBe(false)
    expect(isBusinessLike(STATE_PARK)).toBe(false)
    expect(isBusinessLike(undefined)).toBe(false)
    expect(isBusinessLike([])).toBe(false)
  })

  it('the two mirrored copies agree — they are hand-kept and drift silently', () => {
    // ⚠ There is no shared module: apps/admin cannot depend on @skipper/studio, so this guard exists
    // TWICE, byte-identical by hand. Nothing but this test notices when one is edited and the other is
    // not, and a divergence means the console and the CLI would curate different sets from one draft.
    for (const types of [PAINTER, REALTY, COWORKING, BUS_STOP, TOWN, STATE_PARK, TRANSIT, undefined]) {
      expect(isBusinessLikeStudio(types)).toBe(isBusinessLike(types))
    }
  })
})

/**
 * ⚠ PARITY FOR THE OTHER THREE GUARDS, which the mirror comments always claimed ("the two must move
 * together") but only `isBusinessLike` actually had. All four are hand-duplicated across
 * apps/admin/server/places.ts and packages/studio/src/pipeline/places.ts, and all four decide what
 * lands in `places` — the planner's wire-level allowlist. A divergence means the console and the CLI
 * curate DIFFERENT SETS from one draft, which is exactly the failure the mirroring was supposed to
 * prevent and the one nothing was watching for.
 *
 * ✅ `draftSystem` (the Opus draft prompt) is mirrored the same way — server/places.ts vs
 * packages/studio/src/curate-places.ts — and was the highest-value remaining gap until 2026-08-04. It
 * is now pinned at the bottom of this file, by TEXT comparison rather than by call, since both copies
 * are module-private.
 */
describe('mirrored guard parity (admin ↔ studio)', () => {
  const TYPE_CASES: (string[] | undefined)[] = [
    TOWN, STREET, STREET_ADDRESS, STATE_PARK, TRANSIT,
    ['parking_lot'], ['parking_garage', 'point_of_interest'],
    ['painter', 'point_of_interest', 'establishment'],
    ['bus_stop', 'transit_station'],
    ['lodging', 'point_of_interest'],
    [], undefined,
  ]

  it('isAddressLike agrees across both copies', () => {
    for (const types of TYPE_CASES) expect(isAddressLikeStudio(types)).toBe(isAddressLike(types))
  })

  it('isParkingLike agrees across both copies', () => {
    for (const types of TYPE_CASES) expect(isParkingLikeStudio(types)).toBe(isParkingLike(types))
  })

  it('nameDisagrees agrees across both copies — including its NAME_NOISE stop-list', () => {
    // Pairs chosen to exercise the shared noise list and the rename false-positive, not just the
    // trivially-equal case: if one copy's NAME_NOISE gains or loses a word, these diverge.
    const NAME_CASES: [string, string][] = [
      ['Reno', 'Downtown'],
      ['Squaw Valley', 'Palisades Tahoe'],
      ['Lake Tahoe', 'Lake Tahoe'],
      ['The Y', 'Y Junction'],
      ['Emerald Bay', 'Emerald Bay State Park'],
      ['Donner Pass', 'Donner Pass Road'],
      ['Truckee', 'Truckee, CA'],
      ['', 'Truckee'],
    ]
    for (const [drafted, resolved] of NAME_CASES) {
      expect(nameDisagreesStudio(drafted, resolved)).toBe(nameDisagrees(drafted, resolved))
    }
  })
})

/**
 * ⚠ THE LAST MIRROR, AND THE ONE THE COMMENT ABOVE CALLED "the highest-value remaining gap".
 *
 * `draftSystem` — the Opus prompt that drafts a region's candidate places — is hand-copied into
 * apps/admin/server/places.ts AND packages/studio/src/curate-places.ts, and BOTH are live: an operator
 * curates from the console or from the CLI. What that prompt produces becomes the `places` set, which
 * IS the planner's wire-level allowlist. So a divergence means the two entry points draft DIFFERENT
 * candidate sets for one region, and a rider's endpoint options depend on which tool somebody happened
 * to reach for. Nothing would surface that.
 *
 * Both copies are module-private, which is why this compares TEXT rather than calling them — the
 * approach the note above prescribed. The signature line is skipped on purpose: the two files
 * legitimately name the bbox type differently (`RegionBbox` vs `BboxCorners`), and that is the only
 * difference allowed to exist.
 */
describe('draftSystem parity (admin ↔ studio)', () => {
  /** The function's body, minus its signature line. Asserts its own extraction so a refactor that
   *  renames or reshapes the function fails LOUDLY instead of comparing two empty strings. */
  const bodyOf = (src: string, label: string): string => {
    const start = src.indexOf('function draftSystem')
    expect(start, `${label}: no \`function draftSystem\` found — did it get renamed?`).toBeGreaterThan(-1)
    const rest = src.slice(start)
    const end = rest.indexOf('\n}')
    expect(end, `${label}: could not find the end of draftSystem`).toBeGreaterThan(-1)
    const block = rest.slice(0, end)
    return block.slice(block.indexOf('\n') + 1)
  }

  it('the drafting prompt is byte-identical in both copies', async () => {
    const admin = bodyOf(await Bun.file(`${import.meta.dir}/places.ts`).text(), 'admin')
    const studio = bodyOf(
      await Bun.file(`${import.meta.dir}/../../../packages/studio/src/curate-places.ts`).text(),
      'studio',
    )
    // Non-vacuous: this is a long prompt, so a few hundred bytes would mean the extraction broke.
    expect(admin.length).toBeGreaterThan(1_500)
    expect(studio).toBe(admin)
  })
})
