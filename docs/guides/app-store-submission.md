# App Store Connect — the submission cheat-sheet

> **Status:** LIVE 2026-07-28, UNSUBMITTED — but MOSTLY ENTERED already; read §11b before typing
> anything into ASC, and re-read the values back rather than trusting this file.
> §8's privacy label was re-derived from the bundled SDKs'
> own manifests on 2026-07-24 and grew from 9 data types to 12 — paste that table, not an older copy.
> §13 (added 2026-07-27) holds the work that can only be done AFTER approval — don't submit and forget it.
> Every field App Store Connect asks for, ready to paste,
> for `fm.skipper.app` (ASC app id `6778946770`, team `L24UJYJ5DK`, Manoa, Inc.). Character-limited
> fields are pre-counted against Apple's caps. Screenshots are DONE and uploaded (§9) — they
> no longer need capturing by hand. ⚠ Do NOT paste the review demo password into this file or
> any committed file; it lives only in App Store Connect.

Why this doc exists: the listing is the one launch surface with no test to fail, so it drifts
silently. Keep it in step with what's actually true — especially the coverage claim, which is the
single most rejection-prone sentence in the whole listing.

---

## 1. App Information (set once, not per-version)

| Field | Value |
|---|---|
| **Name** (30) | `Skipper: Road Trip Audio Tours` — ⚠ `Skipper` alone was TAKEN; this is the live name and it uses all 30 chars, which is right (Name is the most heavily weighted search field) |
| **Subtitle** (30) | `Scenic Drives & Local History` — ⚠ deliberately GEOGRAPHY-FREE, see below |
| **Primary category** | Travel |
| **Secondary category** | Entertainment |
| **Privacy Policy URL** | `https://skipper.fm/privacy` |
| **Content Rights** | ✅ *Contains third-party content* — see §7 |
| **Age Rating** | 4+ — see §6 |
| **Availability** | **United States only** — founder call 2026-07-24, see below |

**Why Travel / Entertainment, not Navigation:** Skipper gives no turn-by-turn directions and is not a
routing app. Filing it under Navigation invites a reviewer to test it as one and find it wanting.

**Why the subtitle names NO place (founder call 2026-07-28).** The subtitle is VERSION-LOCKED — once
live, changing it needs a new version submission — so pinning the second-most-weighted search field to
Tahoe would nail it to the one thing guaranteed to change. Geography belongs in **Promotional Text**
(§3), which is editable with no review and already opens "Lake Tahoe, narrated." The competitors split
exactly this way: Autio runs `Culture & History Guide` (geography-free, scales to every road they add),
while Shaka Guide runs `Hawaii & National Park Travel` — affordable only because Hawaii IS their
permanent identity, not a starting point. We're Autio's case.

⚠ **Name and subtitle must share NO words** — Apple indexes them separately, so a repeat is wasted
allowance in the two highest-weighted fields. Both competitors obey this. The Name owns
*skipper / road / trip / audio / tours*; the Subtitle owns *scenic / drives / local / history*. An
earlier subtitle (`Narrated audio tours for Tahoe`) repeated "audio tours" from the Name — don't
reintroduce that.

Coverage honesty is NOT weakened by a place-free subtitle: it lives where it does the work — the
description's "RIGHT NOW: LAKE TAHOE ONLY", the §10 reviewer notes, and the app itself. Omitting Tahoe
claims nothing false.

**Why United States only.** Availability defaults to *all* territories, and shipping to the EU/UK pulls
in GDPR whole — legal basis, data-subject rights, international-transfer disclosure — none of which the
privacy policy carries, and none of which a size threshold exempts you from (unlike CCPA). EU consumer
law would also override the Nevada choice of law in the terms, and GDPR Art. 8 turns the single
"13 or older" line into a per-member-state matrix of 13–16. The corpus is one California lake, so the
entire surface buys nothing today. **Uncheck everything but the United States** — one setting, and the
GDPR question closes. Revisit only when a region outside the US is actually worth generating.

