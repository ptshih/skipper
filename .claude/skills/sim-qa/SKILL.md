---
name: sim-qa
description: Use to verify mobile changes on the iOS simulator — works out which screens a diff touches, drives them, screenshots, and reports what it actually observed. For "test the app", "does this screen work", "QA the mobile change", "check it in the simulator".
---

# Sim QA

Diff-aware verification of `apps/mobile` against the iOS simulator. The phone
player is the bet; this exists so verifying it is not always a human reading
`docs/guides/device-verification-runbook.md` by hand.

## Iron Law

**Report only what you observed.** Never write "works" for a screen you did not
reach, and never infer a pass from a screenshot you did not look at. A QA report
that overclaims is worse than no QA, because it retires a risk that is still live.

## What a simulator CANNOT prove

State this in every report. These are not skippable steps — they are outside the
tool's reach, and quietly omitting them turns "8 of 8 checks passed" into a lie:

| Runbook section | Why the simulator can't |
|---|---|
| §7 real GPS, outdoors, in motion | No real fix, no speed, no heading. The trigger core is speed-adaptive; a stationary sim proves none of it. |
| §8 offline / airplane mode | Simulator network control is not the device's radio state. |
| §1 splash & app icon | Native, and only after a fresh build — hot reload never shows it. |
| Audio behaviour | Exclusive focus (`doNotMix`), lock-screen Now Playing, and interruption handling are device concerns. The sim will happily play and prove nothing. |

For the parts a simulator *can* reach, the runbook's §0–§6 are the reference for
what "correct" looks like. Read the relevant section before driving the screen —
it carries the acceptance criteria, and re-deriving them from the UI is how a
regression gets called a feature.

## Phase 1: Scope from the diff

```bash
git diff --stat main...HEAD -- apps/mobile
git diff --name-only -- apps/mobile
```

Map changed files to screens. The routes are `apps/mobile/app/`:

| Changed | Exercise |
|---|---|
| `app/index.tsx` | the cold open / home |
| `app/sample.tsx` | the ungated sample ride |
| `app/sign-in.tsx`, `src/ui/AccountGate.tsx` | the gate — both anonymous and signed-in |
| `app/drives/*` | drive detail and the player |
| `app/settings.tsx`, `legal.tsx`, `developer.tsx` | those screens |
| `src/ui/*` | **every screen that imports it** — grep for the component name, do not guess |

A change to a shared component is the one that gets under-tested. If the diff
touches `src/ui/`, list the importing screens explicitly in the report and say
which you actually reached.

## Phase 2: Get a build running

⚠ **Do not boot or restart dev servers** — the human keeps them running. Check
before starting anything:

```bash
lsof -nP -iTCP:8081 -sTCP:LISTEN
```

Then, via the `ios-simulator` MCP: `get_booted_sim_id` (or `open_simulator` if
none), then `launch_app`. Only rebuild (`expo run:ios`) when the change is
native — a config plugin, a new dependency, an app config change. A JS-only
change reloads; rebuilding wastes minutes.

⚠ A brand-new `app/*.tsx` route breaks typecheck until `.expo/types/router.d.ts`
regenerates. If typecheck is red on a route file, that is the cause, not your change.

## Phase 3: Drive it

**Drive by accessibility label.** There are no `testID`s in this codebase — but
there are ~65 `accessibilityLabel`s, and the simulator's UI tools read the
accessibility tree. So `ui_find_element` on a label is the reliable handle.

- Prefer `ui_find_element` → `ui_tap` on the returned element.
- `ui_describe_all` first when you do not know what is on screen.
- **Coordinate taps are a last resort** and must be flagged in the report as
  brittle — they break on any layout change and they silently tap the wrong
  thing rather than failing.
- If a control you need has no label, that is itself a finding: it is also
  invisible to VoiceOver. Report it as an accessibility gap, not just a QA
  inconvenience.

Screenshot **before and after** every interaction that should change state. A
screenshot after only proves the end state, not that your tap caused it.

For anything needing motion, use the drive simulator (`bun run sim`) rather than
pretending the sim has GPS — and say in the report that the fix source was
simulated.

## Phase 4: Look at the screenshots

Actually read them. For each, check against the runbook's criteria for that
section, plus:

- Is the intended change visibly present?
- Is anything clipped, overlapping, or off-screen?
- Empty and loading states — not just the happy path.
- Does it match Trailhead 89, or did a raw colour or hand-rolled style creep in?
  (`apps/mobile` has `lint:tokens` for this — run `bun run check` there.)

## Phase 5: Report

```
Sim QA — <N> screens, simulator <device/iOS>

Scope: <files changed> → <screens exercised>

PASS
  <screen> — <what you did> → <what you saw>   [screenshot]

FAIL
  <screen> — expected <runbook §X criterion>, saw <observed>   [screenshot]
  Repro: <exact steps>

NOT VERIFIABLE HERE
  §7 real GPS in motion — needs the bike/drive pass
  §8 airplane-mode offline — needs a device
  Audio focus / Now Playing — needs a device

Coordinate taps used: <none | list — brittle, will break on layout change>
mobile check: PASS (exit 0)
```

If you found a bug, do **not** fix it in the same pass. Report it, and let the
human decide whether to fix now or file it — a QA run that edits code as it goes
loses the ability to say which observation preceded which change.
