# Tahoe corridor slate (M0 — APPROVED 2026-06-06)

Hand-curated driving corridors for the first region, Lake Tahoe. **Approved by the
founder.** This is M0 authoring OUTPUT, not live data. **SUPERSEDED 2026-06-12:** the
materialize→seed workflow below is dead — tours are now AUTHORED at runtime via the admin Create
flow over the region POI corpus (`docs/decisions/region-corpus-discovery.md`); `tour-specs.ts` +
`seed/data/*.json` were deleted. Kept as the historical curated-corridor record.

> **The rails are the route.** Routes are hand-curated and frozen, never derived.
> Groundability below = a Wikidata-spine coverage proxy (narratable POIs/articles
> exist along the route); it is NOT a guarantee each one's prose extract is rich.
> Per the invariant, any stop that turns out thin on prose downgrades to scenic.

## Tour authoring (current flow — supersedes the old materialize→seed path)

The seed-time route path is GONE. `packages/db/seed/seed.ts` now seeds only regions + personas +
overrides; `materialize.ts` keeps just `materializeRoute` (the admin Create flow calls it);
`tour-specs.ts` + `data/*.json` were deleted. To create a tour:

1. **Discover the region** → `sweep-roam-pois.ts --apply` (populates the shared `pois` corpus).
2. **Author + freeze the route** → admin Create flow (LLM-propose → human-approve → `materializeRoute`).
3. **Generate** the draft tour → it selects candidates from the corpus (`pipeline/region-corpus.ts`).

The corridor slate below is the historical M0 authoring record for Lake Tahoe.

---

## The approved core 8

Ordered by priority. Verdicts: rich / adequate (all cleared the bar; none thin).

