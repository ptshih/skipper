# The chat screen bogs down as the conversation grows

> **Status:** ⚠ **PARTLY BUILT (2026-08-03).** Steps 1–3 below are LANDED; steps 4–7 are specified and
> unbuilt; step 8 (virtualization) is a founder decision that is deliberately UNMADE. Founder report:
> *"the chat ux is lagging/bogging down after multiple messages are sent, this is a performance
> issue"*, with a pointer to their own prior solution in `/Users/ptshih/code/manoa/archive/mobile`.
> Nothing here is measured — every finding is a read of the code. **Take a device baseline before
> continuing** (see "What is not known", last).

## The shape of it

`HomeScreen` (`apps/mobile/app/index.tsx`, ~1600 lines) holds the composer draft, the streaming
string, the audio status and the transcript in ONE component, with no memoized rows beneath it. So a
render of that component reconciles every `TurnBubble`, every `PreviewCard`, and the newest card's
native `MapView` — and the transcript is an unvirtualized `ScrollView` `.map`, so nothing is ever
unmounted. The cost per render therefore grows with conversation length, which is exactly the reported
symptom: fine at first, sluggish after a dozen messages.

⚠ **The stream is NOT the problem, and that matters because it is the obvious suspect.** `bufRef` is a
ref and only `shown` is state, advancing at sentence boundaries (`index.tsx`, the say-buffer note), so
the screen already re-renders per SENTENCE rather than per token. The manoa prior art independently
arrived at the same ref-backed buffer. Do not "fix" the flush policy.

## Prior art: what the founder already solved in manoa

`/Users/ptshih/code/manoa/archive/mobile/CLAUDE.md` documents the final architecture in its "Streaming
Chat" section, across ~8 commits. The core move: **streaming text never lives in a state cell the
transcript is a sibling of.** Two React contexts (control vs messages); the in-progress bubble hoisted
into `ListFooterComponent`; list `data` pinned reference-stable by an id fingerprint that deliberately
excludes the mutating array from its deps; per-row `React.memo`; FlashList with `getItemType` recycling
buckets; manual auto-follow via `onContentSizeChange` + `scrollToOffset(animated: false)`.

⚠ **Skipper already has two of these** and must not regress them: the ref-backed stream buffer, and
`ConversationScreen`'s ref-based scroll pin.

## The ordered plan

Each step is independently shippable and independently observable.

1. **Memoize the `<Stack.Screen options>` literal and the three header buttons.** ✅ LANDED.
   *No manoa equivalent — this one is expo-router-specific and was found from first principles.*
   `Screen` pushes `options` through `navigation.setOptions` from a `useLayoutEffect` keyed on that
   object, and react-navigation's updater always spreads a new object, so React can never bail out. A
   fresh literal forced a **navigator-wide re-render plus a native-stack header re-commit,
   synchronously before paint**, on every keystroke, every sentence flush and every 500 ms audio tick.
2. **`export const TurnBubble = memo(TurnBubbleBase)`.** ✅ LANDED. All four props are primitives, so
   the default comparator is correct — skipper needs no equivalent of manoa's `arePropsEqual` escape
   hatch, because its streaming text is a fresh immutable string rather than an in-place mutation.
3. **Make `myDrives` lazy.** ✅ LANDED. It allocated `drives.map(...)` on every render but is consumed
   only in the offline branch. (`Ridgeline` memoization is the unbuilt remainder of this step — it
   recomputes seven `Math.hypot`/`Math.atan2` segments per render for a decoration that never changes,
   and wants a both-themes visual pass.)
4. **Let the Composer own its own draft text.** UNBUILT — the single biggest win for the founder's
   exact words. Composer text is state at the screen root, so each character re-runs the whole render
   body on the character-appears latency path. Manoa match: `ChatInput` owns its own `text`. ⚠ Preserve
   the region-switch clear with `key={c${convSeq.current}}` — "Start fresh" already unmounts it.
5. **Memoize the transcript behind a structural fingerprint; bucket cards by `afterTurn`.** UNBUILT.
   The interleave is O(turns × cards) because a `for (const c of cards)` runs inside `turns.forEach`.
   ⚠ `proposeKey`/`undrawnRoute` is genuinely NOT the bottleneck (`cards` is 1–3) — fix it while you
   are there, do not present it as the cause.
6. **Extract a memoized `TranscriptCard`.** UNBUILT. `React.memo` on `PreviewCard` alone will NOT bite:
   `renderCard` hands it a freshly-built `previewClip` tree plus five fresh closures every render, so a
   shallow comparator can never match.
7. **Only if lag survives: move the 2 Hz audio-status subscription off the screen root.** UNBUILT and
   ranked last on purpose. ⚠ Do NOT take the cheap alternative of widening `updateInterval` —
   `status.currentTime` feeds the stall detector and the `atEnd` check, so that is a behaviour change
   to clip-end handling. ⚠ The provider must sit INSIDE the screen: D35 exclusive audio focus assumes
   exactly one owner.

## ⛔ Do NOT reach for these — the prior art tried them HERE and reverted

- **`removeClippedSubviews`** — manoa shipped it and pulled it one commit later. It remounts
  variable-height rows when programmatic auto-follow yanks them back into view.
- **`useDeferredValue` / `startTransition` / `useTransition`** — reverted on this exact surface. Once
  the screen is out of the per-token path these make streaming CHUNKIER: React has no competing work
  to interleave, so transitions pile up between paints.
- **FlatList / VirtualizedList window tuning** — a dead end in the prior art regardless.

## Step 8 — virtualization is a REAL dependency decision, left unmade

The unvirtualized `ScrollView` is the structural ceiling under everything above, but it is not what is
being felt at 10–20 turns. Manoa's answer was `@shopify/flash-list@2.x`; skipper does not carry it.
This is **three** decisions, not one: a new native-adjacent dependency (which per `apps/mobile/CLAUDE.md`
must come through `expo install`, not `bun add` — and RN's built-in `FlatList` needs no new dep at
all); `ConversationScreen`'s contract changes, and its `useScrollEdgeFades` is SHARED with `Screen.tsx`,
so forking it costs thirteen other screens; and the transcript is a heterogeneous interleave that must
first flatten to a tagged `{kind:'turn'|'card'}[]`. **Do not take this without an explicit founder
decision, and not until steps 1–7 are measured.**

## What is not known

Every finding here is static reading. Before continuing, take a simulator baseline at ~10 turns with 2
route cards: hold a key down in the composer and watch for character lag; send a turn and watch stream
cadence; play a preview clip and repeat. React DevTools' Profiler with "record why each component
rendered" settles most of it in one pass. ⚠ Metro is the one dev server that may be freely stopped and
started for this (root `CLAUDE.md`, founder 2026-08-03), and kill the expo-dev-client floating FAB
first or it will sit over the very header step 1 changes.
