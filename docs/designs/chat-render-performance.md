# The chat screen bogs down as the conversation grows

> **Status:** ✅ **BUILT (2026-08-03).** Steps 1–**6** are LANDED and **measured on the simulator**;
> **step 7 was measured and judged NOT justified** — see its entry, which records the numbers rather
> than deferring it again. Step 8 (virtualization) remains a founder decision, deliberately UNMADE,
> and the measurements below are the evidence it should be taken on. Founder report: *"the chat ux is
> lagging/bogging down after multiple messages are sent, this is a performance issue"*, with a pointer
> to their own prior solution in `/Users/ptshih/code/manoa/archive/mobile`.

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
   only in the offline branch. **`Ridgeline` — the remainder of this step — is now LANDED too**:
   `memo()` plus a `useMemo` over the geometry, so it renders once per mount instead of re-solving
   seven `hypot`/`atan2` pairs on every screen render (twice a second while a clip plays). Every prop
   at its one call site is a literal, so the comparator is exact. ⚠ It does NOT freeze against a theme
   change — `useTheme` is a context read, and React re-renders a memoized component when a consumed
   context changes. **Both-themes visual pass done** (day and dusk, identical ridge, correct repaint).
4. **Let the Composer own its own draft text.** ✅ LANDED, and **measured: 1 full `HomeScreen` render
   per keystroke → 0.** Manoa match: `ChatInput` owns its own `text`. `ComposerProps.onSend` now takes
   the text as an argument and the field clears itself; the screen never sees the draft until send.
   ⚠ The region-switch clear is a **remount**, keyed on a NEW state ordinal `composerSeq` — *not* on
   `convSeq.current` as this plan originally said. A `key` is read during render and `convSeq` is a
   ref, which is `react-hooks/refs` ("Cannot access refs during render"); `app/index.tsx` already
   baselines exactly ONE of those in `eslint-suppressions.json`, and that file is a backlog to burn
   down, not somewhere to add a second. It is also not `resetSeq`, which additionally schedules the
   autofocus a region switch must *not* fire. Three ordinals, three different effects.
5. **Memoize the transcript; bucket cards by `afterTurn`.** ✅ LANDED, and **measured: every bubble
   rebuild now corresponds to a real transcript mutation, none to an incidental render.**
   ⚠ **NOT the "structural fingerprint" this plan originally called for, and that turned out to be the
   wrong shape.** The transcript is a heterogeneous interleave of bubbles (which read only the
   conversation) and cards (which additionally read live audio state at 2 Hz). A single memo over the
   whole thing would need a fingerprint covering everything a CARD reads, so it would bust on every
   audio tick anyway — the fingerprint would buy nothing. What works is splitting by *what each row
   depends on*: `bubbles` is a `useMemo` on `[turns, conversationSeq, lastSkipperIdx, sending,
   focused]`, and the interleave that places cards around it stays unmemoized (it only copies existing
   element references into an array — cheap; allocating the elements was the cost).
   ⚠ `turns` BY IDENTITY is the correct dep, not a content fingerprint: every write goes through
   `setTurns` with a fresh array, so identity already changes exactly when a bubble's text does.
   ⚠ The bubble keys moved from `convSeq.current` to the `conversationSeq` STATE ordinal, which
   **burned down this file's one `react-hooks/refs` suppression** (pruned from
   `eslint-suppressions.json`) rather than adding a second.
   ⚠ `proposeKey`/`undrawnRoute` is genuinely NOT the bottleneck (`cards` is 1–3) — the O(turns×cards)
   nested scan was fixed in passing because this is the pass that reads it, not because it was slow.
6. **Extract a memoized `TranscriptCard`.** ✅ LANDED, and **measured: card renders during 20 s of clip
   playback went from ~50 (one per screen render) to 1** — the one legitimate render, when play state
   flipped. `src/ui/TranscriptCard.tsx`; the plan's warning was right, `memo()` on `PreviewCard` alone
   could never have bitten. ⚠ The trap the plan did not name: `preview.play` is itself a NEW function
   every 500 ms (its dep chain runs through a `toggle` that reads `status.currentTime`), so passing it
   through would have busted the memo at exactly the tick rate the memo exists to absorb. The screen
   passes a stable wrapper over a ref instead. ⚠ `PreviewItem` moved into that file — `src/ui` may not
   import from `app/`, and it is the card's own contract.
   **Also memoized `Composer` in the same pass**, for the same tick: nothing in it depends on playback,
   yet it — a controlled `TextInput` the rider may be mid-sentence in — was re-rendered 2×/sec while a
   clip played. Its `onFocus`/`onBlur` had to become `useCallback`s or the comparator does nothing.
