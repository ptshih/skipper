# App Store Connect — the submission cheat-sheet

> **Status:** ⚠ **1.1.0 IS `REJECTED` AGAIN (2026-08-17) — Guideline 2.1, round TWO: "unable to sign
> in" with the demo account.** The credentials are **VALID** — the exact pair Apple quoted signs in
> against production, re-verified the same day — and the server logs show the reviewer **never
> reached the password screen**: they tapped the primary "Send me a code" CTA, landed on the
> number-pad code step (which has no password option), failed one code attempt and stopped, ~90
> seconds into the review. **§15 is the record; §15d is the FIX (founder go, 2026-08-17): the
> emailed code is now FIXED for the demo account** (`reviewFixedOtp`, server-only, works with build
> 25 — the reviewer's natural "Send me a code" tap now succeeds with a code held in ASC and env,
> never git). ✅ **EVERYTHING IS DONE AND VERIFIED EXCEPT ONE CLICK (2026-08-17):** the fixed code
> is deployed + verified on prod; the reply (§15b, OTP-only) is SENT with the code-step screenshot;
> §10's notes are REWRITTEN (terse, code-first, `{{REVIEW_OTP_CODE}}` substitution) and PUSHED with
> read-back; ASC's demo "password" field shows the CODE; and the account's password row is REMOVED
> (§15d) so deletion keys on the same code. ⚠ A reply alone did not requeue — observed twice now —
> **the remaining step is the founder clicking "Resubmit to App Review".**
>
> Prior status (kept for the diff): ✅ 1.1.0 was back in review — `WAITING_FOR_REVIEW` since
> 2026-08-14T07:16:27Z — after
> a Guideline 2.1 "Information Needed" round. Nothing in the app failed: Apple's new-app
> questionnaire asks for seven things, and only item 1 — **a screen recording on a physical device** —
> was real work. Both are done and **§14 is the record**: the recording (captured, verified, 4.5 MB)
> and the reply (3901/4000, sent).
>
> ⚠ **A Resolution Center reply did not requeue the app by itself — "Resubmit to App Review" did.**
> Observed: the reply went in, and both states sat unchanged at submission `UNRESOLVED_ISSUES` /
> version `READY_FOR_REVIEW`; one click later, both read `WAITING_FOR_REVIEW`. ⚠ **Do not read that as
> "a reply can never get you reviewed"** — the re-read was minutes after the reply, not a review
> cycle, so a reviewer picking the thread up unprompted was never ruled out. What it does establish is
> the ASYMMETRY, and that is the part to act on: resubmitting costs at most queue position, while not
> resubmitting risks the app sitting OUT of the queue looking answered, with nothing in ASC saying so.
> A `READY_FOR_REVIEW` version is *submittable*, not *submitted*. ✅ **Resubmitting reused submission
> `445ea909` rather than opening a new one**, so the Resolution Center thread stays attached, and
> **build 25 rode through untouched** with release type still MANUAL — which is what makes the click
> cheap enough to be the default.
>
> ⚠ **The VERSION-level state is the one that drifts** — it read `REJECTED`, then
> `READY_FOR_REVIEW`, on two read-only passes twelve minutes apart (the founder was clicking around
> ASC). The SUBMISSION state is the honest signal every time.
>
> ⚠ **Reply, don't resubmit.** Build 25 stays attached and `apps/mobile` has not moved since
> `98a292db` (verified: zero commits touch it), so every string §10 and §14 quote is still the app
> under review. A new build would re-open §9's screenshots and §10's notes for nothing.
>
> Prior status: submitted `WAITING_FOR_REVIEW` 2026-08-06T20:11:36Z.
> Review submission `445ea909`, build **25** (`98a292db`). Release type stays **MANUAL**, so approval
> lands in *Pending Developer Release* and the real Tahoe drive can still happen before launch — that
> asymmetry is what made [1-1-submission-sweep.md](1-1-submission-sweep.md) §0's trade affordable.
>
> **What went in:** build 25 · App Review notes 3935/4000 · six recaptured screenshots · a re-shot
> 28 s App Preview · description 2565 · promo 168 · keywords 99 · US-only · 12+ · copyright set.
> Every one read back from the API after writing, never trusted from a 200.
>
> ⚠ **The App Privacy label went in UNCHANGED from 1.0, on an explicit founder call (2026-08-06):
> the planner's free text is TRANSMITTED, not COLLECTED.** The reasoning: nothing persists it — there
> is no `conversations` table and request bodies are never logged — so Anthropic receives it as a
> processor. It is a judgement on Apple's definition and the founder made it knowingly. ⚠ **There is
> no public API for this label** (`appPrivacyDetails`, `appDataUsages` and `appDataUsagesPublishState`
> all 404 with "relationship does not exist"), so it can be neither verified nor changed from here —
> if review comes back on it, that is the field to look at, by hand.
>
> **Still open, and neither blocks review:** the accessibility declaration is `DRAFT` and publishing is
> a UI action; and the demo account's password could not be tested from here — since 08-05 a reviewer
> reaches it only via **"Use a password instead"**.
>
> **On approval, do §13** — it is the only remaining checklist and it is what makes the store link work.
>
> ---
>
> **Prior status (kept for the diff):** ✅ **1.1 TEXT METADATA IS ENTERED AND LIVE (2026-08-03).** Pushed with
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
> ✅ **BUILD `25` IS ATTACHED (2026-08-06)** — id `9ece8ba8`, `processingState=VALID`, not expired,
> `usesNonExemptEncryption=false` (so §11's export-compliance question is already answered and ASC will
> not ask). Read back from the relationship after the PATCH rather than trusting the 204.
> ⚠ **25 is the commit `98a292db` that §9's screenshots and §10's notes were BOTH verified against.**
> That three-way coupling is the thing this listing keeps losing: swapping in a later build silently
> re-opens every quoted UI string and every captured screen.
> ⚠ The history, because it cost real time: renaming the record to 1.1.0 left build 15 — short version
> `1.0.0`, the pre-1.1 roam client that 404s against the deployed API — still sitting on it, because
> Apple does not detach a build when the record is renamed underneath it and warns about it nowhere.
> It was detached on 2026-08-03; `asc:metadata` checks for this every run.
>
> ⚠ **Newest build as of 2026-08-06 is `25`, BUILDING off `98a292db` (HEAD); `24` finished 08-05.**
> ⚠ **Do not treat that number as stable, and never predict one:** `autoIncrement` burns a number at
> QUEUE time, so a failure, a cancellation or a rebuild each consume one. This release has already
> spent 17 (failed on a PostHog dSYM `content_hash_mismatch`, fixed in `e529dd3`), 18 (cancelled),
> 19, 20, and 21–25 across three more days of client work. Read the number back from EAS
> (`npx eas-cli build:list --platform ios --limit 3`, from `apps/mobile`). Until one clears processing
> and is ATTACHED, TestFlight still serves build 16 (`1.0.1`, 2026-07-30), pre-1.1 code calling the
> deleted `/roam/*`.
>
> ✅ **THE 2026-08-06 PASS FIXED §10's REVIEWER NOTES (six defects, three of them dead ends) AND THE
> SCREENSHOTS, AND BOTH ARE NOW LIVE.** The notes' sample step pointed at a deleted screen, "tap a stop
> to hear it" returned an error line unless the drive was downloaded first, and sign-in had become an
> emailed code a reviewer cannot receive. All six are corrected, pushed, and verified against
> `appStoreReviewDetail` directly (3978/4000) — §10 carries the list. The six screenshots showing
> deleted product were replaced the same day (§9).
> ⚠ **Both were pushed against build `25` (`98a292db`)**, the commit their quoted strings and captured
> screens were verified on. **Attaching a later build re-opens both** — that coupling is the thing this
> listing keeps losing.
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

✅ **RE-DERIVED 2026-08-06 — the twelve are still COMPLETE and correct; do not redo this.** Two things
happened after the 07-24 derivation that each look like they should add a row, and neither does:

- **Email OTP (08-05) added no data type.** Sign-in codes and password resets go out through
  **Resend**, so a rider's address reaches a new sub-processor — but *Email Address* is already
  declared (Linked, App Functionality), and a transactional processor handling an address you already
  collect adds no new type. It IS a change to `skipper.fm/privacy`, which named only the reset mail
  and was corrected the same day.
- **No new collecting SDK shipped.** `apps/mobile/package.json` diffed against `1aeb813f` (the commit
  that derived this table) shows only patch bumps plus `@expo/react-native-action-sheet` and
  `react-native-svg` — a native sheet wrapper and a drawing library, neither of which collects
  anything or ships a `PrivacyInfo.xcprivacy` row that would land here.

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

## 9. Screenshots — ✅ **RECAPTURED 2026-08-06; six frames are built and NOT yet uploaded**

