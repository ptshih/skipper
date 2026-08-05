// Display cleaning for a stored place NAME.
//
// ⚠ IT LIVES IN SHARED BECAUSE BOTH SIDES CLEAN NOW (2026-08-04). It began as a mobile view helper,
// and that was right while the app did its own name filling. The cold-open copy is now composed
// SERVER-side and arrives as finished sentences, so the server has to produce exactly the string the
// app would have — and a second copy of this regex is a second answer to "is this the same place?".
// The app still imports it for cards, lists and the clip bar, which display stored names directly.

// ⚠ ALL FIFTY STATES + DC, not the region roadmap. This used to list the eleven states Tahoe,
// Yosemite and Moab could touch, with a comment saying "extend it when a new region's state can
// appear" — i.e. a REGION RELEASE, which is a server-side `released_at` flip, silently depended on a
// MOBILE BUILD nobody would think to ship. A rider in the first region east of the Rockies would just
// see "Somewhere, Missouri" on every card. The full list has no such coupling and costs one line.
// ⚠ Multi-word names must appear in full ("West Virginia", not "Virginia" plus a prefix) — the
// alternation is anchored right after the comma, so a bare "Virginia" cannot match ", West Virginia".
const STATE_SUFFIX =
  /,\s+(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming)\b/g

export const cleanPlaceName = (name: string): string => name.replace(STATE_SUFFIX, '')
