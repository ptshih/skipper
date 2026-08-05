# Which iPhones we design for

> **Status:** ✅ **DECIDED 2026-08-04** (founder). Design against **393×852**, verify at **440×956**
> and **375×667**, portrait iPhone only. The small end must not BREAK; it is allowed to scroll.
> ⚠ Written because the founder's instruction was *"let's drop SE"* and **the SE cannot be dropped** —
> see §1. What was actually decided is what we OPTIMIZE for, which is a different lever.

## §1 · The iPhone SE cannot be excluded, by any setting we control

This is the finding that turns the request into a different decision, so it goes first.

- **Both surviving SE generations run the current OS.** iPhone SE 2nd gen (A13, 2020) and 3rd gen
  (A15, 2022) are on Apple's iOS 26 compatibility list — the cutoff is A13, which drops the XR/XS
  family and nothing newer. So raising `ios.deploymentTarget` (currently `16.4`, in
  `apps/mobile/ios/Podfile`) to the newest OS available would still leave both SEs installing the app.
- **iOS has no screen-size exclusion.** `UIRequiredDeviceCapabilities` gates on hardware facts —
  `arm64`, `camera-flash`, `gps`, `telephony` — and carries no display-dimension key. There is no
  supported way to tell the App Store "not this size".

**Therefore 375×667 is in scope permanently**, whatever we set. The only real question is whether we
DESIGN for it, and that is what §2 answers.

⚠ Raising the deployment target is still a *separate* option with its own merits (fewer OS versions to
reason about, newer APIs available). It is deliberately NOT taken here, because it does not achieve the
thing it was reached for and every dependency bump in this repo has a story — see CLAUDE.md on TS 7,
where a green `tsc --noEmit` hid a broken `expo prebuild`. Reopen it on its own terms, not as a proxy
for dropping a device.

## §2 · The decision

| Role | Size | What it means |
| --- | --- | --- |
| **Reference** | 393×852 (iPhone 16/17) | What gets DESIGNED and measured first. The volume device and the middle of the range. |
| **Upper check** | 440×956 (17 Pro Max) | Nothing floats in a sea of paper; no layout that only works when space is plentiful. |
| **Lower check** | 375×667 (SE 3rd gen) | Must not BREAK — no clipped control, no unreachable action, no zero-height hero. **Allowed to scroll.** |

Those three bracket every iPhone in service: pass both edges and the middle is safe by inclusion.
Portrait only, and no iPad — the drive player assumes a phone in a mount.

**"Must not break" is the whole content of the lower bound.** It is not "must look the same". The
onboarding screen scrolls ~70pt on an SE and that is an accepted outcome, not a defect to file.

## §3 · What this cost, and the trap inside it

The rule was written after building the onboarding screen (`onboarding-taste-then-where.md`), which is
the densest screen in the app — masthead, postcard, transport, region picker, CTA — and therefore the
one that found the edge.

⚠ **"Fit it to the screen" is not automatically the right answer at the small end, and the failure is
counter-intuitive.** A flex-to-fit layout was built so the postcard would absorb whatever space was
left over. On a 375×667 SE there is none: with every other element at its natural size the picture
shrank to ZERO and the screen became a caption over a play button. **Deleting the hero is a worse
outcome than a scroll.** So the postcard sizes off screen HEIGHT (a fraction, capped and floored) and
scrolling remains the release valve.

⚠ The same reasoning is why the lower bound is a check rather than a target. Optimising *for* 667pt
means compressing type and controls that are already at their designed size, which makes every phone
worse to spare one.

## §4 · What would change this

- **A driving surface that cannot work at 667pt.** Glanceability in a car is safety-adjacent, not
  taste, so a control that is unreadable at the small end is a real problem rather than an accepted
  degradation. Nothing in the player hits this today.
- **Evidence nobody is on one.** There is no analytics dimension for screen size today; if one is ever
  added and the small end is empty, the lower check becomes ceremony and can be dropped.
- **Apple shipping a screen-size entitlement**, which would make §1 false. Unlikely, worth naming.