**Canada was considered and DECLINED (2026-07-28).** Briefly reversed the same day and then backed out
again, so don't read the one-territory listing as an oversight, and don't re-open it casually.

The case AGAINST, which carried: Canada is not the free adjacency it looks like. **Quebec Law 25** is
the closest thing to GDPR in North America (designated privacy officer, breach reporting, consent
handling, data portability; penalties to CAD $25M or 4% of worldwide turnover), **PIPEDA** applies
federally, and **Bill 96** raises a French-language question for consumer contracts of adhesion —
awkward for an English-only policy attached to a product that IS an English-language performance.
Apple availability is country-level, so **Quebec cannot be excluded**; it arrives with Canada. Our
policy carries a Nevada section and nothing for Canada.

⚠ **Keep the case FOR, because it's the strongest one and it isn't obvious.** App Store availability
follows the account's **STOREFRONT, not the phone's location**. So this was never really a
market-expansion question — a Canadian-storefront visitor driving Tahoe cannot install the app *at
all*, even though the corpus serves them perfectly. US-only silently excludes a user we already built
for. That argument doesn't expire; only the legal work stands between it and shipping.

Revisit when either side moves: counsel adds a Canada section while reviewing the Nevada redline
(cheapest, since that engagement is already queued), or Canadian content exists.

⚠ Availability is NOT version-locked — unlike the subtitle, it can be changed any time, post-launch,
with no review. So this decision costs nothing to defer and nothing to reverse.

---

## 2. Version Information (1.0.0)

| Field | Value |
|---|---|
| **Version** | `1.0.0` |
| **Copyright** | `2026 Manoa, Inc.` |
| **Support URL** | `https://skipper.fm/support` |
| **Marketing URL** | `https://skipper.fm` |
| **What's New** | *(first release — leave blank; Apple hides it for 1.0)* |
| **Release type** | **MANUAL** — ⚠ not the default, see below |

**Copyright format:** year of first publication + rights holder, and **no © symbol** — Apple renders
that itself. `2026 Manoa, Inc.`, not `© 2026 Manoa, Inc.` The field is REQUIRED; a version can't be
submitted with it empty (ours was `null` until 2026-07-28).

**Why MANUAL release.** ASC defaults to `AFTER_APPROVAL` — the app goes live the instant Apple
approves, which is frequently overnight. That is the exact scenario §13 exists to prevent:
`apps.apple.com/app/id6778946770` 404s until release, and the site's download button is deliberately a
"coming soon" pill until it has both the real URL and Apple's badge artwork. On automatic release the
app appears in the Store while skipper.fm still says it isn't out, and any link already shared stays
dead until someone notices and deploys. Manual makes approval a notification instead of an event, so
the listing and the site flip together. Editable until submission and while awaiting review.

---

## 3. Promotional Text (170 max)

> Editable any time WITHOUT a new review — the one field you can fix after launch, and therefore the
> right home for whatever is only true *right now*. Update it when coverage expands past Tahoe.
>
> ⚠ **Lead with the persona, close with the place.** Being the correct FIELD for geography doesn't
> license leading with it. This used to open "Lake Tahoe, narrated." — the first line a browser reads,
> framing the app as a Tahoe product before the hook lands. Tahoe is the starting point, not the
> pitch, so it now closes the line as "Starting in Lake Tahoe." Same rule as the subtitle and the
> screenshot captions: mention the launch region, never pin the product to it.

```
A corny old guide rides shotgun and tells you what happened where, timed to the road, hands-free, honest enough to hush when he doesn't know. Starting in Lake Tahoe.
```

---

## 4. Description (4000 max)

