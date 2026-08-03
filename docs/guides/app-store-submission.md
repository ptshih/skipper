# App Store Connect — the submission cheat-sheet

> **Status:** ✅ **1.1 TEXT METADATA IS ENTERED AND LIVE (2026-08-03).** Pushed with
> `bun run asc:metadata -- --apply --version=1.1.0` and verified by an independent read-back:
> promotional text, description and App Review notes are all the 1.1 copy from §§3/4/10, and the
> version record is now **`1.1.0`, state `PREPARE_FOR_SUBMISSION`**, release type MANUAL.
> ⚠ The §§3/4/10 code blocks are the SOURCE the script extracts (`<!-- asc:… -->` markers) — edit the
> block, re-run the script; never hand-paste, and never delete a marker.
>
> ⚠ **The em-dash sweep re-punctuated §3 and §4, and that IS pushed (2026-08-03, founder go).** No
> em-dashes in anything a rider reads; wording otherwise unchanged. Applied with
> `bun run asc:metadata -- --apply` — no `--version`, because the record was already `1.1.0` and a
> rename flag is scope nobody needed on a live listing. The script's own read-back confirmed both
> fields, and the preview beforehand showed a diff on exactly those two and nothing else.
> Promotional text sits at **168/170**; §10 review notes needed no change (`already matches`).
>
> **What is still owed before submitting** (see [1-1-submission-sweep.md](1-1-submission-sweep.md) for
> the order): §9's screenshots, §8's App Privacy label (no public API — hand entry, and the free-text
> question is a founder call), the two builds, and the on-device passes.
>
> ⚠ **NO BUILD IS ATTACHED, deliberately.** Renaming the record to 1.1.0 left build 15 — short version
> `1.0.0`, the pre-1.1 roam client that 404s against the deployed API — still sitting on it, because
> Apple does not detach a build when the record is renamed underneath it and warns about it nowhere.
> It was detached on 2026-08-03; `asc:metadata` now checks for this every run. Attach the **newest
> 1.1.0 build** once Apple finishes processing it. Submitting a mismatched build ships the wrong app
> under the right number.
>
> ⚠ **1.1.0 reached TestFlight on 2026-08-03 — newest build is `20`.** ⚠ **Do not treat that number
> as stable, and never predict one:** `autoIncrement` burns a number at QUEUE time, so a failure, a
> cancellation or a rebuild each consume one. This release has already spent 17 (failed on a PostHog
> dSYM `content_hash_mismatch`, fixed in `e529dd3`), 18 (cancelled), 19 (superseded hours later) and
> 20. Read the number back from EAS. Until one clears processing and is ATTACHED, TestFlight still
> serves build 16 (`1.0.1`, 2026-07-30), pre-1.1 code calling the deleted `/roam/*`.
>
> **Prior submission state (as of 2026-07-30), kept for the diff.** `1.0.0` was `WAITING_FOR_REVIEW`
> (submitted 2026-07-28T21:42:22Z) with **build 15** attached; **build 16 (`1.0.1`)** is `VALID` in
> TestFlight,
> deliberately NOT attached — swapping the build under a submission in review restarts the queue, so
> 16 ships as the first post-approval update. Everything through §11b is a RECORD of what is on the
> live listing, not a to-do — read it as "what a reviewer sees today", which is no longer what the
> app does. Open work: the 1.1 metadata paste, §9's recapture, and **§13 (after approval)**. Re-read values back
> from ASC rather than trusting this file — it has drifted before (this pass, 2026-07-30, corrected
> the age rating and the §10 notes, both of which were stale enough to do damage if re-pasted).
> §8's privacy label was re-derived from the bundled SDKs'
> own manifests on 2026-07-24 and grew from 9 data types to 12 — paste that table, not an older copy.
> Every field App Store Connect asks for, ready to paste,
> for `fm.skipper.app` (ASC app id `6778946770`, team `L24UJYJ5DK`, Manoa, Inc.). Character-limited
> fields are pre-counted against Apple's caps. ⚠ Screenshots were DONE for 1.0 and are uploaded, but
> **1.1 invalidates half the set** — see §9 before assuming they are reusable.
> ⚠ Do NOT paste the review demo password into this file or
> any committed file; it lives only in App Store Connect.

Why this doc exists: the listing is the one launch surface with no test to fail, so it drifts
silently. Keep it in step with what's actually true — especially the coverage claim, which is the
single most rejection-prone sentence in the whole listing.

---

## 1. App Information (set once, not per-version)

| Field | Value |
|---|---|
| **Name** (30) | `Skipper: Road Trip Audio Tours` — ⚠ `Skipper` alone was TAKEN; this is the live name and it uses all 30 chars, which is right (Name is the most heavily weighted search field) |
| **Subtitle** (30) | `Scenic Drives & Local History` — ⚠ founder-edited in ASC 2026-07-28; see the note below |
| **Primary category** | Travel |
| **Secondary category** | Entertainment |
| **Privacy Policy URL** | `https://skipper.fm/privacy` |
| **Content Rights** | ✅ *Contains third-party content* — see §7 |
| **Age Rating** | **12+** (Brazil 14) — raised from 4+ on 2026-07-30, see §6 |
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

