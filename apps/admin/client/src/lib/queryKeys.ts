// Centralized React-Query key factory for the admin console. Bare `['runs']`/`['pois']` string-array
// keys used to be re-typed at each read AND each invalidate site (≥6 files) — a rename or typo silently
// desynced invalidation, leaving the UI stale after a mutation (a correctness bug, not cosmetic). Routing
// every key through `qk` makes the key one typed source of truth, so a read and its invalidate can't drift.
//
// Shared-shape contract: the array-keyed caches (`runs`/`pois`/`regions`/`users`) MUST store the UNWRAPPED
// array under their key — multiple views read the same key, and a `{ field }` wrapper under it crashes
// whichever view reads it next (the `['regions']` shape-mismatch bug fixed in 4ed7477). The per-endpoint
// unwrap therefore lives in each caller's fetcher (see `useAdminList`), never here.
export const qk = {
  runs: () => ['runs'] as const,
  job: (id: string) => ['job', id] as const,
  runScores: (id: string) => ['runScores', id] as const,
  pois: () => ['pois'] as const,
  poi: (id: string) => ['poi', id] as const,
  poiNarration: (id: string) => ['poiNarration', id] as const,
  poiCorrections: (id: string) => ['poiCorrections', id] as const,
  regions: () => ['regions'] as const,
  // `region` is the PlacesView selection state (`string | null` until a region is picked); the query is
  // disabled while null, so the null-keyed cache entry is never fetched.
  places: (region: string | null) => ['places', region] as const,
  users: () => ['users'] as const,
  health: () => ['health'] as const,
}