```
A corny old tour guide rides shotgun and narrates your drive.

Skipper watches the road go by and tells you what happened there: the shipwreck under the water you're looking at, the hotel that burned down twice, the man who built a castle nobody asked for. Stories arrive timed to the road, so the tale about the bay lands while you can still see the bay.

He's a ham. He will pun. He is also, underneath it, telling you the truth: every story is grounded in real, cited sources, and when the record is thin he says so and lets the view do the talking. A skipper who doesn't know is better than a skipper who invents.

RIGHT NOW: LAKE TAHOE ONLY
Every story is researched and recorded for a specific place, and the finished collection covers Lake Tahoe, California. Outside that basin, Skipper will tell you honestly that he doesn't know these roads yet. More regions are the plan, but we'd rather ship one place done properly than a nationwide map of nothing much.

TWO WAYS TO RIDE

Ride Along: free, no account, no plan. Just start it and drive. Whenever you come near something with a story, the Skipper speaks up. Wander at will; he'll find you.

Create a Drive: pick a start and an end, and Skipper lays out the good stuff along the way, in order, paced to the drive. Save it, download it, take it with you.

BUILT FOR AN ACTUAL CAR
Audio-first, so it works from a mount or over Bluetooth with your eyes on the road. Lock-screen controls. Nothing to look at, nothing to tap. Start it and drive.

WORKS WHERE THE SIGNAL DOESN'T
Mountain roads have real dead zones. Download a drive before you go and the whole thing plays from your phone. No bars required.

RE-HEAR ANYTHING
Missed a line to a passing truck? Tap once to hear that stop again. Scrub, skip back fifteen seconds, pause. It's your drive.

HONEST ABOUT THE MONEY
Riding along is free and unlimited. Creating a drive spends one of your free credits, because building one does real work. No subscription. No ads. No account needed to listen.

HONEST ABOUT YOUR DATA
No ads, and we never sell your data. Your precise location is used to time the stories and nothing else. It stays on your phone, and so does the record of what you've heard. We use privacy-friendly analytics (PostHog) to see what's working and catch crashes; it's anonymous and never tied to your account.

WHERE THE STORIES COME FROM
Skipper's facts are grounded in public sources, including Wikipedia (CC BY-SA). Every stop's source is a tap away in the app, and the full list lives under Settings.

A note on the driving: Skipper is meant to be heard, not watched. Mount your phone, start the drive, and keep your eyes where they belong. No story is worth it.
```

---

## 5. Keywords (100 max, comma-separated)

> Do NOT repeat words already in the Name or Subtitle — Apple indexes those separately, and a repeat
> wastes characters that could win a different search. Reworked 2026-07-28 when the Name turned out to
> be `Skipper: Road Trip Audio Tours` (not bare `Skipper`) and the Subtitle went geography-free:
> `road trip` and `scenic drive` became duplicates and were dropped, freeing ~23 chars.
>
> ⚠ **`Lake Tahoe` MUST stay here.** Once the subtitle stopped naming Tahoe, keywords became the ONLY
> indexed field carrying it — the description is NOT indexed by Apple, so "we say Tahoe in the
> description" does not win the Tahoe search. `Emerald Bay` does not substitute; nobody searches it.
> `roadtrip` (no space) is kept on purpose: Apple tokenizes it distinctly from the Name's "Road Trip".
>
> ⚠ **Keywords are VERSION-LOCKED** (same as the subtitle) — changing them needs a new version
> submission. That bites harder here than for most apps, because Skipper's content expands
> SERVER-SIDE: a new region ships without an app release, so a geo-heavy keyword field goes stale with
> no natural moment to fix it. Hence exactly ONE place term, not two — `Emerald Bay` was dropped
> 2026-07-28 (one cove, near-zero volume, 11 chars). `Lake Tahoe` stays only because it is currently
> 100% of the corpus and the highest-intent query available; retire it the first time a second region
> ships alongside a version bump.
>
> What the competitors do, for calibration: their public copy spends itself on CATEGORY terms
> (`self-guided`, `national parks`, `scenic drives`, `hidden gems`, `location-based`) and names
> specific places only in the DESCRIPTION, which Apple does not index. They can afford that — Shaka has
> 90+ tours, Autio 20,000+ stories. ⚠ Their actual keyword fields are PRIVATE; Apple exposes them
> nowhere, so this is inferred from name/subtitle/description, not read.