**LIVE on 1.0.0** — still TRUE under 1.1 (it never mentioned roam), so this is the one metadata
field that is not broken. Nothing forces the swap below; take it when convenient.

```
A corny old guide rides shotgun and tells you what happened where, timed to the road, hands-free, honest enough to hush when he doesn't know. Starting in Lake Tahoe.
```

**The 1.1 option — ✅ ENTERED 2026-08-03, this is what is LIVE.** This field is editable without a review, which makes it the
cheapest place to announce the conversation. Still leads with the persona, still closes with the
place, per the rule above:

<!-- asc:promotionalText — scripts/asc-metadata.ts reads the block below. Keep the marker attached to its fence. -->
```
A corny old guide plans your drive from a sentence, then narrates it, timed to the road, hands-free, honest enough to hush when he doesn't know. Starting in Lake Tahoe.
```

---

## 4. Description (4000 max)

> ⚠ **The live description sells a product 1.1 deleted.** "TWO WAYS TO RIDE / Ride Along: free, no
> account, no plan" is the headline 1.1 removes outright, and "No account, no ads" is now simply
> **false** — planning is still account-free, but keeping a drive is not. A wrong factual claim in
> the description is worth more than an awkward one: it is the kind of thing a reviewer checks.
>
> ⚠ **He is TYPED to, not spoken to.** The composer is a text input ("Tell me where to"). Copy that
> implies voice input — "just say", "talk to him", "tell him out loud" — describes a feature that
> does not exist. `apps/site/src/components/sections/Hero.astro` carries the same warning.

### The 1.1 replacement — ✅ **LIVE since 2026-08-03** (written 2026-08-02)

This is live. It leads with the conversation,
because that is what changed and it is what the marketing site now leads with too.

<!-- asc:description — scripts/asc-metadata.ts reads the block below. Keep the marker attached to its fence. -->
```
A corny old tour guide rides shotgun and narrates your drive.

Tell Skipper where you're headed, in your own words. He plans the drive (the route, the stops, and a story for each one), then rides along and tells them, timed to the road, so the tale about the bay lands while you can still see the bay.

Mount your phone and go. He starts himself at every stop, so you never touch the screen.

He's a ham. He will pun. He is also, underneath it, telling you the truth: every story is grounded in real, cited sources, and when the record is thin he says so and lets the view do the talking. A skipper who doesn't know is better than a skipper who invents.

RIGHT NOW: LAKE TAHOE ONLY
Every story is researched and recorded for a specific place, and the finished collection covers Lake Tahoe. Ask him for a road he doesn't know and he'll tell you so, honestly and in character. More regions are the plan, but we'd rather ship one place done properly than a nationwide map of nothing much.

PLANNING IS A CONVERSATION, NOT A FORM
No dropdowns, no pins to drag. Tell him "Tahoe City down to South Lake Tahoe, and I've got about two hours" and he'll lay out the route and what's on it. Change your mind (longer, shorter, take the west shore instead) and he'll redo it.

HEAR IT BEFORE YOU COMMIT
When he's drawn up a drive, he'll play you the first stop on that road: a real clip from your actual route, not a generic demo. No account needed to get that far.

HONEST ABOUT THE MONEY
Planning is free and needs no account. Keeping a drive (saved, downloaded, ready to go) takes a free account and spends one of your free credits, because building one does real work. No subscription, nothing to buy inside the app, and we never sell your data.

BUILT FOR AN ACTUAL CAR
Audio-first, so it works from a mount or over Bluetooth with your eyes on the road. Lock-screen controls. Nothing to look at, nothing to tap.

WORKS WHERE THE SIGNAL DOESN'T
Mountain roads have real dead zones. Download a drive before you go and the whole thing plays from your phone. No bars required.

RE-HEAR ANYTHING
Missed a line to a passing truck? Tap once to hear that stop again. Scrub, skip back fifteen seconds, pause. It's your drive.

WHERE THE STORIES COME FROM
Skipper's facts are grounded in public sources, including Wikipedia (CC BY-SA). Every stop's source is a tap away in the app, and the full list lives under Settings.

A note on the driving: Skipper is meant to be heard, not watched. Mount your phone, start the drive, and keep your eyes where they belong. No story is worth it.
```

**What changed and why**, so this isn't re-litigated at paste time:

- **TWO WAYS TO RIDE → one way.** Roam is gone; the drive is the only rider artifact. The section is
  replaced by PLANNING IS A CONVERSATION, which is the actual new capability.
- **"No account, no ads, and it plays offline" is cut from the lede.** It was true when riding along
  was the free front door. Now the account line has to be precise about *where* the wall is, and
  burying that in a lede claim is how you earn a 2.3.1 complaint.
- **HEAR IT BEFORE YOU COMMIT is new**, and it is the strongest thing in the listing: an anonymous
  rider gets a real clip from their own proposed route before any wall. Worth its own beat.
- **The money beat keeps its position and its competitive edge** (§structure notes below) — it just
  no longer claims unlimited free riding, which would be false.
