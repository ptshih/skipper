# App Store Connect — the submission cheat-sheet

> **Status:** LIVE 2026-07-24, UNSUBMITTED. §8's privacy label was re-derived from the bundled SDKs'
> own manifests on 2026-07-24 and grew from 9 data types to 12 — paste that table, not an older copy.
> Every field App Store Connect asks for, ready to paste,
> for `fm.skipper.app` (ASC app id `6778946770`, team `L24UJYJ5DK`, Manoa, Inc.). Character-limited
> fields are pre-counted against Apple's caps. **Screenshots are the only asset not in here** — they
> must be captured by hand (spec in §9). ⚠ Do NOT paste the review demo password into this file or
> any committed file; it lives only in App Store Connect.

Why this doc exists: the listing is the one launch surface with no test to fail, so it drifts
silently. Keep it in step with what's actually true — especially the coverage claim, which is the
single most rejection-prone sentence in the whole listing.

---

## 1. App Information (set once, not per-version)

| Field | Value |
|---|---|
| **Name** (30) | `Skipper` |
| **Subtitle** (30) | `Narrated audio tours for Tahoe` |
| **Primary category** | Travel |
| **Secondary category** | Entertainment |
| **Privacy Policy URL** | `https://skipper.fm/privacy` |
| **Content Rights** | ✅ *Contains third-party content* — see §7 |
| **Age Rating** | 4+ — see §6 |

**Why Travel / Entertainment, not Navigation:** Skipper gives no turn-by-turn directions and is not a
routing app. Filing it under Navigation invites a reviewer to test it as one and find it wanting.

---

## 2. Version Information (1.0.0)

| Field | Value |
|---|---|
| **Version** | `1.0.0` |
| **Copyright** | `2026 Manoa, Inc.` |
| **Support URL** | `https://skipper.fm/support` |
| **Marketing URL** | `https://skipper.fm` |
| **What's New** | *(first release — leave blank; Apple hides it for 1.0)* |

---

## 3. Promotional Text (170 max)

> Editable any time WITHOUT a new review — the one field you can fix after launch. Use it when
> coverage expands past Tahoe.

```
Lake Tahoe, narrated. A corny old guide rides shotgun and tells you what happened where — timed to the road, hands-free, and honest enough to hush when he doesn't know.
```

---

## 4. Description (4000 max)

```
A corny old tour guide rides shotgun and narrates your drive.

Skipper watches the road go by and tells you what happened there — the shipwreck under the water you're looking at, the hotel that burned down twice, the man who built a castle nobody asked for. Stories arrive timed to the road, so the tale about the bay lands while you can still see the bay.

He's a ham. He will pun. He is also, underneath it, telling you the truth: every story is grounded in real, cited sources, and when the record is thin he says so and lets the view do the talking. A skipper who doesn't know is better than a skipper who invents.

RIGHT NOW: LAKE TAHOE ONLY
Every story is researched and recorded for a specific place, and the finished collection covers Lake Tahoe, California. Outside that basin, Skipper will tell you honestly that he doesn't know these roads yet. More regions are the plan — but we'd rather ship one place done properly than a nationwide map of nothing much.

TWO WAYS TO RIDE

Ride Along — free, no account, no plan. Just start it near Tahoe and drive. Whenever you come near something with a story, the Skipper speaks up. Wander at will; he'll find you.

Create a Drive — pick a start and an end, and Skipper lays out the good stuff along the way, in order, paced to the drive. Save it, download it, take it with you.

BUILT FOR AN ACTUAL CAR
Audio-first, so it works from a mount or over Bluetooth with your eyes on the road. Lock-screen controls. Nothing to look at, nothing to tap. Start it and drive.

WORKS WHERE THE SIGNAL DOESN'T
Tahoe has real dead zones. Download a drive before you go and the whole thing plays from your phone — no bars required.

RE-HEAR ANYTHING
Missed a line to a passing truck? Tap once to hear that stop again. Scrub, skip back fifteen seconds, pause. It's your drive.

HONEST ABOUT THE MONEY
Riding along is free and unlimited. Creating a drive spends one of your free credits, because building one does real work. No subscription. No ads. No account needed to listen.

HONEST ABOUT YOUR DATA
No ads, and we never sell your data. Your precise location is used to time the stories and nothing else — it stays on your phone, and so does the record of what you've heard. We use privacy-friendly analytics (PostHog) to see what's working and catch crashes; it's anonymous and never tied to your account.

WHERE THE STORIES COME FROM
Skipper's facts are grounded in public sources, including Wikipedia (CC BY-SA). Every stop's source is a tap away in the app, and the full list lives under Settings.

A note on the driving: Skipper is meant to be heard, not watched. Mount your phone, start the drive, and keep your eyes where they belong. No story is worth it.
```

