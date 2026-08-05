# Fitting one screen across 375×667 → 440×956

> **Status:** 📚 **RESEARCH — 2026-08-04.** External sources plus what the onboarding build actually
> hit on device. Reference, not a commitment: the decision it feeds is
> [device-support-matrix](../decisions/device-support-matrix.md), and the screen that produced the
> problem is [onboarding-taste-then-where](../designs/onboarding-taste-then-where.md).
> ⚠ **Read §1 first.** The most useful finding is that iOS's own adaptivity primitive cannot see this
> problem at all, which is why there is no "correct Apple way" to look up.

## §1 · Size classes cannot distinguish these devices — the abstraction does not reach

**Every iPhone in portrait is compact-width × regular-height.** That is the whole point of the
abstraction: it groups devices by *kind of space*, not amount. A 375×667 SE and a 440×956 Pro Max are
the same size class, so a layout branching on size classes cannot tell them apart. (Plus/Max models
differ only in LANDSCAPE, where they become regular-width.)

**Consequence:** any per-device behaviour must read ACTUAL dimensions. There is no first-class,
Apple-blessed hook for "this phone is short" the way there is for "this is an iPad". Reading
dimensions is not a hack here, it is the only available mechanism.

## §2 · The scarce axis is HEIGHT, and nearly all responsive advice is about WIDTH

Percentage widths, flex rows, column breakpoints, `max-width` — the standard toolkit is horizontal.
Phones vary in BOTH, but the axis that actually breaks a single-screen layout is vertical: 667 → 956 is
a 43% swing in height, and unlike width there is no wrapping or reflow to absorb it.

⚠ **This is exactly how the onboarding screen broke.** The postcard used `aspectRatio: 3/2` at full
width — a rule that derives HEIGHT from WIDTH. A narrow phone is also a short phone, so the widest
demand for vertical space landed on the device with the least of it, and 846pt of content went into a
667pt viewport with the primary CTA below the fold.

**Rule that falls out:** size a flexible element against the axis that is scarce. Ours now scales off
window height, capped at the old natural size and floored so it stays a picture.

## §3 · `useWindowDimensions`, never `Dimensions.get()`

The static API computes once, so it misses rotation, iPad split-screen and any later resize; the hook
re-renders on change. This is uncontroversial across every source and is what the app already uses.

## §4 · "Use flex, not fixed" is right — and it has a floor problem nobody mentions

Flex/percentage over fixed dimensions is the universal recommendation, and it is correct. But it is
stated as though it always terminates well, and it does not:

⚠ **Flex distributes SURPLUS. It cannot create space.** Give one element `flex: 1` so it absorbs
whatever is left over, and on a device where nothing is left over it absorbs zero. Built exactly that
way, the postcard shrank to nothing on an SE and the screen became a caption over a play button —
strictly worse than the scroll it was trying to avoid.

Two corollaries worth keeping:

- **A flexing element needs a FLOOR** (`minHeight`), and once the floor binds, the layout needs a
  release valve — a scroll view — or it clips.
- **`flexShrink` does nothing without `minHeight: 0`.** A flex item's implicit minimum is its CONTENT
  size, so a "shrinking" child is still floored at the height of what is inside it: the parent reports
  the small size while the child draws the large one, and it overflows. This cost two builds and
  rendered a lake over a headline.

## §5 · Scale SPACE and MEDIA. Never scale TYPE.

Scaling libraries (`react-native-size-matters` and friends: `scale` / `verticalScale` /
`moderateScale`) are the most-recommended answer and are the wrong tool for type specifically.

⚠ **Device-scaled fonts MULTIPLY with the user's Dynamic Type setting** rather than replacing it. The
rider who enlarged their system text on a small phone gets the device scale-down *and* their own
scale-up fighting each other, and the accessibility sources are consistent that this is where layouts
break. `apps/mobile/DESIGN.md` §8 already commits to uncapped AX sizes on non-driving surfaces, so a
blanket font scaler would contradict a rule this app has already made.

The accessibility guidance that survives is narrower and more useful: **let body text scale freely;
constrain headings and controls.** Which is the same shape as the rule below.

## §6 · The pattern this converges on — three tiers

Not from any single source; it is what §1–§5 leave standing, and it is what the onboarding screen now
does.

| Tier | What | Behaviour |
| --- | --- | --- |
| **Fixed** | Type, controls, tap targets | Natural size on every device. Compressing these is how a layout becomes cramped and illegible — it makes every phone worse to spare one. |
| **Flexible** | Media / decorative hero | Scales off the SCARCE axis, with a cap (never bigger than designed) and a floor (never a stripe). |
| **Release valve** | The shell | A scroll view. Absorbs whatever the floor could not, and covers large Dynamic Type on every device, not just short ones. |

**Adaptive SPACING is the fourth lever, and it is now BUILT** (`app/sample.tsx`, `COMPACT_SCREEN_H`).
Gaps are the largest single consumer on a dense screen — a column with eight children at a 24pt gap
spends ~190pt on nothing — and unlike type, spacing carries no accessibility contract, so it is where
the give is. Below a window-height threshold the screen steps one notch down the EXISTING scale
(`lg`→`md`, `md`→`sm`) rather than inventing numbers.

Measured on the onboarding screen at 375×667: overflow **130pt → ~60pt**. Worth stating plainly that
this did NOT close the gap — the CTA's top edge now sits at the fold instead of well below it, which is
the difference between "there is obviously more" and "the only exit is invisible". Nothing above the
threshold changed at all (a 440×956 Pro Max renders byte-identically), which is the property that makes
the lever safe: it spends nothing on the phones that were already fine.

⚠ **The threshold asks about the WINDOW, not the device** — `windowH < 750` is also true of an iPad
slide-over and a future foldable, and it has to be, because §1 means there is no device question to
ask. Pinning it to a model would be a rule that silently stops applying.

## §7 · Deployment target (asked alongside, parked here so it is not lost)

- **Expo SDK 57 requires iOS 16.4+ and Xcode 26.4+** — which is exactly the app's current
  `ios.deploymentTarget`, so the floor is Expo's, not a choice we made.
- **Adoption (Apple, App Store devices, June 2026):** iOS 26 on 79% of iPhones, iOS 18 on 14% — ~93%
  on the two newest majors.
- **Convention:** support the latest OS plus one prior (N-1); N-2 is considered generous.

⚠ None of this drops a small phone — see the decision record. Raising the target is a maintenance and
API-access decision only, and worth taking on its own terms.

## Sources

- [Apple HIG — Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [A Size Class Reference Guide — useyourloaf](https://useyourloaf.com/blog/size-classes/)
- [Creating adaptive and responsive UIs in React Native — LogRocket](https://blog.logrocket.com/creating-adaptive-responsive-uis-react-native/)
- [Responsive layouts for different screen sizes in React Native (2026)](https://oneuptime.com/blog/post/2026-01-15-react-native-responsive-layouts/view)
- [Dealing With Accessibility Font Sizes in React Native — Ignite Cookbook](https://ignitecookbook.com/docs/recipes/AccessibilityFontSizes/)
- [Conscious styling for larger text — Aviron](https://www.avironsoftware.com/blog/building-more-accessible-react-native-applications-conscious-styling-for-larger-text)
- [Expo SDK reference — platform requirements](https://docs.expo.dev/versions/latest/)
- [iOS version adoption — Business of Apps](https://www.businessofapps.com/data/ios-version-adoption-rates/)
- [When should you raise your iOS deployment target — samwize](https://samwize.com/2022/03/22/when-should-you-raise-your-ios-deployment-target-minimum-version/)