- **Kept verbatim:** the opening line, the ham/truth paragraph, Tahoe-only, car, offline, re-hear,
  sources, and the driving note. They were never about roam and they still test well.
- ⚠ **No credit NUMBER anywhere.** The free allotment lives in `apps/api/src/credits.ts` + env and a
  grant freezes at signup; printing a count here would drift silently and be unfixable without a
  review. "one of your free credits" is deliberate.

### LIVE on the 1.0.0 listing — the record, not a target

⚠ This is what is on ASC right now. Do not paste it; it is here so a future reader can diff.

```
A corny old tour guide rides shotgun and narrates your drive.

Skipper watches the road go by and tells you what happened there: the shipwreck under the water you're looking at, the hotel that burned down twice, the man who built a castle nobody asked for. Stories arrive timed to the road, so the tale about the bay lands while you can still see the bay.

No account, no ads, and it plays offline. Mount your phone, start it, and drive.

He's a ham. He will pun. He is also, underneath it, telling you the truth: every story is grounded in real, cited sources, and when the record is thin he says so and lets the view do the talking. A skipper who doesn't know is better than a skipper who invents.

RIGHT NOW: LAKE TAHOE ONLY
Every story is researched and recorded for a specific place, and the finished collection covers Lake Tahoe. Outside that basin, Skipper will tell you honestly that he doesn't know these roads yet. More regions are the plan, but we'd rather ship one place done properly than a nationwide map of nothing much.

TWO WAYS TO RIDE
Ride Along: free, no account, no plan. Just start it and drive. Whenever you come near something with a story, the Skipper speaks up. Wander at will; he'll find you.

Create a Drive: pick a start and an end, and Skipper lays out the good stuff along the way, in order, paced to the drive. Save it, download it, take it with you.

HONEST ABOUT THE MONEY
Riding along is free and unlimited. Creating a drive spends one of your free credits, because building one does real work. No subscription, nothing to buy inside the app, and we never sell your data.

BUILT FOR AN ACTUAL CAR
Audio-first, so it works from a mount or over Bluetooth with your eyes on the road. Lock-screen controls. Nothing to look at, nothing to tap.

WORKS WHERE THE SIGNAL DOESN'T
Mountain roads have real dead zones. Download a drive before you go and the whole thing plays from your phone. No bars required.

RE-HEAR ANYTHING
Missed a line to a passing truck? Tap once to hear that stop again. Scrub, skip back fifteen seconds, pause. It's your drive.

WHERE THE STORIES COME FROM
Skipper's facts are grounded in public sources, including Wikipedia (CC BY-SA). Every stop's source is a tap away in the app, and the full list lives under Settings.

A note on the driving: Skipper is meant to be heard, not watched. Mount your phone, start the drive, and keep your eyes where they belong. No story is worth it.
```

---

**Structure notes (2026-07-28), grounded in what Autio and Shaka Guide actually publish:**

- **Money stays, and sits high** — right under TWO WAYS TO RIDE, because it explains the credit that
  Create a Drive spends. Autio puts pricing in its FIRST paragraph; the top review complaint in this
  category is "I thought it was free." Ours is the opposite of Autio's story (riding along really is
  free, no subscription), so this is a competitive claim against the market leader, not a disclaimer.
