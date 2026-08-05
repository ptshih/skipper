# Cut the couch "simulated drive"; the drive-detail page IS the mini-preview

> **Status:** DECIDED + BUILT 2026-07-16. The map-less couch PREVIEW clock (`?mode=preview` — a compressed
> segment-timeline "simulated drive") is DELETED. Auditioning a drive before you drive it is now a native
> per-stop mini-preview on the drive-detail page: tap any stop (a List row or a Map pin) to hear that one
> clip. Create-success lands on the detail page instead of auto-dropping into the sim. Removed:
> `packages/engine/src/preview.ts` (+ its test + the `export * from './preview'` barrel line), the preview
> clock + `jumpToStop` + `totalPreviewMs`/`totalRealMs`/`rollingDistanceM` from `useDrive`, every `isPreview`
> branch in the player, and `voice.cta.preview` / `voice.player.previewHint` / the orphaned rest-stop copy.
> `useDrive`'s mode union is now `'sim' | 'live'`. Supersedes the "post-create → couch preview" handoff in
> [create-a-drive-architecture.md](./create-a-drive-architecture.md) and the three-clock model in
> [gps-player-spec.md](../designs/gps-player-spec.md). Founder-directed; discrete-only was chosen over keeping a
> continuous "play all" (the tradeoffs were surfaced and accepted). Not committed/pushed as of writing.
>
> ⚠ **PARTLY SUPERSEDED 2026-08-05:** the surface stands, but its AUDIO RESOLUTION is now disk-only (no
> presigned fallback, no re-sign) and `?mode` is retired — both addressed in dated addenda in place. See
> [download-before-start.md](../designs/download-before-start.md) §10 N1/N2 + §11.

## Why

The old flow dropped a rider straight into a full-screen "simulated drive" the instant they created a drive
— a compressed, auto-playing run-through of the whole route. Two problems the founder named:

1. **The auto-drop felt abrupt/weird.** You asked for a drive; you got launched into a player without a beat.
2. **A separate "Take the simulated drive" mode is the wrong surface for "did I get a good drive?"** The
   natural thing to do with a drive you just made is *poke at its stops* — hear stop 3, glance at the route,
   hear stop 7 — not sit through a linear run.

So the couch preview's two live entry points (the post-create auto-drop and the drive-detail "Take the
simulated drive" ghost) are gone, and its third (the anonymous account-gate escape hatch) had already been
rerouted to `/sample` (see [sample-ride-postcard.md](./sample-ride-postcard.md)). With no callers left, the
whole preview clock is deleted rather than left as dead weight.

## What replaces it

The drive-detail page (`app/drives/[id]/index.tsx`) becomes the mini-preview:

- A **List ⇄ Map** toggle (`Segmented`). **List is the default** — it's the offline + accessibility-complete
  surface; the Map needs network tiles + a Google key (else the untinted Apple-Maps fallback).
- **Tap a stop** (a List row or a Map pin) → play that one clip. A docked **NOW PLAYING** card carries the
  scrubber, transport (±15), and the clip's CC BY-SA `SourceCredit`.
- Audio resolves through `offline.loadPlayback`'s `seq → uri` map (local `file://` when downloaded, presigned
  https otherwise) — **never `clip.url` directly** (the on-disk manifest nulls every url, so a raw read is
  un-playable offline). A miss/expired-TTL re-signs once; a genuinely-absent seq (a partial download) shows a
  soft "pull the drive again" hint. The mini-player is polite (`mixWithOthers`, no background playback) and
  pauses on blur so it never talks under the live drive. Lives in `src/lib/useStopPreview.ts`.

The live "Start the drive" CTA (`?mode=live`, real device GPS — the M1 headline) is unchanged.

### ⚠ ADDENDUM 2026-08-05 — the mini-preview is DISK-ONLY; there is no re-sign

The surface, the founder's call and everything above about *why* tap-a-stop replaced the couch clock
are unchanged. **Two sentences of the mechanism are now false**, both consequences of *a drive's audio
is only ever played from disk* (`docs/designs/download-before-start.md` §10, N1/N2). Corrected here
rather than in place, per the append-only rule.

- **"local `file://` when downloaded, presigned https otherwise" → local `file://` and nothing else.**
  `loadPlayback` has no online branch left; `resolveUri` returns whatever the disk map holds.
- **"a miss/expired-TTL re-signs once" → a miss means the bytes are NOT ON THIS PHONE.** `signDriveAudio`
  and `resignPlayback` are deleted along with the server route behind them, so there is nothing to
  re-sign and nothing to stream. A local file has no TTL to expire. ⚠ The ONE recovery that remains is
  not a network call: the file may have LANDED since the map was cached, so `resolveUri` re-reads the
  map from disk once before answering null — which is what keeps a stop tapped during the ~10 s
  auto-download from reading "unplayable" for the rest of the screen's life.
- **The `clip.url` rule is unchanged and now unconditional.** Never read it directly; the on-disk
  manifest strips every url BY TYPE.
- **A miss is three different situations and the copy has to survive all three:** the auto-download is
  still running (the route hint swaps to `voice.offline.gateSaving` while it is), the copy is partial,
  or the drive was never saved. On an OLD undownloaded drive that means **no stop auditions at all
  until the rider taps Save** — auto-download fires at CREATE only, and that regression was taken
  knowingly (§10 N2). ⚠ The tempting fix — "just stream the one clip they tapped" — resurrects every
  deleted row at once, and is refused there by name.
- **The stall budget is no longer shared with the streaming previews.** This surface takes the short
  `LOCAL_CLIP_STALL_MS` (a local file decodes or it does not); `useRoutePreview` still streams and
  keeps the generous remote one. Same watchdog machinery (`preview-audio.ts`), different number.

⚠ **And the last line of this section is stale twice over.** `?mode` is RETIRED — the GPS clock is a
setting (`simMode`, default false everywhere), not a route — and the Start CTA is no longer
"unchanged": it is GATED on a complete local copy, in one expression shared with the player. The
mini-preview stays ungated in the sense that it needs no download DECISION; it simply plays only what
is here.

## What we consciously gave up

Discrete tap-a-stop is NOT a continuous end-to-end audition. The old preview time-compressed the between-stop
gaps and threaded the licensed drive-music soundtrack, so you could hear a drive's whole arc + soundtrack from
the couch; that's gone. It was also the surface for the founder ear-pass and for an App Reviewer (with an
account) to hear a full drive without driving to Tahoe. Those fall back to `/sample` (the one-clip taste) +
tapping individual stops. The map's moving puck is gone too (no continuous clock) — the detail map shows a
static route + pins with the active pin highlighted. The alternative (keep a "Play all" reusing the engine)
was weighed and declined in favor of the simpler discrete surface.

## Landmine closed

`play.tsx`'s mode resolver fell back to `'preview'` for a malformed/mode-less deep link in RELEASE (so a stray
link never hit the dev `sim` clock). With the preview clock deleted that arm pointed at nothing — retargeted to
`'live'` (the only real release clock) in the same change. The dev fallback stays `'sim'`.

⚠ **ADDENDUM 2026-08-05 — that resolver is GONE, and the landmine closed structurally.** `?mode` is retired
entirely: the GPS clock is a persisted SETTING (`simMode`, default FALSE everywhere — `__DEV__` deliberately
does NOT seed it), so `driveMode = simMode ? 'sim' : 'live'` is one input and one expression, a deep link can
no longer say anything about the clock, and there is no build-type branch left in the player to get the
fallback wrong. The `__DEV__` "Simulated drive" ⋯ item went with it — Settings → Developer is the single
control. See `docs/designs/download-before-start.md` §11 + §13.4.