```
sightseeing,GPS,travel guide,storytelling,offline,roadtrip,Lake Tahoe,landmarks,legends,self-guided
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

## 9. Screenshots — DONE (six uploaded 2026-07-28)

Required slot is **6.9"** at **1320×2868**, which ASC stores under `APP_IPHONE_67`. Apple up-scales for
smaller sizes; **no iPad set needed** (`supportsTablet: false`). Six are uploaded and validated
(`assetDeliveryState=COMPLETE`), in this narrative order: home → roam encounter → plan a drive → drive
player → map → free sample.

Captured from a **signed Release build against production**, then composited into branded frames by a
script that reads the palette and type from `apps/site/src/styles/tokens.css`, so the listing matches
the landing page. Two traps if they're ever recaptured:

- **Shoot in dark mode**, and set the status bar with
  `xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100`.
- ⚠ **Use LIVE roam, not `?mode=sim`.** Sim mode is the easy way to fire an encounter from a desk, but
  it renders a **SIMULATED** badge in the UI — not something to ship to App Review. Instead drive a real
  GPS fix through a real trigger point: `xcrun simctl location <udid> start --speed=11 --interval=1.0`
  along CA-89 through Eagle Falls trailhead. Pull actual trigger coordinates from `GET /roam`.

⚠ **The roam screen has a large empty band when the map is toggled OFF** — about 40% of the frame.
It's the real layout, but in a marketing frame it reads as a failed render. Do NOT restage it: the map
is a REPLACEMENT view, not a background, so there is no "story over map" screen to capture. The fix is
to splice the void shorter, which is invisible because the band is a single flat colour (`#090E0C`).
Verified seam rows with `ffmpeg -vf crop=1320:1:0:<y>` piped to `xxd` — cut only where a row is one
colour edge to edge, or a sliver of the progress-bar car marker bleeds in and looks like a glitch:

```sh
ffmpeg -i shot.png -filter_complex \
  "[0:v]crop=1320:700:0:0[t];[0:v]crop=1320:1308:0:1560[b];[t][b]vstack=inputs=2[o]" -map "[o]" tight.png
```

## 9b. App Preview video — UPLOADED 2026-07-28

One 28s preview at `IPHONE_67`, 1320×2868, H.264 30fps, AAC stereo. Apple validated it
(`assetDeliveryState=COMPLETE`). It is the highest-leverage asset on the page for an audio-first app,
because it's the only one that can carry the Skipper's VOICE — screenshots structurally cannot.

Content is the sample flow, chosen because it's deterministic and needs no GPS: home → one tap →
the illustrated postcard playing Emerald Bay. How it was made, since it isn't obvious:

⚠ **`simctl recordVideo` captures NO audio.** A silent preview of a narration app is close to
pointless, so the real clip is muxed in afterwards — the exact `/roam/sample` m4a the app is playing on
screen, delayed to match the moment playback starts:

```sh
xcrun simctl io <udid> recordVideo --codec h264 --force raw.mov     # tap through while it records
ffmpeg -ss 2.5 -t 28 -i raw.mov -i sample.m4a \
  -filter_complex "[1:a]adelay=3000:all=1,apad,aformat=channel_layouts=stereo[a]" \
  -map 0:v -map "[a]" -t 28 -r 30 -c:v libx264 -pix_fmt yuv420p -crf 20 \
  -c:a aac -b:a 160k -ar 44100 -ac 2 -movflags +faststart preview.mov
```

Find the sync point by extracting frames (`ffmpeg -ss <t> -frames:v 1`) and reading the player's own
elapsed-time counter — audio 0:00 lands where the counter starts. Apple's window is 15–30s; this sits
at 28.

⚠ **CAPTION POLICY — don't pin the product to Tahoe** (founder call 2026-07-28). Screenshots are the
surface people actually look at, so the same rule as the subtitle applies: Tahoe is where we START, not
what we ARE. Exactly ONE caption names the place, and it says **"Starting in Lake Tahoe"** — on the map
shot, where the image already shows the lake so the claim is self-evidently honest. An earlier set led
with a bare `Lake Tahoe` kicker on the HERO shot and captioned the map "One lake, done properly"; both
read as a permanent identity rather than a first region. Mentioning the launch location is fine.
Framing the app as a Tahoe app is not.

