# Native compatibility fixtures, version 1

All input is synthetic. UUIDs, names, cookie values, and geometry do not identify riders,
accounts, production content, or recorded drives. URLs use reserved `.invalid` hosts.
Never send fixture cookies to a server or install fixture rows into the real login Keychain.

Each JSON suite has `fixtureVersion`, `suite`, `clock`, `sources`, and `cases`.
Each case has a stable `id`, `input`, and `expected`. `dto.json` additionally names the
public Zod `schema`. Missing keys and explicit JSON null are intentionally different.
`expected.value` is the JSON-normalized parse result; rejected input has `valid: false`.
Unknown response keys follow the source schema's stripping behavior.

`sse.json` carries `input.chunks: [[UInt8]]`, consumed in order without re-encoding.
`finish` is `eof`, `cancel`, `transport_error`, or `idle_timeout`. `expected.frames`
covers framing; `outcome`, `terminal`, `deltas`, and `transcriptText` cover transport and
conversation policy. The first terminal wins, even when the parser emits later frames.
A cancelled/failed turn contributes no skipper text to the outgoing transcript. No case
permits automatic retries. Parser-only tests do NOT prove cancellation or spend behavior.

`transcript.json` directly exercises the legacy pure `toWire` function.

`driving-qa.json` adds four deterministic route/fix recipes to the driving worker's golden
matrices: two GPS gaps, out-and-back projection, and repeated final-fix callback ordering.
Its expected results were executed through the retained TypeScript engine, not generated
from Swift. Swift `DrivingQARegressionTests` rebuilds the recipes and executes the native
engine. Gap recipes use the baseline stops at vertices 100/200/300/400, radius 250 m and
duration 60 seconds; the two callback recipes have no stops. This suite contains no real
location traces and does not duplicate the driving worker's baseline fixtures.

`ui-flows.json` is the Debug scenario contract for production planner/auth/library/detail
screens. It specifies streamed bytes, mock server outcomes, synthetic sessions, seed recipes
and expected UI/request evidence. Cases describe acceptance; their presence is not a UI pass.
The create-flow streams have a three-second gap before the terminal frame. The reset scenario
uses `stream.holdAfterChunkIndex: 0`: the transport holds after the first visible chunk until
cancellation. Its receipt must record the barrier reached, one cancellation, zero terminal
deliveries and zero proposal calls; visible empty state alone is not cancellation evidence.
Native DTO tests validate embedded public responses.
The app owner implements the mock transport/registry; QA never supplies replacement screens.

The two create scenarios include a valid 250 ms synthetic AAC clip from `audio/` and
an exact allowlisted fixture URL. Financial/key/route assertions remain unchanged.
Directory identity is checked under `expected.persistence` after real Storage commit and
same-run relaunch, using fresh canonical manifest and referenced-byte readback. The expected
canonical directory is unchanged; its earlier placement in an HTTP-time receipt was too early.
Preserve raw HTTP receipts, including stale directory lists. Never replace them with inferred
filesystem values or satisfy the check by seeding a directory/manifest.

`planner-map-landmark` is a separate render-only case with hand-authored Golden Gate Park
geometry. It changes none of the account/retry/reset cases and must make no create requests.
Polyline tuples use the production wire order **[longitude, latitude]**; named endpoints
retain their `lat`/`lng` properties. Swift and shared-schema tests independently check decoded
endpoints, park bounds and nonzero spans, rather than trusting coordinate-order metadata.
The public coordinates are a synthetic map reference, not a driving route or rider trace.
`map.render-status` reaches value `snapshot-ready` only from the real snapshot callback
after valid layout/fit. Inspect recognizable tiles, route and attribution in Day/Dusk and
retain `map-render-receipt.json`: callback counts, view dimensions, zoom, route point count,
projected bounds `{minX,minY,maxX,maxY}` in view points, and `routeFitsViewport`. Require a
projected span of at least 40 points. A callback on a blank/error map is not visual acceptance.

`version-policy-ui.json` adds forced update, recommended update and delayed forced-update
scenarios through the real `/version` DTO. The delayed response arrives after the Settings
sign-in sheet is opened; the root wall must take precedence. Recommended dismissal must
survive a same-run, same-bundle-version relaunch. No test opens the synthetic store URL.
The late recommended-planner case reuses a valid streamed proposal and holds the mock policy
for 25 seconds so XCTest can type an unsent draft. Later must retain both. This artificial
transport delay tests presentation lifecycle, not the production HTTP timeout budget.
Its receipt must show one plan/proposal and zero creates; private card-key identity requires
the model lifecycle regression rather than an assertion about a visible label.

The root scripts test suite consumes these fixtures through
`scripts/test/native-ios-fixtures.test.ts`. Capture changes deliberately: edit inputs AND
review expected semantics against the listed source; never regenerate golden results solely
from a new Swift implementation. Fixture version tracks the envelope format, not app version.