> **The new set lives in `.scratch/store-screenshots-1.1/`** (gitignored, so it survives but is not
> committed — PNGs do not belong in the tree). All six are 1320×2868, captured on a booted **iPhone 17
> Pro Max** simulator running HEAD's JS over Metro, dark mode, `simctl status_bar` at 9:41 with a full
> non-charging battery, then composited by `bun run shot:compose`.
>
> | # | file | kicker / caption | screen |
> |---|---|---|---|
> | 1 | `1-plan.png` | PLAN IT BY TALKING · *Tell him where you're headed, in your own words.* | cold open: poster, "Where are we headed?", the five example rows |
> | 2 | `2-proposal.png` | HEAR IT FIRST · *He draws up the drive and plays you a real stop from it.* | the drawn route card + "A TASTE OF THIS ONE" + "Make this drive" |
> | 3 | `3-stories.png` | TOLD ON THE ROAD · *A story for every stop, timed to the drive.* | saved drive, NOW PLAYING dock with the scrubber running |
> | 4 | `4-map.png` | *Starting in Lake Tahoe.* | the route on the map with all ten stop pins |
> | 5 | `5-handsfree.png` | EYES ON THE ROAD · *He starts himself at every stop. Nothing to tap.* | READY TO ROLL |
> | 6 | `6-offline.png` | NO BARS REQUIRED · *Load it up first and the whole drive plays offline.* | the download gate, unsaved, with its size label |
>
> ⚠ **Exactly ONE caption names the place** — #4, per §9b's policy. Kept deliberately.
>
> ⚠ **THE LIVE-GPS PLAYER SHOT COULD NOT BE STAGED, and the reason is documented rather than a
> failure.** Shot 3 is the drive-detail mini-preview, not a GPS-triggered stop. A real `simctl location`
> run along this drive's own polyline (59 waypoints at 20 m/s into a 329 m trigger) moved the car marker
> but fired **nothing** — "Looking for the satellites" persisted and the counter stayed 0/10. That is
> exactly [1-1-submission-sweep.md](1-1-submission-sweep.md) §0's prediction: `accuracyOk`
> (`packages/engine/src/fix-mapper.ts`) rejects the iOS **-1** sentinel outright, and with speed
> sanitized to 0 the ceiling collapses to its floor, so every simulated fix is dropped. **Do NOT "fix"
> the trigger engine over this** — it is a simulator artifact, and §0 says so.
> ⚠ The other route to a rolling player is SIM mode, which **renders a `SIM` tag and a "SIMULATED
> DRIVE" block** (`app/drives/[id]/play.tsx`) — the exact thing this section has always said must never
> ship to App Review.
>
> ⚠ **The simulator had SIMULATED GPS left ON** (persisted, admin-gated, Settings ▸ Developer). It was
> switched back to **Real GPS**, which is the resting state the sweep guide requires. Worth knowing
> because it is silent: a drive started with it on is simulated and records no trace.
>
> ✅ **UPLOADED 2026-08-06 and LIVE.** The six 1.0 assets were deleted and these six put in their
> place at `APP_IPHONE_67`, order pinned to the filename order above. Apple validated all six:
> `assetDeliveryState=COMPLETE`, 1320×2868, no errors.
> ⚠ **The replaced 1.0 assets are backed up in `.scratch/asc-backup-1.0-screenshots/`** — ASC keeps no
> copy once deleted, and one of them (`02-encounter.png`) is the only surviving render of the roam
> screen. Apple caps an iPhone set at 10, so the old six had to be deleted BEFORE the new six could be
> uploaded; that ordering is why the backup was taken first rather than as an afterthought.
> ✅ **§9b's App Preview video was re-shot the same day and is also live** — 28 s of the reviewer path
> ending on the taste clip actually playing. It was NOT covered by this stills recapture (a video is
> its own asset and its own step), which is exactly why it nearly shipped showing a deleted screen.

## 9a. The original 1.1 recapture brief — ⚠ **kept for its traps, superseded by the block above**

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

## 9b. App Preview video — ✅ **RE-SHOT AND REPLACED 2026-08-06**

One 28s preview at `IPHONE_67`, 1320×2868, H.264 30fps, AAC stereo 44.1k. Apple validated it
(`assetDeliveryState=COMPLETE`). It is the highest-leverage asset on the page for an audio-first app,
because it's the only one that can carry the Skipper's VOICE — screenshots structurally cannot.

**The 1.1 content is the reviewer path, not the old sample.** Cold open → the rider types
*"Tahoe City down to South Lake Tahoe"* → "Chewing on that…" → the drawn route card → the
**A TASTE OF THIS ONE** clip plays. Source is `.scratch/store-screenshots-1.1/preview-1.1.mov`; the
replaced 1.0 file is in `.scratch/asc-backup-1.0-preview/`. Poster frame `00:00:08:00`, which lands on
the drawn card.

⚠ **`previewFrameTimeCode` sent on CREATE is IGNORED — it must be PATCHed afterwards.** The POST
carried `00:00:08:00` and the asset came back reading **`00:00:05:01`**, the previous preview's value,
silently inherited. On this cut 5 s is the "Chewing on that…" beat, so the store thumbnail would have
been a loading state rather than the drawn drive. A separate `PATCH /v1/appPreviews/{id}` set it and a
read-back confirmed. **Always read this field back**; nothing warns you.

⚠ **The old one showed the `/sample` postcard, and that screen was deleted on 2026-08-05** — so it
advertised a flow the app no longer has. It survived the 1.1 sweep because §9's recapture covered
stills only; a video is its own asset and its own step.

**How this cut was built, because the timing is the whole job:**

- **Two takes, not one.** The real flow contains two model waits (~7s and ~25s). Recording it
  continuously gives a 40s clip that is mostly a static screen, and Apple's window is 15–30s. So:
  take A is the cold open + typing + send; take B is the drawn card + the play tap. They are
  concatenated at the natural "he's thinking → here's your drive" beat.
- **Find the beats by contact sheet, not by guessing at tool latency.** `fps=1/2,scale=170:-1,tile=7x2`
  renders a whole take as one readable grid. ⚠ Scene detection (`select='gt(scene,…)'`) finds NOTHING
  here — the changes are text appearing inside a field, which is far below any scene threshold.
- **Pin the audio start by cropping the play button across time** (`fps=2,crop=…,tile=14x1`): the ▶→‖
  flip is the exact frame playback begins. It was 8.25s into take B, which is what `adelay` is set
  from. Guessing this is how a voice lands a second off the button.
- ⚠ **`drawtext` is NOT in this ffmpeg build** (homebrew, no `--enable-libfreetype`), so contact-sheet
  tiles cannot be time-labelled. Count them instead; the `fps` value gives the interval.

```sh
ffmpeg -y -ss 9.5 -t 2.5 -i takeA.mov -ss 17.0 -t 2.5 -i takeA.mov -ss 7.5 -t 23.0 -i takeB.mov \
  -i taste.m4a -filter_complex "\
[0:v]fps=30,scale=1320:2868,setsar=1,setpts=PTS-STARTPTS[v0];\
[1:v]fps=30,scale=1320:2868,setsar=1,setpts=PTS-STARTPTS[v1];\
[2:v]fps=30,scale=1320:2868,setsar=1,setpts=PTS-STARTPTS[v2];\
[v0][v1][v2]concat=n=3:v=1:a=0[v];[3:a]adelay=5750|5750,apad,aformat=channel_layouts=stereo[a]" \
  -map "[v]" -map "[a]" -t 28 -r 30 -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 20 \
  -c:a aac -b:a 160k -ar 44100 -ac 2 -movflags +faststart preview-1.1.mov
```

✅ **Verified before upload, not after:** `volumedetect` reads **-91.0 dB** over the first 5 s (true
digital silence — the app really is silent until you tap) and **-19.1 dB mean / -5.9 dB peak** from
8–20 s. A preview whose voice is missing or clipped is not something to discover from a rejection.

⚠ **The narration audio is the REAL clip, pulled from R2 by subject** — `Tahoe Maritime Museum`,
85.1 s, the same telling `POST /drives/propose` presigns for that route. Use `@skipper/storage`'s
`getR2Client()`; the env vars are `R2_*`, not `S3_ACCESS_KEY_ID`.

### The original 2026-07-28 method notes — still the mechanics, wrong content

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

### The live notes — ✅ **REWRITTEN 2026-08-17** (terse, human voice, fixed-code sign-in)