---

## 10. App Review Information — **the field that decides this**

**Contact:** Peter Shih · `hello@skipper.fm` · **(725) 777-5875**

**Entity, for the ASC fields that ask:** Manoa, Inc., a Delaware corporation, 1810 E Sahara Ave
STE 75994, Las Vegas, NV 89104, USA. ⚠ Not California — both legal pages said so until 2026-07-24.

**Sign-in required:** Yes → the demo account is **`review@skipper.fm`** (name "App Review"), created
2026-07-28, balance verified 10/10 through the live API.

⚠ The PASSWORD goes in App Store Connect and nowhere else — never in git, never in this file. But the
ADDRESS belongs here, and its absence already cost us once: a 2026-07-24 session created
`appreview@skipper.fm` and recorded neither the address nor the password anywhere, so by 2026-07-28
nobody knew which of the two production accounts was the reviewer's, and its password was
unrecoverable (reset mail lands in the skipper.fm catch-all, which does NOT forward to the founder's
Gmail — verified). Recording the address is what makes the password recoverable later.

The stale `appreview@skipper.fm` was deleted directly in the DB on 2026-07-28 (its `credit_entries`,
sessions and `account` row went with it — those are soft refs with no cascade, so they had to be
removed explicitly). Production now holds exactly two accounts: the founder's and this one.

If the password is ever lost again: don't hunt for it. Sign up a fresh account (email/password, no
verification) and it arrives with a full balance — the free allotment is granted **at signup** since
2026-07-28 (`docs/decisions/credit-ledger.md`). Costs nothing, and no `GET /drives` warm-up is needed
the way it was under the old lazy grant.

### Notes — paste verbatim