- **A privacy/data section was CUT.** Neither competitor has one sentence about data — checked their
  full live descriptions. It cost ~300 chars, half of it was nutrition-label content ("your name,
  email and saved drives are tied to your account"), and the App Privacy label now does that job in a
  structured, Apple-enforced form that prose cannot match. Volunteering a privacy defence to a reader
  who had not raised the worry tends to create it. The one persuasive clause, "we never sell your
  data", was folded into the money beat.
- ⚠ **Do not take structural cues from Shaka Guide.** Their description is a keyword farm — 47 tour
  names listed at the end, "GPS audio tour" repeated a dozen times. It works because breadth IS their
  product. `docs/research/autio-content-moat.md` calls competing on that grid a trap; copying its
  shape pulls us onto it.

⚠ **Always re-read the LIVE description before editing it** (`GET appStoreVersionLocalizations`).
This file is a record, not the source of truth — the founder edits directly in ASC, and re-pushing a
stale copy from here silently reverts that work.

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
> **Keywords are version-scoped** (same as the subtitle): changing them rides along with a new version
> submission. That is a scheduling detail, NOT a one-way door — updates ship regularly for unrelated
> reasons, and metadata rides free on any of them. The only thing you genuinely cannot do is react to a
> ranking insight the same day.
>
> ⚠ **The subtitle and keywords are COUPLED on geography.** Between them they are the only indexed
> fields; Apple does not index the description. So "Lake Tahoe" must live in exactly one of the two,
> never neither. This was nearly lost on 2026-07-28: the subtitle briefly read `Lake Tahoe Scenic
> Drive Tours` while keywords were rewritten to pure category terms, and taking Tahoe out of the
> subtitle alone would have left it indexed NOWHERE while Tahoe is 100% of the corpus. Whichever field
> you take it out of, put it in the other in the same edit.
>
> ⚠ **Separate every term with a COMMA, never a space.** Apple tokenizes on both, but commas make it
> explicit at identical character cost — `Lake,Tahoe` is the same 10 characters as `Lake Tahoe` and
> removes any dependence on space-tokenization. Apple recombines tokens across name + subtitle +
> keywords to serve multi-word queries, so a bare "Tahoe" search matches the `Tahoe` token and a
> "Lake Tahoe" search is assembled from both. This is also WHY the no-repeats rule exists: repeating a
> word the Name already owns buys nothing, because the tokens are pooled anyway.
>
> The one wrinkle worth remembering: Skipper's content expands SERVER-SIDE, so adding a region needs no
> app release. The moment you most want to refresh geo terms therefore isn't automatically a moment
> you're shipping a build — you either ride the next update or cut one on purpose. Mild, but it's why
> geo terms are worth spending sparingly rather than not at all.
>
> What the competitors do, for calibration: their public copy spends itself on CATEGORY terms
> (`self-guided`, `national parks`, `scenic drives`, `hidden gems`, `location-based`) and names
> specific places only in the DESCRIPTION, which Apple does not index. They can afford that — Shaka has
> 90+ tours, Autio 20,000+ stories. ⚠ Their actual keyword fields are PRIVATE; Apple exposes them
> nowhere, so this is inferred from name/subtitle/description, not read.

```
narrated,sightseeing,GPS,offline,landmark,legend,attraction,itinerary,route,nearby,guide,Lake,Tahoe
```

**1.1 note (2026-08-02): no change required, one term worth a look.** Unlike the description and the
review notes, nothing here is false — these are category terms, and `Lake,Tahoe` must stay (it is
still the only indexed field carrying the geography). The one candidate is **`nearby`**, which was
chosen for roam's proximity model: "what's near me" was literally the product. It now describes
nothing the app does — a rider names a route, and the guide never surfaces anything by proximity to
the phone. Whether that makes it dead weight or just a broad discovery term is a real judgement call
and it costs 7 of 99 characters, so it is left alone rather than swapped on a guess. If it goes,
`conversation` and `itinerary`-adjacent terms are the obvious replacements — but keywords are
version-scoped, so this rides a build either way and there is no hurry.

---

## 6. Age Rating questionnaire → **12+**

⚠ **Raised from 4+ to 12+ on 2026-07-30 (founder call), and that was the deliberate fix — not a
mistake to undo.** The Nevada-side corpus tells the Comstock honestly: Virginia City saloons, and
the legal-brothel history that is genuinely part of that region's story. The choice was *censor the
corpus* or *rate the app for what it actually says*, and the founder kept the clips and moved the
rating. Re-answering these to **None** to get back to 4+ would make the questionnaire false about
shipped content — the exact misdeclaration Apple removes apps for. **Leave these two as INFREQUENT.**

Live declaration, read back from the API 2026-07-30 (only the non-`NONE` answers exist):

| Question (API attribute) | Answer | Why |
|---|---|---|
| `matureOrSuggestiveThemes` | **INFREQUENT** | The Nevada brothel/red-light history on the Comstock. Discussed as history; nothing explicit. |
| `alcoholTobaccoOrDrugUseOrReferences` | **INFREQUENT** | Saloons and the mining-camp drinking culture are referenced, never depicted or encouraged. |
| Cartoon/Fantasy/Realistic Violence | None | Historical stories can mention a shipwreck or a fire; no depiction. |
| Profanity or Crude Humor | None | The persona is corny, not crude — the prompt bans blue material. |
| Horror/Fear Themes | None | |
| Unrestricted Web Access | **No** | There is no in-app browser. Source links hand off to Safari. |
| Gambling | None | Even the Nevada-side stories don't simulate it. |
| Contests | None | |

Two INFREQUENT answers land the store rating at **12+** (`TWELVE_PLUS`), Brazil **14**. ⚠ The 2025
questionnaire mixes BOOLEAN and enum attributes and is bigger than this table — read the live
`ageRatingDeclaration` back rather than assuming the fields above are all of them (§11b).

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
(`apps/api/src/drives.ts`), and endpoints resolve to a curated anchor allowlist — no geocode — so
there is no Search History.

⚠ **1.1 note (2026-08-02) — re-decide this one before pasting the label.** "No free text" was true of
the deleted FROM/TO pickers and is NOT true of the planner: the rider types prose to
`POST /drives/plan`, which reaches our server and Anthropic. The declaration still looks right —
nothing persists it (no `conversations` table; request bodies are never logged), so it is transmitted,
not *collected* — but that is a judgement call on Apple's definition, and it is the founder's to make,
not a docs edit. Deciding it wrong is a rejection-class error.

**Why Precise Location is "Linked" — the nuance, so nobody "corrects" it later.** A saved drive stores
its endpoint coordinates against `user_id`, and Apple counts ≥3 decimal places as *Precise*. So a
linked use exists and Linked = Yes is the honest answer. ⚠ **1.1 note (2026-08-02):** the old second
half of this argument — roam's cookie-less, 3-decimal `GET /roam` call being *genuinely* unlinked —
is gone with the mode, along with the only anonymous location upload the app had. That REMOVES an
unlinked use; it cannot remove the linked one, so the answer does not change.

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

## 9. Screenshots — ⚠ **STALE for 1.1; recapture is its own step**

> **Status 2026-08-02.** The six live assets show a product 1.1 deleted. Of the narrative order
> below: **home is replaced** (the conversation is the home screen now), **the roam encounter shot is
> of a mode that no longer exists**, and **"plan a drive" is the START/END picker** — which is also
> the hero shot, the first thing a browser sees. Map, player and sample survive content-wise.
>
> The 28-second **App Preview video** (§9b) survives too: it shows the sample flow, not roam. ⚠ But it
> bakes the OLD sample audio path, so re-check it plays before relying on it.
>
> **This is not a docs edit — budget it as real work.** A recapture needs a signed Release build
> against production, dark mode, `simctl status_bar`, the branded-frame compositor, and for the video
> `recordVideo` + an ffmpeg audio mux. It also cannot start until 1.1's UI is visually settled, so it
> serializes behind the client work rather than running alongside it.
>
> ⚠ The dark-mode and status-bar traps below still apply. The roam-specific capture instructions
> (drive a real GPS fix to fire an encounter, pull coordinates from `GET /roam`) are **dead** —
> `GET /roam` no longer exists. The 1.1 equivalent for a player shot is a saved drive's live player;
> for the hero, the conversation mid-proposal, which needs no GPS at all and is far easier to stage.

Required slot is **6.9"** at **1320×2868**, which ASC stores under `APP_IPHONE_67`. Apple up-scales for
smaller sizes; **no iPad set needed** (`supportsTablet: false`). Six are uploaded and validated
(`assetDeliveryState=COMPLETE`), in this narrative order: home → roam encounter → plan a drive → drive
player → map → free sample.

Captured from a **signed Release build against production**, then composited into branded frames by
**`scripts/compose-screenshot.ts`** (`bun run shot:compose`), which reads the palette and type from
`apps/site/src/styles/tokens.css`, so the listing matches the landing page.

✅ **The compositor was REBUILT 2026-08-03 and is now in the repo.** It had never been committed —
checked against full git history, not just the working tree — so for the whole 1.0 cycle the six live
assets could not be regenerated by anyone. It renders the REAL design system rather than a copy: the
frame is HTML styled by the site's own tokens and the same `@fontsource` families the landing page
loads, rasterised by headless Chrome at exactly 1320×2868. Two things it learned the hard way, both
now enforced in the script:

- ⚠ **The device art must be CONTAINed, not full-bleed.** A capture is already 1320×2868, so at full
  width it is exactly as tall as the frame and *any* caption pushes its bottom off the canvas. The
  first cut silently ate the composer on a shot captioned "plan it by talking" — the one control the
  caption was about.
- ⚠ **Captions get typographic quotes.** The app and the landing page use `’` everywhere (voice.ts is
  full of them), so a caption typed with a straight `'` sits beside the app's own curly ones *inside
  the same frame*. The script normalises rather than trusting the shell.

⚠ An iPhone 17 Pro Max simulator captures **natively at 1320×2868**, so no resampling is involved;
the script asserts the input size rather than scaling a wrong one up. Two traps if they're ever recaptured:

- **Shoot in dark mode**, and set the status bar with
  `xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100`.
- ⚠ **Use the LIVE player, not `?mode=sim`.** Sim is the easy way to fire a stop from a desk, but it
  renders a **SIMULATED** badge in the UI — not something to ship to App Review. Instead drive a real
  GPS fix through a real trigger point: `xcrun simctl location <udid> start --speed=11 --interval=1.0`
  along CA-89 through Eagle Falls trailhead. Trigger coordinates come from the saved drive's own
  manifest now (roam's `GET /roam` pin list is gone).

⚠ **The dead-band trap, kept because it is about the FRAME, not the screen.** The roam screen it was
found on no longer exists, but any capture whose layout leaves a large flat band reads as a failed
render in a marketing frame. Do NOT restage the app to fill it. The fix is to splice the void shorter,
which is invisible because the band is a single flat colour (`#090E0C`).
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

### Notes — the live text, read back from ASC 2026-07-30

⚠ **This block was REWRITTEN on 2026-07-30 because the version this file used to carry was wrong in
three ways that could each have cost a rejection** — and it sat here under a "paste verbatim" heading,
so re-pasting it would have *re-broken* a listing that was already fixed. What was wrong:

1. It walked the reviewer into a **dead end**: "tap Create a Drive, sign in with the demo account."
   Opening that screen signed-out asks you to make an account first and leaves the pickers greyed
   out. The order matters — sign in from Home FIRST.
2. It promised **"The app lands in Preview and plays each stop's full audio in order (~20 minutes)"**.
   Preview was cut ~8 days before build 15 shipped. The reviewer would have looked for a mode that
   does not exist.
3. It claimed **"no tracking, no analytics"** while the app ships PostHog and the Google Maps SDK —
   contradicting our own App Privacy label (§8). A reviewer who diffs those two rejects the build.

### The 1.1 replacement — ✅ **LIVE since 2026-08-03** (written 2026-08-02)

⚠ **1.1 makes the review path strictly better, and the notes have to say so.** Under 1.0 the only
account-free, permission-free thing a reviewer could do was play one canned sample clip. Under 1.1 a
reviewer at a desk in Cupertino can **plan a real drive and hear a real clip from their own route,
with no account and no location prompt** — the planner, the route proposal and the preview clip are
all anonymous, and the wall lands at "Make this drive". Lead with that.

⚠ Every label below was read out of `apps/mobile/src/ui/voice.ts` and the screens on 2026-08-02.
⚠ **Still requires an on-device pass before submission** — these notes describe a build nobody has
walked through yet (the device verification owed since steps 7-9). A note that walks a reviewer into
a screen that moved is the exact failure the 2026-07-30 rewrite was cleaning up.

<!-- asc:reviewNotes — scripts/asc-metadata.ts reads the block below. Keep the marker attached to its fence. -->
```
Skipper is a hands-free, GPS-triggered audio tour for drivers. You plan a drive by TYPING to the guide in plain language and he lays out the route, the stops, and a story for each one. Three things will help you review it from a desk.

1) COVERAGE IS THE LAKE TAHOE REGION ONLY.
Every story is written and recorded for a specific place, and our finished collection covers Lake Tahoe and the nearby Nevada side (Reno, Carson City, Virginia City). Everywhere else has no content yet, and the guide will say so honestly and in character rather than failing. That is intended behavior. YOUR OWN LOCATION DOES NOT MATTER for anything below: the app does not ask for location permission until you start an actual drive.

2) THE FASTEST REAL LOOK, FROM ANYWHERE: NO ACCOUNT, NO PERMISSION.
Open the app. The guide opens with "Well now - where are we headed?" and a text box reading "Tell me where to". Type:

    Tahoe City down to South Lake Tahoe

He answers and draws it up. You will see the route and its stops under the heading "YOUR DRIVE", and below that a player headed "A TASTE OF THIS ONE" - press play. That is a real narration clip from the first stop on the route you just asked for, about a minute of audio. No sign-in and no location prompt anywhere on this path.

"Make this drive" is where an account becomes necessary; signed out it says "You'll need a free account to keep this drive."

3) ONE-TAP AUDIO IF YOU WOULD RATHER NOT TYPE.
On the opening screen, under the example suggestions, tap "Not near Tahoe? Hear a quick sample." It opens a curated Lake Tahoe narration (Emerald Bay State Park) that begins playing on its own - real audio, about a minute. Also no account and no permission.

FULLER EXPERIENCE (optional) - a complete multi-stop drive, still with no GPS:
  - Tap "Sign in" (top-left) and use the demo account above.
  - The demo account already has a saved drive. Under "MY DRIVES", tap "Tahoe City -> South Lake Tahoe".
  - You land on a screen titled "Drive". Under the heading "THE ROUTE" is the line "Tap a stop to hear it." Tap any stop to play that stop's full narration (about a minute each). It plays one stop at a time and does not auto-advance, so tap the next when you are ready.
  - Please do not tap "Start the drive" from a desk. That is the live, GPS-triggered drive: it waits until you physically reach a stop near Lake Tahoe, so in Cupertino nothing will play. It is also the ONLY place in the app that asks for location.
  - To build one yourself while signed in, repeat step 2 and tap "Make this drive". Each drive you create uses one of the account's free drive credits.

ACCOUNT DELETION (Guideline 5.1.1(v)):
Sign in first, then: Settings (gear, top-right) -> "Delete account" -> type the account password at "Enter your password to confirm" -> "Permanently delete" -> confirm "Delete forever". It permanently deletes the account, its saved drives, and its remaining credits immediately. Nothing is emailed, and it cannot be undone. If you would like the demo account to stay usable for a second pass, you can create a throwaway account first (any email, no verification) and delete that one instead - the flow is identical.

LOCATION USE:
"When In Use" only, and only once you start a drive - planning, the sample and the preview clip never ask. It is used to time narration to your position while driving. There is no background location and no advertising. If you create a drive, its start and end coordinates are saved with that drive on your account. You may also see a one-time "Motion & Fitness" prompt; motion is used only to gauge speed and heading so each stop plays at the right moment. Coarse location and device identifiers are used for app functionality and product analytics (the sign-in session record, PostHog, and the bundled Google Maps SDK), as declared in our App Privacy labels.

Thank you. Happy to help if anything is unclear.
```

**Deliberate choices, so they survive the next edit:**

- **The typing step is spelled out with an exact string to type.** A reviewer who improvises an
  off-corpus route gets the in-persona "don't know that one" and may read it as a broken app. Giving
  them a route that works removes the only way this path fails.
- **"TYPING" is stated in the first sentence.** The composer is a text input; a reviewer expecting
  voice input would file the absence as a bug.
- **No position claim on MY DRIVES.** The 1.0 notes said "at the bottom of Home"; that section moves
  above the fold when offline (`voice.ts` says so explicitly). Naming the heading is stable, naming
  the position is not.
- **Location is addressed three times on purpose** — in the preamble, at "Start the drive", and in
  its own section. 1.1's answer genuinely improved (nothing before the drive asks), and 5.1.1 friction
  is cheaper to prevent than to appeal.

### LIVE on the 1.0.0 record — read back from ASC 2026-07-30

⚠ **This block describes roam and is superseded by the one above.** It is kept because ASC still
serves it: until the 1.1 metadata is entered, this is what a reviewer would actually read. Do not
paste it. Treat it as a mirror of ASC, not a source: if you change one, change both, and read it back.

```
Skipper is a hands-free, GPS-triggered audio tour for drivers. Two things will help you review it from a desk.

1) COVERAGE IS THE LAKE TAHOE REGION ONLY.
Every story is written and recorded for a specific place, and our finished collection covers Lake Tahoe and the nearby Nevada side (Reno, Carson City, Virginia City). Everywhere else has no content yet. In Cupertino, "Ride along" will correctly report that it has no coverage for your area - "I don't know these roads yet, folks. Get me near Lake Tahoe and I've got stories." That is intended behavior, not a failure. Note that "Ride along" first shows a one-time intro card ending in "Got it - let's ride", and then asks for location ("Switch on location", then the iOS When In Use prompt), before it can check your area. The sample in step 2 needs neither.

2) TO HEAR THE APP WITHOUT DRIVING: ONE TAP, NO ACCOUNT, NO PERMISSION.
On the Home screen, under the "Ride along" button, tap "Not near Tahoe? Hear a quick sample." It opens a curated Lake Tahoe narration (Emerald Bay State Park) that starts playing on its own - real audio, about a minute - and then offers "Ride along for real". No sign-in and no location prompt on this path.

FULLER EXPERIENCE (optional) - to hear stops from a complete multi-stop drive, still with no GPS:
  - On Home, tap "Sign in" (top-left) and use the demo account above. Please sign in BEFORE opening "Create a Drive": opening that screen while signed out asks you to create an account first, and the start/end pickers stay greyed out until you go back to Home and re-enter.
  - The demo account already has a saved drive. Under "MY DRIVES" at the bottom of Home, tap "Tahoe City → South Lake Tahoe".
  - You land on a screen titled "Drive". Below the "THE ROUTE" heading is the line "Tap a stop to hear it." Tap any stop to play that stop's full narration (about a minute each, 8 stops). It plays one stop at a time and does not auto-advance, so tap the next stop when you are ready.
  - Please do not tap "Start the drive" from a desk. That is the live, GPS-triggered drive: it waits until you physically reach a stop near Lake Tahoe, so in Cupertino nothing will play.
  - If you would like to build one yourself, then while signed in: "Create a Drive", set START = "Tahoe City" and END = "South Lake Tahoe" (both appear near the top of the picker), then "Plan the drive" and "Make this drive". Each drive you create uses one of the account's free drive credits.

ACCOUNT DELETION (Guideline 5.1.1(v)):
Sign in first, then: Settings (gear, top-right of Home) -> "Delete account" -> type the account password at "Enter your password to confirm" -> "Permanently delete" -> confirm "Delete forever". It permanently deletes the account, its saved drives, and its remaining credits immediately. Nothing is emailed, and it cannot be undone. If you would like the demo account to stay usable for a second pass, you can create a throwaway account first (any email, no verification) and delete that one instead - the flow is identical.

LOCATION USE:
"When In Use" only, used to time narration to your position while driving. There is no background location and no advertising. If you create a drive, its start and end coordinates are saved with that drive on your account. You may also see a one-time "Motion & Fitness" prompt; motion is used only to gauge speed and heading so each stop plays at the right moment. Coarse location and device identifiers are used for app functionality and product analytics (the sign-in session record, PostHog, and the bundled Google Maps SDK), as declared in our App Privacy labels.

Thank you. Happy to help if anything is unclear.
```

**Why this matters more than the rest of the listing:** the corpus is one basin, and the reviewer is
2,000 miles from it. Under 1.0 that was a dead end — the primary button needed Tahoe proximity, and
the rescue was one canned clip. **1.1 changes the shape of the problem, not just the copy:** the
planner is region-scoped rather than proximity-scoped, so a reviewer anywhere can ask for a Tahoe
road and get a genuine route, a genuine stop list, and one genuine clip off it — the actual product,
at a desk, signed out. The `/sample` postcard (`docs/decisions/sample-ride-postcard.md`) is still
there as the zero-typing path. ⚠ What replaced the old failure is a NEW one worth naming: a reviewer
who invents an off-corpus route ("Cupertino to Santa Cruz") gets an in-persona refusal, which is
correct behaviour and can still read as a broken app. That is why §10 hands them a route that works.

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
- ✅ **Age rating → `TWELVE_PLUS`** (Brazil 14) — raised from `FOUR_PLUS` on 2026-07-30; §6 says why,
  and why not to put it back. The 2025 questionnaire is bigger than §6's table and mixes BOOLEAN
  and enum attributes (`healthOrWellnessTopics` is a bool, `ageAssurance` is newly required).
  ⚠ To read it back, use `/v1/appInfos/{appInfoId}/ageRatingDeclaration` — the app-level
  `/v1/apps/{id}/ageRatingDeclaration` relationship **404s** ("does not exist"). The resulting store
  rating shows up as `appStoreAgeRating` on the `appInfos` record itself.
- ✅ **App Review Information** — contact, `review@skipper.fm`, and §10's notes (**3655 chars**,
  rewritten 2026-07-30). ⚠ The 1598-char original this file used to carry was materially wrong; §10
  lists the three defects so nobody "restores" it.
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

⚠ The declaration sits in `state=DRAFT`, and **that is now CONFIRMED to be un-fixable from the API**
(re-tested 2026-08-03): `PATCH /v1/accessibilityDeclarations/{id}` with `state: PUBLISHED` returns
**409 `ENTITY_ERROR.ATTRIBUTE.NOT_ALLOWED` — "The attribute 'state' can not be included in a 'UPDATE'
operation"**. So publishing is a UI action under **App Accessibility**, or it rides the version
submission. Don't re-test it; check the UI. Read it at `/v1/apps/{id}/accessibilityDeclarations`
(app-level, NOT under the version — the version-scoped path 404s).
⚠ The two claims are still TRUE under 1.1 — `theme.test.ts` still asserts 4.5:1 in both themes and the
app still ships real light/dark — so the declaration needs no content change, only publishing.

**Still by hand, and still required:** the App Privacy label (§8) — Apple exposes no public API for it —
and the submission itself.

## 12. Before you hit Submit — cleared for 1.0.0 on 2026-07-28, and REUSABLE

Every item below was verified before the 1.0.0 submission went in. They stay **unchecked on purpose**:
this is the pre-flight for the *next* submission (build 16 / `1.0.1`) as much as it was for the last,
and each one can silently regress between releases — a deploy can take `delete-user` with it, the demo
account can run out of credits, and the coverage sentence rots the day a second region generates.
Re-run the list; don't inherit last release's ticks.

- [ ] The API is deployed with `delete-user` live (a reviewer WILL test deletion — it's the one
      guideline they can check in 30 seconds). Verify: `POST https://api.skipper.fm/api/auth/delete-user`
      returns **anything but 404**. A bare POST with no body answers **400** (measured 2026-07-30); with
      a well-formed body and no session it answers 401. **404 is the only failing answer** — it means
      the route never deployed.
- [ ] `https://skipper.fm/privacy`, `/terms`, `/support` all return 200.
- [ ] **The sample plays in prod:** `GET https://api.skipper.fm/sample` returns 200 with a clip
      (needs `SAMPLE_NARRATION_QID` set + the API deployed). ⚠ **The path changed in 1.1** — this
      item read `/roam/sample` until 2026-08-02, which now 404s on a *healthy* deploy. Probing the
      old path would have reported a working sample as broken, and vice versa.
- [ ] **The planner answers anonymously:** `POST https://api.skipper.fm/drives/plan` returns a turn
      with no session. This is 1.1's primary review path (§10) and it needs `ANTHROPIC_API_KEY` set
      in the deployed service — if it isn't, every reviewer attempt gets the in-persona outage line
      and the app looks broken rather than unconfigured.
- [x] ✅ **The 1.1 metadata is entered in ASC** — pushed 2026-08-03 and re-pushed the same day after
      the em-dash sweep re-punctuated §3 and §4, both times read back independently. Re-verify with a
      no-flag `bun run asc:metadata` (it prints "already matches" for all three) rather than trusting
      this tick — that check is cheap and ASC does not warn when the doc and the listing drift apart.
- [ ] **A build whose short version is `1.1.0` is attached.** The record deliberately has NONE right
      now — see the Status block. ⚠ ASC does not warn about a mismatch; `asc:metadata` does.
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
- [ ] **Set `APP_STORE_URL` in `apps/site/src/appStore.ts`** to
      `https://apps.apple.com/app/id6778946770`. ONE constant, deliberately: it drives BOTH the
      download button (`components/sections/FinalCta.astro`) and the `MobileApplication` JSON-LD
      (`layouts/Base.astro`), which used to be two edits that could silently drift apart. Until it's
      set the page shows a "coming soon" pill and the structured data omits the store link — both
      *correct*, so nothing looks broken and nothing fails a test. This checkbox is the only thing
      that would catch it drifting.
- [ ] **Swap in Apple's badge artwork** in `FinalCta.astro`, replacing the placeholder glyph. Their
      marketing guidelines require the official "Download on the App Store" asset.
- [ ] **Raise the version floor only when you mean it.** `VERSION_POLICIES` ships at a no-op
      `0.0.0`/`0.0.0`. Raising `minimum` is the one hard-break hatch in the API versioning posture
      (`docs/decisions/api-versioning-posture.md`) and walls every older client — a backend deploy,
      never an App Store release.
