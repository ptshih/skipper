# The chat screen bogs down as the conversation grows

> **Status:** ⚠ **PARTLY BUILT (2026-08-03).** Steps 1–**4** are LANDED; steps 5–7 are specified and
> unbuilt; step 8 (virtualization) is a founder decision that is deliberately UNMADE. Founder report:
> *"the chat ux is lagging/bogging down after multiple messages are sent, this is a performance
> issue"*, with a pointer to their own prior solution in `/Users/ptshih/code/manoa/archive/mobile`.
> **Step 4 is MEASURED on the simulator** (the first step here that is — see "What is measured");
> steps 5–7 remain static reads of the code.

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
4. **Let the Composer own its own draft text.** ✅ LANDED, and **measured: 1 full `HomeScreen` render
   per keystroke → 0.** Manoa match: `ChatInput` owns its own `text`. `ComposerProps.onSend` now takes
   the text as an argument and the field clears itself; the screen never sees the draft until send.
   ⚠ The region-switch clear is a **remount**, keyed on a NEW state ordinal `composerSeq` — *not* on
   `convSeq.current` as this plan originally said. A `key` is read during render and `convSeq` is a
   ref, which is `react-hooks/refs` ("Cannot access refs during render"); `app/index.tsx` already
   baselines exactly ONE of those in `eslint-suppressions.json`, and that file is a backlog to burn
   down, not somewhere to add a second. It is also not `resetSeq`, which additionally schedules the
   autofocus a region switch must *not* fire. Three ordinals, three different effects.
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

## What IS measured (2026-08-03, step 4)

Method, so it can be repeated rather than trusted: a `console.log` render counter in `HomeScreen` and
in `TurnBubbleBase`, read back out of the Metro log, driving the simulator with single-character
`ui_type` calls. No DevTools Profiler needed — render COUNTS answer the question and survive being
read from a log file. (The instrumentation was temporary and is not in the tree.)

| | before step 4 | after step 4 |
|---|---|---|
| `HomeScreen` renders per keystroke | **1** | **0** |
| `TurnBubble` renders per keystroke | 0 | 0 |

Two things that settles:

- **The founder's symptom is confirmed and its cause is now removed on the typing path.** Every
  character re-ran the whole ~500-line screen body, which rebuilds the transcript `ReactNode[]` and
  reconciles the unmemoized route card *and its native `MapView`*. That is why it got worse with
  conversation length. It is now zero renders, which is length-INDEPENDENT.
- **Step 2's `memo()` works, and step 6 is the remaining per-render cost.** `TurnBubble` already
  refused to re-render at 0 per keystroke *before* this change — so the bubbles were never the cost.
  What the screen render was actually paying for is the transcript rebuild (step 5) and the card
  (step 6). Rank those on that basis, not on bubble count.

⚠ Still unmeasured: stream cadence during a turn, and the 2 Hz audio-status tick (step 7) while a clip
plays. Those need a turn in flight and a playing clip respectively.

⚠ Metro is the one dev server that may be freely stopped and started for this (root `CLAUDE.md`,
founder 2026-08-03), and kill the expo-dev-client floating FAB first or it will sit over the very
header step 1 changes.

⚠ **Do not drive the simulator with blind coordinates.** Resolve the element first
(`ui_describe_all` / a11y label) and tap its frame centre. A blind tap during this pass landed on
"Make this drive" on a proposal card that had rendered while the agent waited — creating a drive and
consuming a credit, which `delete` does not refund.