7. **Move the 2 Hz audio-status subscription off the screen root.** ❌ **MEASURED AND NOT JUSTIFIED —
   do not build this without new evidence.** It is real: the screen does still re-render twice a second
   for the whole of a clip. But after steps 1–6 those renders produce **0 bubble rebuilds, 0 card
   renders, 0 composer renders**, and the header options were already memoized in step 1 — every
   expensive child bails out. The 500 ms intervals were also rock-steady under measurement
   (500/500/499/500/501 ms), which is not what a struggling JS thread looks like. The remaining cost is
   executing the screen body and reconciling a tree that bails out, against a refactor with a real
   hazard: ⚠ the provider must sit INSIDE the screen (D35 exclusive audio focus assumes exactly one
   owner). ⚠ And do NOT take the cheap alternative of widening `updateInterval` — `status.currentTime`
   feeds the stall detector and the `atEnd` check, so that is a behaviour change to clip-end handling.
   Revisit only if a real device shows jank during playback that steps 1–6 did not remove.

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

### Step 5, same method (counter inside the `bubbles` memo, plus a dep-diff logger)

| observation | result |
|---|---|
| HomeScreen renders after launch, before any turn | **10 renders → 0 bubble rebuilds** |
| one full turn (send → stream → settle) | **3 renders → 2 rebuilds**, both necessary |
| what busted the memo, every time | `turns` (+`lastSkipperIdx`/`sending`) — i.e. a real mutation |

The dep-diff logger is the part worth repeating: printing WHICH dep changed, rather than just that the
memo re-ran, is what showed every rebuild was earned. The two rebuilds in a turn are the rider's line
appending and the reply landing; there is no third.

⚠ **The card interleave was verified visually, not just by counter** — a drawn route card lands in its
correct slot immediately after the skipper turn that offered it. Worth re-doing on any change to the
bucketing, because a mis-slotted card is silent: the transcript still renders, just wrong.

### Step 6 + the step 7 decision — the audio tick, measured

This is the measurement that justified step 6 and killed step 7, so it is the one to re-run first if
any of this is ever doubted. Play a card's preview clip and count for 20 s.

| during 20 s of clip playback | before step 6 | after step 6 |
|---|---|---|
| `HomeScreen` renders | ~50 (2.0/sec, 500 ms gaps dead on) | ~50 — **unchanged, and that is fine** |
| `TranscriptCard` renders | ~50 (one per screen render) | **1** (the play-state flip) |
| `TurnBubble` rebuilds | 0 (step 5) | 0 |
| `Composer` renders | ~50 | 0 |

⚠ **The screen render count is deliberately unchanged** — that was step 7's job, and step 7 is the one
we chose not to do. What changed is that those renders now cost almost nothing, because everything
underneath bails out. Read the table as "the tick still fires, and nothing listens".

### The whole arc, in the two numbers the founder actually reported

| | before | after |
|---|---|---|
| screen renders per keystroke | 1 (grows with conversation) | **0** |
| card renders per second of playback | ~2.5 | **~0.05** |

⚠ Still unmeasured, and honestly so: nothing here was measured on a REAL DEVICE, only the simulator,
which has no thermal or memory pressure. And no measurement covers a conversation past ~8 turns —
the structural ceiling (step 8) is still a ceiling; these steps lowered the cost of each render rather
than bounding how many rows exist.

⚠ Metro is the one dev server that may be freely stopped and started for this (root `CLAUDE.md`,
founder 2026-08-03), and kill the expo-dev-client floating FAB first or it will sit over the very
header step 1 changes.

⚠ **Do not drive the simulator with blind coordinates.** Resolve the element first
(`ui_describe_all` / a11y label) and tap its frame centre. A blind tap during this pass landed on
"Make this drive" on a proposal card that had rendered while the agent waited — creating a drive and
consuming a credit, which `delete` does not refund.
