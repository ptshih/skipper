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
import { isAddressLike, isParkingLike, nameDisagrees } from './places'

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