**The 08-17 rewrite (founder ask: "verbose and AI-generated"), what changed and what survived:**
the walkthrough content is intact — quick look, sign-in, saved drive, the GPS warning, deletion,
location use — at roughly 60% of the length. The sign-in step now leads with the FIXED code
(§15d): "Send me a code" then `{{REVIEW_OTP_CODE}}` — which is the demo account's ONLY credential
since the same evening (§15d removed its password row on a founder call; deletion keys on the same
code, and ASC's "password" field deliberately shows the code).
The placeholder is substituted by `asc-metadata.ts` from env at push time, so the committed block
stays credential-free while the live field carries the value. Deliberately DROPPED: the numbered
"Two things" frame, the mid-sentence ALL-CAPS, the "Where are we headed?" opening-line quote and
the rotating-placeholder description (drift-prone anchors of low nav value — the 2026-08-06 pass
below is the argument), and the wifi-timing aside. Every tap-target string that remains was
verified on the live screens 2026-08-06 or on 2026-08-17's simulator pass.

⚠ **1.1's review-path pitch still holds and the notes still lead with it:** a reviewer at a desk
plans a real drive and hears a real clip, no account, no location prompt; the wall lands at "Make
this drive".

<!-- asc:reviewNotes — scripts/asc-metadata.ts reads the block below. Keep the marker attached to its fence.
     ⚠ {{REVIEW_OTP_CODE}} is substituted by the script from env at diff/push time — never paste the real code here. -->
```
Skipper is a hands-free audio tour for drivers. You type where you want to go, the guide plans the route, and each stop's story plays by itself as you reach it on the road.

QUICK LOOK, NO ACCOUNT: the content covers the Lake Tahoe region only, but your own location never matters at a desk - nothing asks for location permission until you start an actual drive. Open the app and type into the text box:

    Tahoe City down to South Lake Tahoe

The route appears under "YOUR DRIVE", with a small player under "A TASTE OF THIS ONE" - press play for a real minute of narration from that route. No sign-in, no permission prompts. (Asking for a road outside Tahoe gets a polite in-character refusal - intended, not a bug.)

SIGN IN (demo account): tap "Sign in" (top left), enter review@skipper.fm, tap "Send me a code", then enter code {{REVIEW_OTP_CODE}} and tap "Let's roll". That code is fixed for the demo account and always works - you do not need to receive the email. (It is the same value shown as the demo password in App Review Information.)

SAVED DRIVE: signed in, the top-left button becomes a list icon - tap it for "My Drives" and open "Tahoe City -> South Lake Tahoe". Tap "Load up the drive" first and let it finish; audio plays from the phone's local copy, so a stop tapped before the download lands will say so. Then, under "Tap a stop to hear it.", tap any stop for its full story (about a minute each, no auto-advance).

Please don't tap "Start the drive" at a desk. That is the live GPS drive: it waits until you physically reach each stop near Lake Tahoe, and it is the only place the app asks for location - "When In Use" only, used to time the stories to the road. A one-time Motion & Fitness prompt may follow; motion is used only for speed and heading. To build a drive yourself: plan a route as above and tap "Make this drive" - signed out it asks for a free account; signed in it spends one of the account's free drive credits, and the drive's start/end coordinates are saved to the account.

ACCOUNT DELETION (5.1.1(v)): Settings (gear, top right) -> "Delete account" -> tap "Email me a code" and enter the same code {{REVIEW_OTP_CODE}} -> "Permanently delete" -> "Delete forever". Deletion is immediate and total: the account, its drives, and its remaining credits. Testing it on the demo account is fine - signing back in with the same code recreates the account (without the saved demo drive).

Analytics are PostHog plus the bundled Google Maps SDK, as declared in our App Privacy labels. No ads, no cross-app tracking.

Thank you!
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
### Owed to the NEXT version — fold §14's answers in here (2026-08-14)

Apple closed the 2.1 round with "include this information in the Notes field … **for future
submissions**". That is the next version, **not this one** — and the distinction is doing real work:

- ⚠ **Do NOT edit this field while the version is `WAITING_FOR_REVIEW` / `IN_REVIEW`.**
  `asc:metadata` warns on exactly those states: a localization edit may be refused, or may bounce the
  submission back out of the queue. §14 cost a round getting into it.
- ⚠ **§14b's reply now DEPENDS on this block existing.** Its item 4 reads "the full walkthrough,
  signed out and signed in, is in this version's App Review Notes", which is what bought ~900 of the
  characters that got the reply under 4000. **Deleting or gutting the walkthrough makes a sentence
  Apple has already read become false.** If it goes, §14b's item 4 has to grow back first.
- **The budget, so it is planned rather than squeezed:** Apple's items 3 (what it is / audience /
  problem), 5 (external services) and 6 (regional differences) compress to roughly **900 characters**
  together — see §14b for the compressed wording, which is already written and already fits. This
  block is at 3935/4000, so the walkthrough has to give up about that much. Re-cut it deliberately at
  version-prep time; do not shave.
- ✅ **Apple asks for item 3 independently of the 2.1 round, so it is not just compliance.** Their
  own review advice tells you to "describe your app's concept and features in your own words",
  "explain key features and how to enable them" and "identify your target audience" in this very
  field ([Tech Talk 10885](https://developer.apple.com/videos/play/tech-talks/10885/)). This block
  is 100% walkthrough today and says none of it — a reviewer learns WHAT TO TAP but never WHAT THE
  APP IS. That is the gap worth the 900 characters.
- 🆕 **USE THE ATTACHMENT FIELD — we have never used it.** App Review Information has an
  **Attachment section**, and Apple's guidance is to "attach the files in the Attachment section in
  App Store Connect and provide any descriptions or links in the Review Notes field"
  ([App Review](https://developer.apple.com/distribute/app-review/)). §14's walkthrough video
  belongs there on the next submission, referenced from this block by one line — which costs far
  fewer characters than describing what the video shows, and puts it in front of the reviewer
  BEFORE a question is asked instead of after. See §14a for why a location-locked app is expected to
  ship a recording every time.
- **If a round ever stalls or repeats: book an App Review appointment** through Meet with Apple and
  talk to a reviewer directly. Free, and cheaper than a third guess at what they want.

✅ **This block is still TRUE as of 2026-08-13, and the proof is unusually good.** The §14 recording
walked the scripted route — the exact string this block hands the reviewer — against PRODUCTION on
build 25, and got a real proposal, a real clip, and a 17-stop saved drive. That rules out the failure
mode this section fears most: reviewer notes invalidated by a CORPUS or REGION change with no app
release (it happened once already, below). Several `apps/api` region-geometry commits landed after
build 25, and the drive still plans.

### ⚠ The 2026-08-06 re-verification — SIX defects, three of them dead ends

Every anchor in the block above was re-read against the shipped screens on 2026-08-06 and **six were
stale**, because the client kept moving after the notes were written on 08-02. They are fixed above and
listed here so nobody "restores" an older copy.

✅ **PUSHED TO ASC 2026-08-06** (`bun run asc:metadata -- --apply`) and verified INDEPENDENTLY, not
from the script's own report: the live `appStoreReviewDetail.notes` is **3978 chars** and contains
*"Where are we headed?"*, *"Use a password instead"*, *"Load up the drive"*, *"the top-left button
becomes a list icon"* and *"Two things will help you"*, while *"Well now"*, *"Not near Tahoe"*,
*"Hear a quick sample"*, *"Three things will help you"*, *"Under the heading THE ROUTE"*,
*"Under MY DRIVES"* and *"a text box reading"* are all gone.
⚠ **The apply script reads back only promotionalText and description** — it prints `✓ App Review
notes` without re-reading them, so its success line is not evidence for the field that matters most
here. Read `appStoreReviewDetail` directly, as this pass did.
⚠ **They were pushed against build `25` (`98a292db`)**, which is the commit every quoted string was
verified on. Attaching a LATER build re-opens the question.

⚠ **A SEVENTH defect appeared the same afternoon, and it did NOT come from a build.** The coverage
sentence read *"covers Lake Tahoe and the nearby Nevada side (Reno, Carson City, Virginia City)"* —
true when written, and made misleading hours later by
[../decisions/tahoe-reno-region-split.md](../decisions/tahoe-reno-region-split.md), which moved those
three into a separate `reno-carson` region **applied straight to prod**. A drive resolves anchors from
ONE region's roster, so Tahoe → Virginia City stopped being plannable and the notes were naming places
a reviewer could not route to. **Founder call 2026-08-06: drop the Nevada names rather than explain the
split** — under-promising is the safe direction, and the scripted path is all-Tahoe anyway. Re-pushed
at **3935/4000** and verified: Reno, Carson City, Virginia City and "Nevada side" are all gone.
⚠ **The lesson generalises past this listing: reviewer notes can be invalidated by a CORPUS or REGION
change, with no app release and nothing in git to notice.** The six earlier defects all came from
client work; this one came from an admin route. Anything that changes what the planner will accept is a
change to §10.
✅ Checked while there: `pickRegionId` falls back to `regions[0]` and `GET /regions` is
`orderBy(asc(displayName))`, so "Lake Tahoe" sorts ahead of "Reno & Carson City" and a fresh install
lands on Tahoe deterministically — which is the only reason the scripted route still works. ⚠ A future
region whose name sorts before "Lake Tahoe" would silently take that slot.

1. ⚠ **The sign-in step (08-05).** Skipper now signs riders in with an emailed CODE by default
   (`docs/designs/lowest-friction-signup.md`), and **a reviewer cannot receive that email** — they must
   tap **"Use a password instead"** to reach the demo account. Without this, review stalls at a code
   prompt with no way forward, which reads as a broken app rather than a misleading note.
2. ⚠ **Step 3 pointed at a deleted screen.** It told the reviewer to tap *"Not near Tahoe? Hear a
   quick sample."*; that screen and `GET /sample` were deleted on 08-05, and prod answers **404**
   (verified 2026-08-06). The step is DELETED rather than rewritten — the anonymous taste is the route
   preview clip step 2 already describes — and the preamble drops from "Three things" to "Two".
3. ⚠ **"Tap a stop to hear it" was a broken promise, and this is the worst of the six.** Since the
   download-before-start gate, the drive-detail mini-preview plays **only what is already on the
   phone**, and opening an old drive from MY DRIVES deliberately starts no download. A reviewer
   following the old notes tapped a stop and got *"That stop didn't come down with the rest."* The
   block now tells them to tap **"Load up the drive"** first.
4. ⚠ **The opening line quote was the cut kicker.** `voice.ts` `openingQuestion` is
   **"Where are we headed?"**; *"Well now —"* went with the tic (founder, 2026-08-03).
5. ⚠ **The composer no longer "reads 'Tell me where to'".** That string is now the FALLBACK for a
   region with no curated names; the live placeholder rotates through `plan.placeholderShapes` filled
   with the region's own anchors. The notes describe the rotation instead of quoting one frame of it.
6. ⚠ **MY DRIVES is a SCREEN, not a section on Home** (`7fd0fd8d`). Signed in, the header-left slot
   swaps from the "Sign in" button to a **list icon** that pushes `/drives`, titled "My Drives". The
   old notes said "Under 'MY DRIVES'", which describes a home-page section that no longer exists. The
   *"THE ROUTE"* heading the notes also named is gone from the detail screen for the same kind of
   reason.

**The durable lesson, since this is the second consecutive rewrite of this block for the same cause:**
these notes quote UI strings, and UI strings are the fastest-moving prose in the repo. Nothing fails
when they drift — no test, no lint, no build. **Re-read every quoted string against the screens
immediately before pushing, never from this file's memory**, and push them LAST, after the client is
frozen for the build being submitted.

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

✅ **Re-read 2026-08-06 and UNCHANGED:** `state=DRAFT`, `deviceFamily=IPHONE`, claimed exactly
`supportsDarkInterface` + `supportsSufficientContrast` — the two evidence-backed ones above, and no
drift in the seven declared false. So the only thing this still needs is PUBLISHING, in the UI.

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

- [x] ✅ **`delete-user` is live** (a reviewer WILL test deletion — it's the one guideline they can
      check in 30 seconds). `POST https://api.skipper.fm/api/auth/delete-user` answered **400** on
      2026-08-06. A bare POST with no body answers 400; with a well-formed body and no session, 401.
      **404 is the only failing answer** — it means the route never deployed.
- [x] ✅ `https://skipper.fm/privacy`, `/terms`, `/support` all **200** (2026-08-06).
- [x] ✅ **`/health` and `/regions` both 200; `/bootstrap?rotation=0` 200** with five composed example
      rows for Lake Tahoe (2026-08-06) — that endpoint IS the cold open's content, so it is the one
      worth probing.
- [x] ⛔ **`GET /sample` is DELETED — expect 404, and this item is VOID as a 200 check.** It read
      "the sample plays in prod" until 2026-08-06. The route and its screen went on 2026-08-05
      (`docs/designs/onboarding-gate-reconsidered.md`); prod answers 404 and that is HEALTHY.
      ⚠ Same class of trap as the `/roam/sample` → `/sample` rename before it, and now the second time
      this line has described a path that moved: probing a dead path reports a healthy deploy as
      broken. ⚠ `GET /planner/copy` 404s for the same reason (`/bootstrap` replaced it) — do not add
      it back as a check.
- [x] ✅ **The planner answers anonymously** — verified 2026-08-06 (founder go; it spends model
      tokens). `POST https://api.skipper.fm/drives/plan`, no session, the exact rider line §10 hands
      the reviewer: **200 in 3.3 s**, in persona, `done: false`. So `ANTHROPIC_API_KEY` IS set on the
      deployed service — which is the thing this check exists for, because if it weren't, every
      reviewer attempt would get the in-persona outage line and the app would read as broken rather
      than unconfigured, on 1.1's primary review path.
      ⏳ **The DRAW turn and `POST /drives/propose` behind it are still unproven on prod** — that is
      what puts the route under "YOUR DRIVE" and the clip under "A TASTE OF THIS ONE". It bills Google
      Routes on top of model tokens, so it is a separate call, and walking §5 on a real build proves
      it more cheaply than curl does.
- [x] ✅ **The 1.1 metadata is entered in ASC** — pushed 2026-08-03 and re-pushed the same day after
      the em-dash sweep re-punctuated §3 and §4, both times read back independently. Re-verify with a
      no-flag `bun run asc:metadata` (it prints "already matches" for all three) rather than trusting
      this tick — that check is cheap and ASC does not warn when the doc and the listing drift apart.
- [x] ✅ **A build whose short version is `1.1.0` is attached** — build **25** (`9ece8ba8`), attached
      and read back 2026-08-06. ⚠ ASC does not warn about a mismatch; `asc:metadata` does.
- [x] ✅ **Everything else the API can see is set** (swept 2026-08-06): copyright `2026 Manoa, Inc.`,
      age rating `TWELVE_PLUS`, release type MANUAL, review contact + phone, demo account
      `review@skipper.fm` with a password present, description 2565/4000, promo 168/170,
      keywords 99/100. `whatsNew` is null and that is CORRECT — 1.0.0 was developer-rejected and never
      released, so 1.1.0 is the first public release and Apple hides the field.
- [x] ✅ **The demo account is healthy** — `review@skipper.fm` exists with a credit balance of **99**
      and still owns the saved drive §10 sends the reviewer to, "Tahoe City → South Lake Tahoe"
      (read back from the live DB 2026-08-06).
      ✅ **Its PASSWORD is VERIFIED WORKING against prod (2026-08-06).** It CAN be checked from here
      after all — `appStoreReviewDetail.demoAccountPassword` is readable over the API, so the check is
      a real sign-in, not an inspection: `POST /api/auth/sign-in/email` → **200**, user
      `review@skipper.fm` / "App Review", `isAnonymous: false`, `emailVerified: true`; the session
      cookie then fetched `GET /drives` → **200, 1 drive: "Tahoe City → South Lake Tahoe"** — the exact
      drive §10 sends the reviewer to. ⚠ **Never print, log or commit that password**; read it, use it,
      discard it.
      ⚠ **Auth rides the Better Auth session COOKIE, not a bearer token** (`apps/mobile/src/lib/api.ts`).
      A bearer `Authorization` header gets a **401** on `/drives` and looks exactly like a dead
      credential — it is not; it is the wrong scheme. That cost one false alarm here.
      ⚠ Still worth one manual pass in the UI: since 2026-08-05 the password form is a FALLBACK behind
      **"Use a password instead"**, so the credential working says nothing about the reviewer being
      able to REACH it.
- [x] ✅ **Screenshots captured in dark mode AND UPLOADED (§9)** — six new 1.1 frames built and pushed
      2026-08-06; all six `COMPLETE` at 1320×2868. Sources in `.scratch/store-screenshots-1.1/`, the
      replaced 1.0 set in `.scratch/asc-backup-1.0-screenshots/`.
- [x] ✅ **§10's App Review notes are LIVE and re-verified** (3978/4000) — see §10's 2026-08-06 block
      for the six defects they fix and how to check them without trusting the apply script.
- [x] ✅ **The App Preview VIDEO (§9b) is re-shot and replaced** — 28 s of the actual reviewer path
      (type → he draws it → the taste clip plays), `COMPLETE`, 2026-08-06. The old `/sample` cut is
      backed up in `.scratch/asc-backup-1.0-preview/`.
- [ ] The coverage sentence in the description still matches reality (it says Tahoe only).
- [x] ✅ **Availability is United States ONLY — re-verified 2026-08-06 by paging all 175 territories:
      exactly ONE is available**, and its id decodes to `{"s":"6778946770","t":"USA"}`.
      `availableInNewTerritories: false`, so it will not silently expand later. It defaults to every
      territory — if this ever ships wide, you have taken on GDPR without a policy that answers it
      (§1). ⚠ Read it from `/v1/apps/{id}/appAvailabilityV2` and then page its
      `territoryAvailabilities` relationship **at `/v2/appAvailabilities/{id}/…`** (the `/v1/` form of
      that relationship 404s — see §14c); the `?include=` shortcut returns an EMPTY included array
      and reads as "no territories available", which is indistinguishable from a real problem.

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

---

## 14. Guideline 2.1 — "Information Needed" (2026-08-13)

**What happened:** 1.1.0 came back `REJECTED` under **2.1 · Information Needed**, Apple's standing
questionnaire for a first submission. It reports **no defect** — no crash, no bug, no guideline
violation. Seven items are asked for, and six of them are prose we already own (§§1–11 of this file).
The seventh, item 1, is **a screen recording captured on a physical device**, and that is the whole
job. The reply goes in **Resolution Center**, on the existing submission; the build does not change.

⚠ **Resolution Center is not the same field as §10.** Apple closes with "include this information in
the Notes field … for future submissions", which is advice for the NEXT version, not the fix for this
one. §10 is at **3935/4000** and cannot absorb §14's answer; folding a compressed version in is a
separate, optional edit (see the end of this section). Answer in Resolution Center first.

### 14a. The recording — ✅ **CAPTURED AND VERIFIED 2026-08-13**

> **Source:** `~/Downloads/ScreenRecording_08-13-2026 23-49-49_1.MP4` — 3:19, **1320×2868 @ 60 fps
> HEVC**, i.e. an iPhone 16 Pro Max at native resolution, **iOS 26.6** (founder, 2026-08-13).
> **Attach the compressed cut, not the source:** 85 MB → **4.5 MB** at 736×1600 H.264/AAC, tail
> trimmed at 196.5 s (the source ends with Control Center open, stopping the capture). Text stays
> legible at that size — checked on the encoded file, not assumed.
>
> ```sh
> ffmpeg -y -t 196.5 -i raw.MP4 -vf "scale=-2:1600,fps=30" -c:v libx264 -profile:v high -crf 26 \
>   -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k -ar 44100 -ac 2 \
>   -movflags +faststart skipper-review-walkthrough.mp4
> ```
>
> **Verified against the file itself, not from memory** — every shot below lands, in order, and §14b's
> timestamps were read off it. Audio is real and unclipped (mean **−22.7 dB**, peak **−2.3 dB**) and
> plays in three stretches: **42.5–64.7 s** (the taste clip), **116.7–132.2 s** (the drive music bed
> while rolling), **145.3–160.0 s** (a stop's narration). A silent recording of an audio app answers
> nothing, which is why this is measured rather than trusted.
>
> ✅ **The deletion segment deleted the RIGHT account.** Read back from prod: `review@skipper.fm`
> still exists with **1 drive and a balance of 99**, `ptshih@gmail.com` (admin) still has **8 drives
> and 91**, and `hello@skipper.fm` — created on camera, deleted on camera — is **gone with zero
> orphaned `drives` or `credit_entries` rows**. That last number is also the best evidence yet that
> `purgeUserData` on the database hook actually works: the 5.1.1(v) claim is not just declared, it is
> observed.
>
> ⚠ **AN iOS SCREEN RECORDING STRUCTURALLY CANNOT SHOW A SYSTEM PERMISSION ALERT** — and this is the
> durable finding, worth more than this submission. At 113.5–115.5 s the screen **dims and nothing
> appears**: ReplayKit captures the app's own windows, and the location alert is drawn by another
> process. Re-recording cannot fix it, on any device. **So Apple's "include any prompts requesting
> access to sensitive data" bullet is satisfied by EXPLAINING it**, which §14b's item 1 now does — the
> pre-permission card before it, the dim at 1:53, and the status-bar location indicator from 1:56
> onward are the three observable facts that bracket the invisible alert.

The bar Apple set: a physical device, the latest OS, starting at LAUNCH, walking the typical user
flow, and including registration / login / deletion, any paid-content flow, any user-generated
content, and every sensitive-data prompt.

**Before you press record**

- **Device: the iPhone 16 Pro Max (`iPhone17,2`), on iOS 26.5.2** — the paired phone `xcrun devicectl
  list devices` reports. ⚠ Check Settings ▸ General ▸ Software Update first; "latest OS" is Apple's
  own wording and a point release behind is a free thing to be asked about twice.
- **Install build 25 from TestFlight**, not a dev build. It IS the binary under review, and it is
  attached, `VALID`, and past processing. (A `expo run:ios --device` build off HEAD would render the
  same screens — `apps/mobile` has zero commits since `98a292db` — but "recorded on the submitted
  build" is a sentence worth being able to write.)
- **Delete the app first** so the recording opens on a true cold launch with no session. Apple's
  "must begin with launching the app" is literal — start the capture on the Home Screen.
- **A throwaway email inbox reachable ON the phone.** Sign-up is an emailed six-digit code
  (`app/sign-in.tsx`: "there is no password sign-up path any more"), and the deletion segment has to
  destroy a real account. ⚠ **NEVER record deletion on `review@skipper.fm`** — that is the reviewer's
  own credential and §10 sends them to a drive it owns.
- Do Not Disturb ON, volume up, Control Center screen recording with the **microphone OFF** — in-app
  audio is captured either way and the mic only adds room noise. The audio IS the product; a silent
  recording of an audio app answers nothing.

**The shot list** — in order, one continuous take if you can. Every quoted string below was read out
of `apps/mobile/src/ui/voice.ts` at HEAD, which is build 25's code.

1. **Cold launch** from the Home Screen. Let the splash land on the cold open: **"Where are we
   headed?"** over the composer.
2. **Plan it, signed out.** Type exactly `Tahoe City down to South Lake Tahoe` and send. He answers
   ("Chewing on that…"), then draws the route under the **YOUR DRIVE** kicker.
3. **The taste clip.** Press play under **A TASTE OF THIS ONE** and let 10–15 s of real narration
   play out loud. This is the shot that proves the product, and it happens with no account and no
   permission prompt — say so in the reply.
4. **The wall.** Tap **"Make this drive"** while still signed out: *"You'll need a free account to
   keep this drive."* Apple's paid-content bullet is answered by showing that this is the ONLY wall
   and it costs nothing.
5. **Registration.** Sign in ▸ throwaway address ▸ **"Send me a code"** ▸ switch to Mail ▸ read the
   code ▸ back ▸ enter ▸ **"Let's roll"**. Shows account creation end to end, no password.
6. **Spend a credit.** **"Make this drive"** again. The drive is built and saved; the remaining-drives
   line drops by one.
7. **Download.** On the drive screen, **"Load up the drive"**, let it finish. ⚠ Skipping this is what
   made the old §10 notes a broken promise — a stop tapped before the download reports it did not
   come down.
8. **Real narration from a saved drive.** Under *"Tap a stop to hear it."*, tap a stop, let 15 s play.
9. **The location prompt — the bullet Apple asked for by name.** Tap **"Start the drive"**: the iOS
   When-In-Use dialog appears carrying our purpose string (*"Skipper uses your location to play each
   stop as you reach it on the drive."*), then Motion & Fitness if it fires. Allow both. The player
   sits on *"Looking for the satellites. Hang tight."* and nothing plays, because the phone is not on
   the route. Hold ~10 s, then **"Pull over"**. Do not cut this segment: it is the visible proof that
   nothing before it asked for location.
10. **My Drives.** The list icon, top-left → the saved drive is in the list.
11. **Sources & licenses.** Settings (gear) ▸ *"Sources & licenses"* — the CC attribution screen.
    Answers item 7 with a picture instead of a paragraph.
12. **Account deletion.** Settings ▸ **"Delete account"** ▸ **"Email me a code"** ▸ fetch it ▸
    **"Permanently delete"** ▸ **"Delete forever"**. Land back on the signed-out cold open. Optional
    and worth 5 s: try to sign in with that address again and show there is nothing there.

⚠ **Do NOT open Settings ▸ Developer on camera.** Simulated GPS is admin-gated (`user.role`), so it
is a mode the reviewer cannot reach; showing it invites a question nobody asked. Same reason §9 bars
the `SIM` badge from a store asset.

### ONE video, and it is the desk walkthrough — no simulated drive

**Decided 2026-08-13.** Apple's own list is launch, typical flow, registration/login/deletion, paid
flows, user-generated content, permission prompts. **The trigger firing is not on it.** The
walkthrough covers every item Apple named, and it already proves the audio twice — the route-preview
clip (shot 3) and a full stop from a saved drive (shot 8). Shot 9 shows the live drive waiting on a
fix, which is the honest picture of a Tahoe product reviewed in Cupertino. A simulated clip answers
an unasked question by putting a developer mode into a review thread. **Hold it in reserve**: if
review comes back with "we could not see the core feature", send it THEN, against a specific
question, with the one-sentence explanation.

⚠ **COUNTER-EVIDENCE, found 2026-08-14 on Apple's own App Review page — read it before reusing this
decision.** Apple's standing guidance for exactly our shape of app is: *"If reviewing the app
requires being in a specific physical location, include a screen recording of the app in action with
your submission so reviewers can evaluate the experience."*
([developer.apple.com/distribute/app-review](https://developer.apple.com/distribute/app-review/)).
Two things follow, and neither reverses the call above for THIS round (the reply is sent and it
explains the gap in words):

1. **The recording is not a rejection response, it is a STANDING submission asset for this app.** A
   location-locked app is expected to ship one every time. §14's video should be attached to the next
   submission up front, not produced under a 2.1 clock.
2. **"The app in action" is the phrase to weigh.** The one thing our cut cannot show is the app in
   action *on the road* — which is the product. That tilts the next round's calculus toward a real
   Tahoe drive (RISK-1, which is owed anyway) rather than toward the simulator.

⚠ **SUPERSEDED FOR FUTURE SUBMISSIONS (founder, 2026-08-14) — this decision does not survive the demo
mode existing.** "No simulated drive in the video" was correct for a clip showing a mode the reviewer
could not reach, which we were not disclosing. Once the simulated drive is a **documented, reviewer-
reachable feature**, filming it is consistent rather than a leak — and the mode is *how the video
gets made*. See [../designs/app-review-demo-mode.md](../designs/app-review-demo-mode.md) §0, which
also carries the two traps: **film at REAL TIME, not 8×** (at 8× the stop gaps fall below a clip's
own length and tellings collide), and **rename the `SIM` tag** before it reaches an App-Store-facing
video, because on an iPhone "SIM" reads as the SIM card. ⚠ The decision above still stands for the
CURRENT round, which is already submitted with the desk-only cut.

⚠ **If it is ever sent, the mechanics, so they are not re-derived under time pressure.** The FLAG is
easy to keep off camera; the PLAYER is not.

- **The flag persists and survives sign-out.** `skipper.simMode` in SecureStore, read at startup
  (`src/lib/sim-mode.tsx`), and the wrapped `signOut` (`src/lib/auth.ts`) purges downloaded drives
  and nothing else. **The admin gate is on the WRITER ONLY** — Settings ▸ Developer. `play.tsx:58`
  reads the value from context with no role check, so it keeps acting after you switch to a
  throwaway account. Sequence: install ▸ sign in as yourself ▸ toggle ON ▸ sign out ▸ force-quit ▸
  record. Set it AFTER installing — Keychain items can outlive an app deletion, so rely on neither
  behaviour.
- **Two renders cannot be switched off.** `SIMULATED DRIVE` + the *Real time / 8× faster* buttons
  (`play.tsx:720`, `phase === 'ready'` only, so it is gone once rolling but it IS on the screen you
  film just before), and the **`SIM` tag** beside "N of M stops" (`play.tsx:688`) for the whole
  drive. Hiding either means editing the app, which means a build that is not the one under review.
- **So never hide it — label it.** An unexplained `SIM` badge in a video *you* sent is a worse
  question than the one it was avoiding. 8× is the right speed: a ten-stop drive in ~2 minutes.

**The genuinely strongest asset, and it is not this:** 60 s of the app firing a stop *while actually
driving* in Tahoe. No desk pass can fake it and it closes RISK-1
([1-1-submission-sweep.md](1-1-submission-sweep.md) §0). It is a trip, not a recording session — do
not hold the reply for it.

**After capture**

```sh
ffmpeg -i raw.mov -vf "scale=-2:1280" -r 30 -c:v libx264 -crf 28 -preset veryfast \
  -pix_fmt yuv420p -c:a aac -b:a 96k -movflags +faststart review-walkthrough.mp4
```

Attach it to the Resolution Center reply. If the file is refused for size, host it and paste the link
— but a hosted link is a second thing that can break, so try the attachment first.

### 14b. The reply — paste this into Resolution Center

⚠ **RESOLUTION CENTER CAPS THE REPLY AT 4000 CHARACTERS** (founder, 2026-08-13). This block is
**3901** — 3923 if the field normalises newlines to CRLF, so it clears either way. **Measure after any
edit**, the same way §10's notes are measured; the first draft answering all seven items in full ran
**10745** and would have been silently unsendable.

**What the compression gave up, so nobody "restores" it.** The cuts were structural, not cosmetic:
the signed-in walkthrough was DELETED and replaced by a pointer to §10's notes, which the reviewer
already has attached to this same version and which say it better; the timestamp index was cut to the
moments Apple named by name; the licence list kept the licences and dropped the four music artists
(their attribution is a CC obligation discharged IN THE APP, not in a support thread). Nothing that
answers one of the seven questions was dropped. ⚠ **The App Review Notes are now load-bearing for
item 4** — if §10 is ever rewritten, this reply's "see the App Review Notes" stops being true.

⚠ Do **not** paste the demo password here or anywhere else; it lives in App Review Information.

```
Thank you for the review. Answers in order.

1. SCREEN RECORDING
Attached: skipper-review-walkthrough.mp4 (3:16), recorded on the device in item 2, on build 25, the build attached here. It opens by launching the app from the Home Screen and planning a drive by typing to the guide. 0:42 a real narration clip from that route, with no account or permission prompt; 1:04 account creation (an email address, then a six-digit code we send; no password); 1:28 a drive created, spending one free drive credit; 1:48 the location prompt; 1:56 the live drive running, 0 of 17 stops played because the device is not on the route; 2:50 in-app account deletion, confirmed at 3:11.
The iOS location alert is not visible: iOS omits system alerts from screen recordings. Our explanation appears at 1:48, the screen dims behind the alert at 1:53, and the status bar shows the location indicator from 1:56. The account deleted on camera is a throwaway, not the demo account.

2. TESTED ON
iPhone 16 Pro Max (iPhone17,2) on iOS 26.6 - the physical device the recording was made on, via TestFlight and development builds. Simulator on iOS 26.5: iPhone 17 Pro Max, 17, and SE (3rd gen). iPhone only, portrait only, no iPad; minimum iOS 16.4.

3. WHAT IT IS, AND FOR WHOM
Skipper is a hands-free audio tour for drivers. You plan a drive by TYPING to a guide character in plain language and he lays out the route, its stops and a researched story for each; then mount the phone and drive, and each story plays by itself as you reach the place it is about. The problem: what is worth knowing about a road is invisible from it, and a driver cannot read. Stories are researched per place ahead of time from cited public sources; where the record is thin the guide says so rather than invent. A downloaded drive plays with no signal. Audience: US road-trippers, day-trip drivers and their passengers.

4. SETUP AND ACCESS
No setup or sample files. Demo credentials are in App Review Information; the full walkthrough, signed out and signed in, is in this version's App Review Notes. Note: tap "Use a password instead" on the sign-in screen, because we normally email a code you cannot receive.

5. EXTERNAL SERVICES
Anthropic (Claude) - the planning conversation; the rider's typed request goes there to produce a route. No transcript is stored. Google Maps Platform - Routes API for the route, Maps SDK for the in-app map, Places API in our back office only. Google Cloud Text-to-Speech - narration audio, made ahead of time. Better Auth (self-hosted) for accounts; Resend sends sign-in codes. Google Cloud Run, Neon and Cloudflare R2 host the API, database and audio (private signed URLs). PostHog for analytics and crash reporting. No ad SDKs, data brokers or cross-app tracking, so no App Tracking Transparency prompt. No payment processor: no in-app purchases or subscriptions.

6. REGIONAL DIFFERENCES
Available in the United States only, and identical everywhere available - no region-gated features, pricing or content. What varies is the audio library, by road not country: it covers the Lake Tahoe region of California and Nevada; elsewhere the guide says so in character. The app asks for location only when you start a drive.

7. REGULATED INDUSTRY / THIRD-PARTY MATERIAL
Not a regulated industry: no health, financial, gambling, government or medical service, and no navigation. Third-party content is public-source, reused under licences permitting commercial use with attribution, credited in-app (Settings > Sources & licenses, 2:47): Wikipedia (CC BY-SA 4.0), Wikidata (CC0 1.0), Macrostrat (CC BY 4.0), Google Places under the Maps Platform Terms, and music under the Pixabay Content License and CC BY 4.0. We hold no licences needing documentation. There is no user-generated content: the rider's request to the guide is the only free text, is never shown to another user, and needs no reporting or blocking.
```

### 14c. The state to watch, because it moved on its own

Read-only, twice on 2026-08-13, twelve minutes apart:

| | first read | second read |
|---|---|---|
| `appStoreVersions[1.1.0].appStoreState` | `REJECTED` | **`READY_FOR_REVIEW`** |
| `reviewSubmissions[445ea909].state` | — | **`UNRESOLVED_ISSUES`** |

Nothing here wrote to ASC (`asc:metadata` without `--apply` is a read, and it reported "already
matches" both times). ✅ **Cause confirmed the same day: the founder was clicking around the ASC UI.**
**The submission's `UNRESOLVED_ISSUES` is the state that describes reality**; the version-level field
is the one that drifts.

✅ **The stray clicks broke NOTHING — swept read-only, 2026-08-13.** Worth recording because "I
accidentally clicked some things" on a live submission is otherwise unfalsifiable, and because this
list is the sweep to re-run next time — **which is now a command: `bun run asc:state`**
(`scripts/asc-review-state.ts`, promoted 2026-08-17; covers the submission/item/version states and
the App Review Information row below, and `--set-demo-creds --apply` re-pushes the demo credential
pair from env if the code rotates or the account is re-created):

| checked | reads |
|---|---|
| build on the version | **25** (`9ece8ba8`), `VALID`, still attached |
| submission `445ea909` | `UNRESOLVED_ISSUES`, **not canceled**, and its one item is `READY_FOR_REVIEW` — *not* `REMOVED` |
| review detail | contact + phone intact · `demoAccountRequired=true` · `review@skipper.fm` · password **still set** · notes **3935** |
| localization `en-US` | description 2565 · promo 168 · keywords 99 · `whatsNew` null · support + marketing URLs intact |
| assets | six screenshots `APP_IPHONE_67`, all `COMPLETE` · one preview `IPHONE_67` `COMPLETE` @ `00:00:08:00` |
| age rating | `TWELVE_PLUS` |
| availability | **1 of 175** territories — `USA` — `availableInNewTerritories=false` |
| accessibility declaration | `DRAFT`, `IPHONE`, `supportsDarkInterface` + `supportsSufficientContrast` — unchanged |

⚠ **Two things the API cannot see, so they are the only ones worth eyeballing in the UI:** the App
Privacy label (§8 — no public API at all) and whether a Resolution Center message was sent.
⚠ **The item state to fear is `REMOVED`.** The 1.0.0 submission `a7560c44` shows exactly that on its
item, which is what a withdrawn version looks like from here — a clean contrast against 445ea909's
live item, and the fastest way to tell "still in review" from "quietly pulled out of it".

⚠ **`territoryAvailabilities` hangs off `/v2/`, not `/v1/`** — `/v1/appAvailabilities/{id}/
territoryAvailabilities` answers **404 `PATH_ERROR` "The relationship … does not exist"**, and a
sweep that swallows the error reports **0 of 0 territories**, which reads as *availability was wiped*
rather than *the path was wrong*. Follow the `related` link the `appAvailabilityV2` payload hands
you; it is already `/v2/`. Same failure shape §12 warns about for `?include=`, different cause — and
it cost one false alarm here.

Why it matters: `READY_FOR_REVIEW` means the version is *submittable*, not *submitted*.

✅ **RESOLVED 2026-08-14.** The reply went into Resolution Center and **nothing moved** — a re-read
showed submission `UNRESOLVED_ISSUES` and version `READY_FOR_REVIEW`, exactly as before. One click on
**Resubmit to App Review** and both read `WAITING_FOR_REVIEW` (`submittedDate` 2026-08-14T07:16:27Z),
on the **same submission id** — so the thread survived — with **build 25 still attached** and release
type still MANUAL. ⚠ Never let a resubmit swap the build: a newer one re-opens §9's screenshots and
§10's notes, both verified against `98a292db` and only against it.

⚠ **State the finding as an asymmetry, not a mechanism** — the re-read was minutes after the reply,
which cannot rule out a reviewer picking the thread up on their own. **Resubmit anyway**: the cost is
at most queue position, and the alternative failure is an app parked outside the queue for days while
ASC shows nothing wrong. ⚠ **The resubmit OVERWRITES `submittedDate`** — `445ea909` used to read
2026-08-06T20:11:36Z and now reads today. Apple exposes no rejection or review-completed timestamp at
all, so **a round's turnaround is unmeasurable after the fact**; capture it when it happens or lose it.

### 14d. What is deliberately NOT being changed

- **No new build.** Nothing failed. A rebuild re-opens the three-way coupling §9/§10 keep losing.
- **No metadata push.** `bun run asc:metadata` (2026-08-13, no flags) reports all three fields already
  match this doc. Leave them.
- **§10's notes stay as they are, for now.** Apple's "put it in the Notes next time" is worth doing on
  the NEXT version, where the 4000-char budget can be re-cut around it — items 3, 5 and 6 compress to
  roughly 900 characters and the walkthrough would have to give up that much. Doing it now edits a
  field a reviewer is mid-way through reading, to satisfy advice about a future submission. **Founder
  call; the compression is the work, not the push.**

---

## 15. Guideline 2.1 — round two: "unable to sign in" (2026-08-17)

**What happened:** the 2026-08-14 resubmit came back `REJECTED` on 2026-08-17, again under **2.1 ·
Information Needed**, but a different complaint: *"We were unable to sign in with the following demo
account credentials you provided"*, quoting `review@skipper.fm` and the password verbatim. Review
device: **iPad Air 11-inch (M3)** — the app is iPhone-only, so it ran in compatibility mode (noted,
not implicated; see 15a). Apple's next-steps offer valid credentials **or "a demonstration mode that
shows all of the features and functionality"**, and — new this round — state that *"we cannot use a
demo video showing the app in use to continue the review."*

### 15a. The diagnosis — the credentials are VALID; the reviewer never reached the password screen

Established the same day, each step verified rather than inferred:

1. **The exact credentials Apple quoted sign in against production.** `POST /api/auth/sign-in/email`
   with the address and password lifted from the rejection text → **HTTP 200** and a real session
   (2026-08-17T17:03Z). The credential row's hash is untouched since the account was created on
   2026-07-28 (`account.updatedAt` = `createdAt`), `emailVerified` is still `true` (the 08-05
   backfill held, so `revokeUnprovenAccountAccess` never had grounds to fire), the user is not
   banned, and ASC still holds the password. Nothing on our side moved: **zero `apps/api` or
   `apps/mobile` commits since 08-13**, and build 25 is still the attached binary.
2. **The reviewer never completed any sign-in.** `review@skipper.fm` has no session dated 08-17; its
   newest is the founder's build-25 session from 08-06.
3. **The Cloud Run request log shows the entire review session, and it is ~90 seconds** (07:51–07:52
   UTC, UA `Skipper/25`): bootstrap → anonymous mint → `POST /email-otp/send-verification-otp` →
   **200** (a code really was mailed — it landed in the skipper.fm catch-all) → one
   `POST /sign-in/email-otp` → **400** (a failed code entry) → nothing further. ⚠ **No request to
   `/sign-in/email` — the password endpoint — exists anywhere in the review window.** They also never
   touched the planner: no `/drives/plan`, no `/drives/propose`. The review stalled at sign-in and
   ended there; the anonymous front door §10 leads with was never exercised.

**Root cause, and it is in the client, not the account:** on `app/sign-in.tsx`, **"Use a password
instead" is a ghost button on the EMAIL step only.** The primary CTA is "Send me a code"; tap it —
the obvious move — and the code step offers a **number-pad-only** input plus "Send another code" /
"Use a different email". No password path, and a password cannot even be typed into the field. §10's
instruction ("tap 'Use a password instead'") is unfollowable from the step the reviewer was actually
on. So they requested a code for an inbox they cannot read, failed one entry, and stopped — which
surfaces at Apple's end as "unable to sign in with the credentials provided."

**The durable lesson:** a reviewer follows the primary CTA, not the notes. §10 said the right thing
in the right field and it did not matter. Anything review-critical must be reachable from EVERY step
of the flow it lives in, or BE the primary path — notes are advisory; the UI is the instruction.
(TODO #79 is the one-screen client fix; #77's demo mode is the structural answer Apple's own letter
names as acceptable.)

### 15b. The reply — paste into Resolution Center, then click Resubmit to App Review

Same mechanics as §14c: the reply alone does not requeue; the **Resubmit** click does, it reuses the
submission (the thread survives), and the asymmetry argument stands — resubmitting costs at most
queue position. ⚠ **Observed AGAIN 2026-08-17:** the reply went in and a minutes-later read showed
submission `UNRESOLVED_ISSUES`, item `REJECTED`, version `REJECTED` — the second consecutive round
where a reply left every state parked. Still short of proof a reviewer never picks a thread up
unprompted (both reads were minutes after the reply), but the posture it argues is unchanged:
click Resubmit. **579/4000** — deliberately TERSE and OTP-only (founder call, 2026-08-17): one
path, numbered taps, nothing to weigh. The password fallback stays out of the reply on purpose — a
second path is a second chance to wander; it remains documented in §10's notes if a reviewer needs
it. ⚠ **Send this ONLY after §15d's deploy is verified against production** — it promises the fixed
code works, and until the push lands that promise is false. (Verified 2026-08-17 ~18:59Z: send →
sign-in with the fixed code → 200 + session on api.skipper.fm; the same code for another address →
400.)

⚠ **`NNNNNN` is a PLACEHOLDER — substitute the live `REVIEW_OTP_CODE` value by hand when pasting.**
The real code lives in the encrypted envs and in App Store Connect, never in git (same rule as the
password), which is why this committed block cannot carry it. The reply thread is the one place the
reviewer is guaranteed to see it THIS round; giving it a durable home in the notes field is §15c's
next-version item.

⚠ Two longer cuts (1744 password-path-only, then 1734 both-paths) were superseded before sending —
git history holds them; the first is also the fallback if §15d's deploy is ever rolled back.

```
Thank you for the review. Our sign-in defaults to an emailed code that App Review cannot receive, which is what blocked you. We have fixed this on our server (the build is unchanged): the demo account now has a fixed sign-in code that always works.

To sign in:
1. Tap "Sign in" (top left).
2. Enter review@skipper.fm and tap "Send me a code".
3. Enter code NNNNNN and tap "Let's roll". No email needed (screenshot attached).

Once signed in, the demo account's saved drive is under "My Drives" (list icon, top left). The full walkthrough is in the App Review Notes.

Thank you!
```

**Attach: `skipper-signin-code-step-199820.png`** (~/Downloads) — the "Check your email" screen with
the fixed code already typed and "Let's roll" below it: the reviewer sees their exact target screen.
Also captured that day, now HISTORICAL only (§15d later removed the demo account's password, so the
password path no longer works for it — do not send these):
`skipper-signin-password-button-annotated.png` + `skipper-signin-password-step.png`. All three were
shot on the iPhone 17 Pro Max simulator off HEAD — `apps/mobile` is unchanged since build 25's
commit, so the screens are the build under review. ⚠ The code-step filename (and image) carries the
live code — that is FINE for a Resolution Center attachment (the reply body names the code anyway)
but is one more reason none of these belong in git.

### 15c. What this round changes for the NEXT version — do not lose these

- **TODO #79** — the password fallback should be reachable from the CODE step too. One-screen
  change, rides the next build. ⚠ Downgraded from review-critical to rider UX by §15d: the reviewer
  no longer needs the password path at all, so this now serves the rare rider who set a password
  and tapped the code CTA first.
- **#77's demo mode got stronger.** Apple's letter names a demonstration mode as a standing
  alternative to credentials — and simultaneously rules the demo VIDEO out as a review substitute
  ("we cannot use a demo video … to continue the review"). That reweights §14a's video posture: the
  recording is supplemental context, never the access answer; the mode and working credentials are.
- **§10's next re-cut** (the ~900-char fold-in owed from §14) must rewrite the sign-in step around
  the fixed code: "tap Send me a code, then enter the six-digit demo code from App Review
  Information" — the reviewer's natural path is now the documented path. ⚠ That needs the CODE to
  live somewhere the notes can point to without committing it to git: either teach
  `scripts/asc-metadata.ts` a `{{REVIEW_OTP_CODE}}` substitution at push time (cleanest — the doc
  stays credential-free and the live notes carry the value), or keep pointing at a line the founder
  maintains by hand in ASC. Decide at version-prep time; do not paste the value into §10's block.
- **The demo-account OTP email stopped being a live wire and became the mechanism.** Every send for
  the review address now arms the FIXED code, so the mail landing unread in the skipper.fm
  catch-all no longer strands anyone — it is simply unnecessary.

### 15d. The fix — a FIXED sign-in code for the demo account (founder go, 2026-08-17)

**The decision:** instead of only documenting the password fallback harder, make the reviewer's
NATURAL path work. `reviewFixedOtp` (`apps/api/src/auth.ts`) pins the emailed sign-in code for
exactly `review@skipper.fm` to the value of **`REVIEW_OTP_CODE`** (encrypted in both env files and
held in App Store Connect — never in git, same rule as the password). Every "Send me a code" tap
for that address arms the same code, so the code Apple holds ALWAYS works; re-sends re-arm it.
This reverses the 2026-08-05 "a fixed test code is the worse trade" call in `auth.ts`, on the
08-17 evidence that the password fallback fails in practice even when the notes spell it out. The
password stays enabled as the second door.

**Why it is safe, in one paragraph:** the seam is better-auth's own `generateOTP` option, and every
vendor call site reads `opts.generateOTP(...) || defaultOTPGenerator(opts)` — so returning
`undefined` for every other address keeps every rider on stock random codes, byte-for-byte
(verified in the installed 1.6.23 source; pinned by `apps/api/test/auth-otp.test.ts`). Expiry
(5 min), the 3-attempt cap, all rate limits and enumeration-safety are untouched — the change pins
a code's VALUE for one account, never a guard. Scoped to the `sign-in` type only; a
forget-password or change-email code for the address stays random. Blast radius: one static
credential to one demo account (a saved drive, no admin role, no staged-content access) — the same
exposure class as the demo password that already exists.

**Verified before commit, end-to-end, not just by unit test:** an ephemeral API instance off HEAD
(`PORT=8999`, real env, real DB) — `send-verification-otp` for the review address → 200, then
`sign-in/email-otp` with the fixed code → **200 with a real session**; the same fixed code for a
different address → **400 INVALID_OTP** (and the failed attempt created no user row). The unit
tests pin the scoping (address, type, case-insensitivity, env-unset = off) and the vendor fallback
shape; the wiring test pins that the plugin actually passes `reviewFixedOtp`.

**The rollout ORDER, because the reply depends on it:**

1. **Push** (founder — a push deploys the API at 100%; the commit carries `auth.ts`, the test, and
   the re-encrypted env files, and Cloud Run decrypts `.env.production` at boot).
2. **Verify against production** exactly as the ephemeral pass did, and only then trust it:
   `POST https://api.skipper.fm/api/auth/email-otp/send-verification-otp` with the review address,
   then `POST …/sign-in/email-otp` with the fixed code → expect 200. (One Resend email to the
   catch-all per send — noise, not spend.)
3. **Enter the code in App Store Connect** — App Review Information is the reviewer-visible home:
   **the demo "password" field shows the CODE** (founder call, 2026-08-17 — see below), and the
   live notes carry it via the `{{REVIEW_OTP_CODE}}` substitution.
4. **Paste §15b's reply** (substituting the code for `NNNNNN`), **attach the code-step
   screenshot**, and click **Resubmit to App Review**.

**The same evening, the demo account's PASSWORD ROW WAS REMOVED (founder call, 2026-08-17),** and
the ASC "password" field now shows the fixed code instead. The chain that forced it: the ASC
credential pair is what a reviewer types wherever the app asks, so the field should carry the value
the app's actual flow wants — the code — but the account still HAD a real password, and the
delete-account screen demands a password from any account holding a `credential` row
(`app/settings.tsx` resolves the proof at tap time via `listAccounts`). A reviewer testing
5.1.1(v) would have stalled on a password no longer shown anywhere. With the row gone the account
is passwordless end to end: sign-in AND deletion both resolve to the code flow (deletion reuses
OTP type `'sign-in'`, so the SAME fixed code confirms it), and deleting the demo account is
self-healing — the next fixed-code sign-in recreates it (fresh grant, no saved drive; re-seed the
demo drive if a reviewer deletes it). Verified on prod immediately after: the old password →
**401**, the fixed code → **200**. ⚠ Consequences worth remembering: "Use a password instead" now
FAILS for the demo account with any input (nothing directs a reviewer there any more — §15b's
reply and §10's notes are both OTP-only); and the OTP path is the ONLY door, so §15d's
env-unset/rollback warning above is now about total lockout, not degradation — the recovery is
server-side (set a password via the API, or re-set the env).

⚠ **If the deploy is ever rolled back or `REVIEW_OTP_CODE` unset, the feature turns OFF silently**
(`reviewFixedOtp` returns `undefined` and the review address gets random codes again) — the
password path is what still works in that world, which is exactly why it stays enabled. Nothing
warns; §15b's promise to Apple is what breaks. Check the env var before any future round.