---

## 5. Keywords (100 max, comma-separated)

> Do NOT repeat words already in the Name or Subtitle — Apple indexes those separately, and a repeat
> wastes characters that could win a different search.

```
road trip,scenic drive,sightseeing,GPS,travel guide,storytelling,Emerald Bay,offline,roadtrip
```

---

## 6. Age Rating questionnaire → **4+**

Answer **None / No** to everything. The ones worth pausing on:

| Question | Answer | Why |
|---|---|---|
| Cartoon/Fantasy/Realistic Violence | None | Historical stories can mention a shipwreck or a fire; no depiction. |
| Profanity or Crude Humor | None | The persona is corny, not crude — the prompt bans blue material. |
| Horror/Fear Themes | None | |
| Alcohol, Tobacco, Drug Use | None | A story may *mention* a saloon; nothing is depicted or encouraged. |
| Unrestricted Web Access | **No** | There is no in-app browser. Source links hand off to Safari. |
| Gambling | None | Even the Nevada-side stories don't simulate it. |
| Contests | None | |

---

## 7. Content Rights

Answer: **Yes — contains, shows, or accesses third-party content.**

If asked to explain: *"Narration is grounded in public sources, principally Wikipedia, reused under
CC BY-SA 4.0. Attribution is shown in-app — a tap on any stop's ⓘ reveals that clip's specific
source and license — plus a full source list under Settings. Music is used under CC BY 4.0 with credit."*

This is the true answer and CC BY-SA explicitly permits the use, given attribution — which ships.

---

## 8. App Privacy ("nutrition label")

> This is **separate** web data entry; the `PrivacyInfo.xcprivacy` in the binary does not fill it in.
> The label must cover everything **the app AND its bundled third-party SDKs** collect — Apple: "You
> need to identify all of the data you or your third-party partners collect." Under-declaring is a
> rejection; over-declaring is not.

**Tracking:** No. **Third-party advertising:** No. **Data used to track you:** None.
(PostHog is first-party product analytics — not linked to third-party data for ads, not shared with a
data broker — so `NSPrivacyTracking`/"used to track" stays **No**. But its data IS *collected* and must
be declared below.)

**Enter these twelve.** "app" = our own collection; "SDK" = a bundled SDK declares it in its own
manifest, which does not excuse the label from saying it.

| Data type | Linked | Tracking | Purpose | Where it comes from |
|---|---|---|---|---|
| **Precise Location** | **Yes** | No | App Functionality | app — drive endpoints stored per user |
| **Email Address** | Yes | No | App Functionality | app — account |
| **Name** | Yes | No | App Functionality | app — account |
| **User ID** | Yes | No | App Functionality | app — account |
| **Coarse Location** | **Yes** | No | App Functionality, Analytics | app — session IP; + SDK PostHog |
| **Device ID** | **Yes** | No | App Functionality, Analytics | SDK GoogleMaps (linked), PostHog (not) |
| **Product Interaction** | No | No | Analytics | app; + SDK PostHog, GoogleMaps |
| **Crash Data** | No | No | App Functionality, Analytics | app; + SDK PLCrashReporter, GoogleMaps |
| **Other Diagnostic Data** | No | No | App Functionality, Analytics | app; + SDK PLCrashReporter |
| **Performance Data** | No | No | Analytics | SDK GoogleMaps |
| **Other Usage Data** | No | No | Analytics | SDK PostHog |
| **Other Data** | **Yes** | No | Analytics | SDK GoogleMaps (`OtherDataTypes`) |