```
Skipper is a hands-free, GPS-triggered audio tour for drivers. Two things will help you review it from a desk.

1) COVERAGE IS LAKE TAHOE, CALIFORNIA ONLY.
Every story is written and recorded for a specific place, and our finished collection covers Lake Tahoe. This is stated plainly in the App Store description and inside the app. In Cupertino, the "Ride Along" mode will correctly report that it has no coverage for your area. That is intended behavior, not a failure.

2) TO HEAR THE APP WITHOUT DRIVING: ONE TAP, NO ACCOUNT, NO PERMISSION.
On the Home screen, under the "Ride Along" button, tap "Not near Tahoe? Hear a quick sample." It opens a curated Lake Tahoe narration that plays immediately (real audio, about a minute) and then offers "Ride along for real." No sign-in, no location prompt.

FULLER EXPERIENCE (optional): to hear a complete multi-stop drive on a timer (still no GPS), tap "Create a Drive", sign in with the demo account above (or any email; no verification), set START = "Tahoe City" and END = "South Lake Tahoe", then "Plan the drive" → "Make this drive". The app lands in Preview and plays each stop's full audio in order (~20 minutes).

ACCOUNT DELETION (Guideline 5.1.1(v)):
Settings (gear, top-right of Home) → Delete account. It permanently deletes the account, its saved drives, and its credits immediately. Password confirmation is required.

LOCATION USE:
"When In Use" only, used solely to time narration to your position while driving. No background location, no tracking, no analytics, no advertising.

Thank you. Happy to help if anything is unclear.
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

## 11b. What is ALREADY ENTERED (done 2026-07-28 via the ASC API, not by hand)

Most of this doc has been applied to the live record already — it is a reference now, not a to-do.
The ASC API key in `.env.development` (`ASC_KEY_ID`/`ASC_ISSUER_ID` + `keys/AuthKey_<ID>.p8`) has
**write** access, so §§2–5, §6, §10 and Availability were set programmatically and verified by reading
them back. Re-run those reads before trusting this list.

- ✅ **Version `1.0.0`, build 15 attached.** ⚠ The record said `1.0` while build 15's short version is
  `1.0.0`; Apple only offers builds whose version string MATCHES, so the build picker was silently
  empty. If a build ever "isn't there", check this first.
- ✅ Description (2700/4000), keywords (93/100), promo text (168/170), support + marketing URLs.
- ✅ **Age rating → `FOUR_PLUS`.** The 2025 questionnaire is bigger than §6's table and mixes BOOLEAN
  and enum attributes (`healthOrWellnessTopics` is a bool, `ageAssurance` is newly required).
- ✅ **App Review Information** — contact, `review@skipper.fm`, and §10's notes (1598 chars).
- ✅ **Availability = UNITED STATES ONLY**, verified by paging all 175 territories: exactly one
  available. `availableInNewTerritories=false`, so it will not silently expand later. ⚠ The v2 API
  demands EVERY territory be enumerated inline with `${local-id}` ids — you cannot just send USA.
- ✅ Six screenshots at `APP_IPHONE_67` (1320×2868 is accepted there), all `assetDeliveryState=COMPLETE`.

**Accessibility Nutrition Labels — declared 2026-07-28, currently DRAFT.** Voluntary today, but Apple
says it becomes mandatory over time, and it is NOT neutral to skip: the product page shows an
Accessibility section either way, and an absent declaration renders as "hasn't indicated support."

Only TWO features are claimed, both evidence-backed:
- **Sufficient Contrast** — `apps/mobile/src/theme/theme.test.ts` asserts 4.5:1 for every text role on
  both surfaces in BOTH themes, executable under `bun test`.
- **Dark Interface** — real light/dark themes, `userInterfaceStyle: automatic`.

The other seven are declared **false on purpose**. VoiceOver and Larger Text are the ones worth
upgrading — the app already carries accessibility labels on its controls, and Apple's bar is
"can a user COMPLETE COMMON TASKS", which needs a real pass with VoiceOver on and text at 200% before
it can be claimed honestly. Under-claiming is correctable; over-claiming misleads exactly the people
who depend on the label.

⚠ **Captions is the interesting one.** It reads as inapplicable to an audio app, but it's the opposite:
a narration-only product is unusable to a deaf rider, and **the script text is already stored on
`narrations`** — the data to caption every stop exists today, unshipped. That's a real feature with the
hard part done, not an accessibility chore. Revisit it as product work, not compliance.

⚠ The declaration sits in `state=DRAFT`. The ASC API refuses `state` on an update
(`can not be included in a 'UPDATE' operation`), so publishing is either a UI action under
**App Accessibility** or happens with the version submission — unverified. Check the UI before relying
on it appearing.

**Still by hand, and still required:** the App Privacy label (§8) — Apple exposes no public API for it —
and the submission itself.

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
- [ ] **Availability is United States ONLY** (§1). It defaults to every territory — if this ships wide,
      you have taken on GDPR without a policy that answers it. Check this last; it is one click and it
      is the single cheapest legal decision on the list.

## 13. After approval — the store link goes live

Apple assigns the app id when the RECORD is created, so `6778946770` has been real since long before
submission — but `apps.apple.com/app/id6778946770` **404s until the release is actually approved**
(confirmed 2026-07-27, while the build was TestFlight-only). That gap is why these two are split:
one is safe to set early, one is not.

- **Already done — no action.** `apps/api/src/version-policy.ts` carries the real link now. Safe
  ahead of the listing because the client only opens it when the version floor is raised, which can't
  happen before there's a published version to upgrade to.
- [ ] **Flip the site's download button.** `apps/site/src/components/sections/FinalCta.astro` — set
      `APP_STORE_URL` (the value is in the comment beside it) and swap the placeholder glyph for
      Apple's official "Download on the App Store" badge artwork, which their marketing guidelines
      require. Until then the page shows a "coming soon" pill, which is *correct*, so nothing looks
      broken and nothing fails — the only thing that would catch this drifting is this checkbox.
- [ ] **Raise the version floor only when you mean it.** `VERSION_POLICIES` ships at a no-op
      `0.0.0`/`0.0.0`. Raising `minimum` is the one hard-break hatch in the API versioning posture
      (`docs/decisions/api-versioning-posture.md`) and walls every older client — a backend deploy,
      never an App Store release.