### 1. Emerald Bay Run — CA-89 West Shore  ⭐ M1 WALKING-SKELETON CORRIDOR  ✅ SEEDED
- **Route:** South Lake Tahoe → Emerald Bay → D.L. Bliss → Tahoma → Tahoe City
- **~30 mi / ~59 min** (frozen Routes-API geometry, 3,698 pts; earlier "~20 mi" was a rough straight-line guess) **· groundability: RICH (44 POIs, no thin stretches)**
- **Why:** the crown jewel — most iconic shoreline in the basin, M1-manageable length, densest coverage of the slate.
- **Anchors:** Vikingsholm (1929 Scandinavian castle), Fannette Island (the lake's only island), Emerald Bay underwater park, D.L. Bliss SP, Rubicon Point Light, Sugar Pine Point / Ehrman mansion, Watson Cabin.
- **Rough waypoints (lat,lng):** Camp Richardson 38.935,-120.041 · Emerald Bay 38.954,-120.109 · D.L. Bliss 38.985,-120.103 · Meeks Bay 39.038,-120.122 · Sugar Pine Pt/Tahoma 39.057,-120.118 · Homewood 39.087,-120.160 · Tahoe City 39.168,-120.143

### 2. Donner Pass / Old US-40 — Truckee → Donner Summit
- **Route:** Truckee → Donner Lake → Donner Pass (Old Hwy 40) → Soda Springs
- **~15 mi / ~40 min · groundability: RICH (33 POIs, no thin stretches)**
- **Why:** the big-history drive and a total mood-shift from the lakeshore — Donner Party + the transcontinental railroad.
- **Anchors:** Donner Memorial SP, Summit Tunnel No. 41 (Chinese laborers), Mount Judah, historic Truckee depot / Brickelltown, Sugar Bowl (1939, Disney-backed).
- **Rough waypoints:** Truckee 39.328,-120.183 · Donner Memorial SP 39.323,-120.233 · Donner Lake 39.323,-120.243 · Donner Pass (Old 40) 39.316,-120.320 · Soda Springs 39.330,-120.380

### 3. US-50 to Echo Summit — South Shore climb
- **Route:** South Lake Tahoe → Meyers → Echo Summit → Echo Lake → Twin Bridges
- **~18 mi · groundability: RICH (47 POIs)**
- **Why:** the dramatic climb *out* of the basin — casinos at the base, the reveal at the summit, Desolation Wilderness gateway up top.
- **Anchors:** Echo Summit (1968 Olympic altitude trials), Camp Richardson, Harvey's 1980 bombing, Lover's Leap, Strawberry stage stop, Angora Fire.
- **Rough waypoints:** South Lake Tahoe 38.933,-119.985 · Meyers 38.850,-120.010 · Echo Summit 38.812,-120.030 · Echo Lake 38.830,-120.060 · Twin Bridges 38.810,-120.130

### 4. Truckee River Canyon — CA-89 Truckee → Tahoe City
- **Route:** Truckee → Olympic Valley (Palisades) → Alpine Meadows → River Ranch → Tahoe City
- **~14 mi · groundability: RICH (36 POIs)**
- **Why:** follows the river; the Olympic/sport drive.
- **Anchors:** 1960 Winter Olympics (only Winter Games in CA), Blyth Arena, Papoose Peak jumps, Lake Tahoe Dam.
- **Enhancement:** fold in the **Alpine Meadows spur** — the 1982 avalanche + Anna Conrad rescue. Olympic triumph and disaster back-to-back.
- **Rough waypoints:** Truckee 39.328,-120.183 · Olympic Valley/Palisades 39.197,-120.235 · Alpine Meadows 39.170,-120.220 · River Ranch 39.160,-120.180 · Tahoe City 39.168,-120.143

### 5. East Shore — NV-28 Spooner → Sand Harbor → Incline
- **Route:** Spooner Summit → Sand Harbor → Thunderbird Lodge → Incline Village
- **~12 mi · groundability: RICH (15 POIs — tight but high-quality)**
- **Why:** the bluest water on the lake + one great eccentric anchor.
- **Anchors:** Thunderbird Lodge (Whittell's 1936 stone estate + tunnel), SS Tahoe (steamer scuttled 1940), Glenbrook, Diamond Peak.
- **Flag:** Sand Harbor itself returns thin (4 results) — narrate the flanking anchors, treat the beach as scenic.
- **Rough waypoints:** Spooner Summit 39.106,-119.906 · Sand Harbor 39.198,-119.930 · Thunderbird Lodge 39.225,-119.933 · Incline Village 39.250,-119.950

### 6. The Comstock Descent — Glenbrook → Spooner → Clear Creek Canyon → Carson City  🆕
- **Route:** Glenbrook (US-50 lakeshore) → Spooner Summit → down Clear Creek Canyon → Carson City
- **~16 mi / ~35 min · groundability: RICH**
- **Why:** the single best "why does Tahoe look the way it does" story — Duane Bliss's Glenbrook lumber empire logged the basin to timber the Comstock mines, hauled by narrow-gauge to Spooner, then floated 2,300 ft down a V-flume to the V&T Railroad. You drive the route the timber took.
- **Anchors:** Glenbrook, Spooner, Carson & Tahoe Lumber/Fluming Co., Lincoln Highway / Pony Express overlay on US-50.
- **Rough waypoints (to refine):** Glenbrook 39.087,-119.937 · Spooner Summit 39.106,-119.906 · Clear Creek Canyon ~39.13,-119.83 · Carson City ~39.16,-119.77

### 7. North Shore — CA-28 Tahoe City → Crystal Bay
- **Route:** Tahoe City → Carnelian Bay → Kings Beach → Crystal Bay → Incline
- **~12 mi · groundability: RICH (34 POIs)**
- **Why:** the lore-and-characters drive.
- **Anchors:** Cal-Neva (Sinatra / Rat Pack / mob), Ponderosa Ranch (*Bonanza*), Granlibakken (Tahoe's oldest ski hill), Watson Cabin, Tahoe Maritime Museum.
- **Flag:** Carnelian Bay segment is soft but short and flanked by rich points.
- **Rough waypoints:** Tahoe City 39.168,-120.143 · Carnelian Bay 39.226,-120.082 · Kings Beach 39.237,-120.026 · Crystal Bay/Cal-Neva 39.227,-119.999 · Incline 39.250,-119.950

### 8. Full Lake Tahoe Loop — CA-89 / US-50 / NV-28  (flagship "do the whole thing")
- **Route:** circumnavigate the lake
- **~72 mi / ~3 hr · groundability: RICH (98 POIs)**
- **Why:** the grand tour. West/south shores very dense; the Nevada east side is thinner *by count* but carries marquee anchors (Thunderbird, Cave Rock, Glenbrook).
- **Note:** overlaps #1/#5/#6/#7 heavily — see dependencies.

---

## Dependencies & overlaps (matter when freezing polylines)

- **#1 Emerald Bay Run ⊂ #8 Full Loop** (west shore is a sub-segment).
- **#5 East Shore + #6 Comstock Descent** share the Glenbrook/Spooner cluster.
- **#7 North Shore** shares Crystal Bay with #8; its endpoints touch #4's.
- #8 reuses most of #1/#5/#6/#7 — the focused drives are largely subsets of the loop.

## Bench (not in the core 8 — strong alternates / later tier)

- **Carson Pass (CA-88)** — RICH; Kit Carson/Frémont emigrant arc, Tragedy Spring, 1864 Kirkwood Inn, Red Lake Peak. *South of the basin* → lead the Tahoe-adjacent expansion with this.
- **Kingsbury Grade → Genoa (NV-207) / Carson Valley Foothills to Genoa** — RICH; Genoa = Nevada's oldest town (Mormon Station, 1851), Snowshoe Thompson. Eastern doorstep; more valley than lake.
- **Mount Rose Highway (NV-431)** — ADEQUATE; highest year-round Sierra pass, snow-survey observatory — but coverage padded by radio towers, thin Reno end. Scenic-leaning.
- **Brockway Summit (CA-267)** — ADEQUATE; rich ends, forested/scenic middle. A connector, not a destination — skip for now.
- **Monitor Pass** (remote/cinematic, seasonal) and **Truckee → Sierra Valley / Lost Sierra** (connector) — beautiful but edging out of the basin → seasonal/later.

## Expansion order

Tahoe (now) → Yosemite → Moab (mind seasons; M4+).