Everything else — Contacts, Health, Fitness, Financial, Payment Info, Purchases, Browsing History,
Search History, Sensitive Info, Identifiers for advertising, User Content — is **Not Collected**. Two
that look close but genuinely aren't: a drive's `label` is server-generated from its endpoint names
(`apps/api/src/drives.ts`), and the FROM/TO pickers choose from a curated anchor list — no free text
and no geocode — so there is no User Content and no Search History.

**Why Precise Location is "Linked" — the nuance, so nobody "corrects" it later.** Roam coarsens the
fix to 3 decimal places and sends it *without the session cookie*, so that call is genuinely
unlinked. But (a) Apple counts ≥3 decimal places as *Precise*, and (b) a saved drive stores its
endpoint coordinates against `user_id`. So one linked use exists, and Linked = Yes is the honest answer.

**Why Coarse Location is "Linked" too.** Better Auth stores `session.ip_address` and
`session.user_agent` against `user.id` (`packages/db/src/auth-schema.ts`). Apple grants IP no
exemption — "Declare the relevant data types based on how you use IP address, such as precise
location, coarse location, device ID, or diagnostics" — and security/fraud is **not** among the
optional-disclosure exceptions. PostHog's IP-derived city is unlinked, but the session row is linked,
so the aggregate is Yes. (`disableGeoip: true` in `apps/mobile/src/lib/analytics.tsx` would drop
PostHog's half; it would NOT drop the session-row half.)

**Why Device ID is "Linked".** Ours isn't — PostHog gets no `identify()` call anywhere in the app, so
its `distinct_id` stays per-device and anonymous. But the bundled **GoogleMaps** SDK declares Device ID
with `Linked = true` in its own manifest, and the label is the aggregate.

**⚠ The map is GOOGLE Maps, not Apple Maps.** `PROVIDER_GOOGLE` is selected whenever
`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is set, and the `production` EAS profile sets it — so shipped builds
bundle the Google Maps SDK and its collection belongs on the label. Only a keyless build falls back to
Apple Maps.

**The binary manifest does NOT need the SDK rows, and none of this needs a rebuild.** Every bundled SDK
ships its own `PrivacyInfo.xcprivacy` and Xcode aggregates them into the privacy report. Re-check any
time with:

```sh
find ios/Pods -name '*.xcprivacy' -exec plutil -p {} \;
```

As of 2026-07-24 that shows **GoogleMaps** (CrashData, DeviceID *linked*, OtherDataTypes *linked*,
PerformanceData, ProductInteraction), **PostHog** (ProductInteraction, OtherUsageData), and its vendored
**PLCrashReporter** (CrashData, OtherDiagnosticData).

⚠ An earlier version of this section claimed "PostHog ships no `PrivacyInfo.xcprivacy` of its own, so
the app's manifest is the only one Apple sees." That was **wrong** — PostHog ships one. The five PostHog
rows it justified adding to `app.json` are harmless over-declaration, so they stay rather than churn the
manifest again.

So `app.json` declares what the *app itself* collects. Its one genuine correction — Coarse Location
→ `Linked: true`, for the session-IP row — is in the repo but **is not in TestFlight build 15**, which
predates it. That mismatch runs in the safe direction (the binary declares *less* linkage than the
label) and does not justify a build 16; it ships on the next natural rebuild.

---

## 9. Screenshots — the only thing not in this doc

Required: **6.9"** (iPhone 17 Pro Max or sim). Apple up-scales for smaller sizes. **No iPad set
needed** — `supportsTablet: false`.

Capture in **dark mode** — the app is dusk-first and it's the better-looking theme. Suggested five,
in narrative order:

1. **Home** — the hero + "Ride Along" / "Create a Drive".
2. **Roam, mid-encounter** — the sheet up with a real stop title and the transport visible.
3. **Roam map** — pins around the lake (shows the corpus is real and dense).
4. **Drive player** — now-playing card, scrubber, a stop list underneath.
5. **The stop list / route** — the whole drive laid out.

Easiest capture path: run the app in the simulator, use `skipper://roam?mode=sim` to drive the demo
route without moving, and screenshot the encounter as it fires.

---

## 10. App Review Information — **the field that decides this**

**Contact:** Peter Shih · `hello@skipper.fm` · (phone: fill in)

**Sign-in required:** Yes → provide the demo account. ⚠ Put the password in ASC only, never in git.

### Notes — paste verbatim

```
Skipper is a hands-free, GPS-triggered audio tour for drivers. Two things will help you review it from a desk.

1) COVERAGE IS LAKE TAHOE, CALIFORNIA ONLY.
Every story is written and recorded for a specific place, and our finished collection covers Lake Tahoe. This is stated plainly in the App Store description and inside the app. In Cupertino, the "Ride Along" mode will correctly report that it has no coverage for your area — that is intended behavior, not a failure.

2) TO HEAR THE APP WITHOUT DRIVING — ONE TAP, NO ACCOUNT, NO PERMISSION.
On the Home screen, under the "Ride Along" button, tap "Not near Tahoe? Hear a quick sample." It opens a curated Lake Tahoe narration that plays immediately — real audio, about a minute — and then offers "Ride along for real." No sign-in, no location prompt.

FULLER EXPERIENCE (optional): to hear a complete multi-stop drive on a timer (still no GPS), tap "Create a Drive", sign in with the demo account above (or any email — no verification), set START = "Tahoe City" and END = "South Lake Tahoe", then "Plan the drive" → "Make this drive". The app lands in Preview and plays each stop's full audio in order (~20 minutes).

ACCOUNT DELETION (Guideline 5.1.1(v)):
Settings (gear, top-right of Home) → Delete account. It permanently deletes the account, its saved drives, and its credits immediately. Password confirmation is required.

LOCATION USE:
"When In Use" only — used solely to time narration to your position while driving. No background location, no tracking, no analytics, no advertising.

Thank you — happy to help if anything is unclear.
```

**Why this matters more than the rest of the listing:** the app's primary button dead-ends 200 miles
from the only corpus. Verified against production: `/roam` at Apple Park (37.3349, −122.0090) returns
**0 pins**; at Tahoe it returns **337**. The Home "Hear a quick sample" link (→ the `/sample` postcard,
`docs/decisions/sample-ride-postcard.md`) is the deterministic, permission-free path built precisely so
a reviewer — or any first-timer outside Tahoe — hears the Skipper regardless of location, and the former
"I don't know these roads yet" dead-end now carries the same rescue. Point the reviewer at the sample.

---

## 11. Export compliance

Already answered by the binary: `ITSAppUsesNonExemptEncryption: false` in `app.json`. ASC won't ask.

---

## 12. Before you hit Submit

- [ ] The API is deployed with `delete-user` live (a reviewer WILL test deletion — it's the one
      guideline they can check in 30 seconds). Verify: `POST https://api.skipper.fm/api/auth/delete-user`
      returns **401**, not 404.
- [ ] `https://skipper.fm/privacy`, `/terms`, `/support` all return 200.
- [ ] **The sample plays in prod:** `GET https://api.skipper.fm/roam/sample` returns 200 with a clip
      (needs `SAMPLE_NARRATION_QID` set + the API deployed). This is the reviewer's primary path — if
      it 404s, the sample link shows a retry and the review path is broken.
- [ ] The demo account exists, its password is in ASC, and it has credits left to create a drive.
- [ ] Screenshots captured in dark mode (§9).
- [ ] The coverage sentence in the description still matches reality (it says Tahoe only).
