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
import { isAddressLike } from './places'

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
