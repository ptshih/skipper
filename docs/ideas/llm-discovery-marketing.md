# LLM answer-discovery (GEO/AEO) as a distribution wedge

> **Status:** idea / research pass — **2026-07-28**. UNBUILT, awaiting a founder call. Written during
> App Store review per the `TODO.md` ask. **Recommendation: do the cheap subset (~half a day, $0),
> SHELVE the programmatic corpus→web build.** Every claim below is labelled by source quality —
> `[primary]` (provider/standards/legal docs, peer-reviewed), `[measured]` (first-party network
> telemetry published with methodology), `[vendor]` (SEO/PR firm marketing with unauditable method),
> `[observed]` (live queries I ran on 2026-07-28, reproducible). GEO advice is ~90% `[vendor]` by
> volume, so the labels are the load-bearing part of this doc. Reconciles with
> [autio-content-moat.md](../research/autio-content-moat.md) in §2 — read that first.

## 1. TL;DR

The founder ask's premise — *"LLM answer-discovery is the one surface where a region-deep character
companion can beat a 25k-story catalog, because the signal is entity presence + citable facts, not
breadth"* — is **half right, and the wrong half is the expensive half.**

- **Right:** the answer surface genuinely is not the comparison grid, our corpus genuinely is the kind
  of material that gets cited, and the ~$0 entity-legibility work is worth doing on the merits.
- **Wrong:** the corpus is *downstream of Wikipedia*, and Wikipedia is the single most-cited source in
  the answer surface. **We cannot out-cite our own source.** Publishing our POI stories as web pages
  competes with the page the model already prefers, in a strictly worse-attributed, CC BY-SA-encumbered
  restatement of it. That kills the biggest build in §5.3 on the merits, not on cost.

What I'd actually do:

| | Move | Cost | Verdict |
| --- | --- | --- | --- |
| **A** | Extend the existing `Base.astro` JSON-LD `@graph` with `MobileApplication` + `sameAs` | ~1h | **DO** — highest leverage single change (§5.2, §4.5) |
| **B** | One honest answer-shaped page on skipper.fm (what/where/what it costs, sourced) | ~2–3h | **DO** — the only content shape the peer-reviewed evidence supports (§4.3) |
| **C** | Name AI crawlers in `robots.txt` | ~10 min | **SKIP** — functional no-op today + a real drift footgun (§5.1) |
| **D** | Programmatic region/POI pages from the corpus | days–weeks | **SHELVE** (§5.3) |
| **E** | Off-domain presence | ongoing, founder-owned | **DO the free half only** (§5.4) |

**The biggest thing I could not resolve:** whether any of this can be *measured*. For an app, an
LLM-sourced install is very likely invisible in every instrument we have (§6). A channel you cannot
attribute is a channel you cannot iterate on, and iterating is the entire premise of GEO.

## 2. Reconciling with `autio-content-moat.md` (the founder-blessed DON'T)

That doc's ruling is: **the comparison table is a trap and out-publishing a content factory plays FOR
Autio's niche-subscription plateau.** Two things follow that this doc must respect, and one that it
gets to sharpen.

**Respected — the trap is real and my §5.3 shelve is a *stronger* version of it.** `TODO.md` argues
per-POI story pages escape the trap because they're entity pages, not listicles — target *"what's the
story behind Vikingsholm,"* not *"best road trip app."* That distinction is legitimate; those are
different query classes and per-POI pages are genuinely not a comparison factory. But it fails for a
reason the original doc didn't have: on the factual-story query, the retrieval winner is **Wikipedia,
which is our upstream** (§4.4). We'd be publishing a derivative of the incumbent answer, then asking
the model to prefer the derivative. That's a worse position than the comparison grid — at least there
we lose to a competitor rather than to our own supplier.

**Respected — "refuse the category" survives contact with GEO.** Nothing here proposes we describe
ourselves as a tour app in a field of tour apps. Move B is a *self-description* page (who this is for,
where it works, what it costs, what it does not cover), not a competitive comparison. The
`autio-content-moat.md` steer *"don't get drawn onto comparison-table turf in our own copy"* is
compatible with an entity page and incompatible with a "Skipper vs Shaka Guide" page. Do not write the
second one — and note that our honest region-limits (Tahoe only) would make it a **losing** table.

**Sharpened — one line of that doc needs an amendment.** It says the property that makes us *"invisible
to Autio's SEO machine is the same one that makes us uncopyable."* True as strategy, but §4.5 shows
invisibility has a mechanical cost the doc didn't price: **a generic brand name in a crowded entity
space.** "Skipper" collides with a cluster of *boating* apps `[observed]` — while our persona is
deliberately a road-trip guide and NOT a boat (`docs/decisions/cut-intro-frame-and-persona-kit.md`
territory; the persona kit is single-sourced in `packages/studio/src/persona/skipper.ts`). Refusing the
category is free; being *unresolvable as an entity* is not, and it's fixable for an hour of work.

**And the honest hole stays open.** `autio-content-moat.md` §"the honest hole" says acquisition is the
thing still to solve. **This doc does not solve it either.** It finds a cheap way to not be
*mis-resolved* when someone already looking for us asks, and it kills a plausible-sounding expensive
answer. Those are both worth having. Neither is a channel.

## 3. What the answer surface actually looks like for *our* query `[observed]`

Before any theory: I ran the actual queries a rider would ask, on 2026-07-28, through a
retrieval-grounded search tool (a web index + an LLM synthesizing over the retrieved pages — the same
*shape* as ChatGPT search / AI Overviews, **not** the same system; treat as a proxy, not a measurement).

Queries: *"best audio tour app Lake Tahoe driving scenic drive narrated"*, *"reddit … best audio tour
app recommendation Lake Tahoe"*, *"skipper.fm … AI narrated driving audio tour app Tahoe"*.

**What came back, consistently:**

1. **OTA / marketplace listings** — TripAdvisor, Viator, Expedia, Travelocity, and (notably) a
   `activities.marriott.com` white-label. These dominated. The same Action Tour Guide product appeared
   under five different marketplace hostnames.
2. **App store product pages** — `apps.apple.com` and `play.google.com` listings surfaced as ordinary
   web results and were used in the synthesized answer.
3. **Vendor tour pages** — `shakaguide.com`, `actiontourguide.com`, `guidealong.com`, `voicemap.me`.
4. **Zero Reddit threads.** On the explicit Reddit-targeted query, the engine returned marketplace
   listings instead — i.e. there is no meaningful Reddit corpus for this vertical to be present in.
5. **Zero Autio.** For the *regional* query, the incumbent whose SEO factory owns *"best road trip
   apps"* was absent. Consistent with `autio-content-moat.md`'s "their real density is the parks."
6. **Zero Skipper**, and the synthesizer explicitly reported that it found no such app.

**Four consequences, and they reorder the founder's candidate list:**

- The generic `[vendor]` finding that *"Reddit is ~40% of AI citations"* (§4.4) is a **cross-vertical
  aggregate that does not hold in this vertical.** Chasing r/roadtrip because an industry report says
  Reddit is #1 would be optimizing against someone else's average. This is the single most useful thing
  the observation pass produced.
- **The App Store listing is part of the retrieval corpus.** It is already written, already indexed,
  and currently in review. That makes ASO metadata a GEO surface for free — and makes the `TODO.md`
  Yosemite metadata list (top of that file) quietly part of *this* workstream too.
- **Marketplace listings are where this vertical's answers come from.** That is candidate #4
  (off-domain presence) and it is the highest-return item — but it is a business-development play
  (become a Viator/GetYourGuide supplier), not an engineering one, and it collides with the free-app +
  credits model (`docs/decisions/credit-ledger.md`). Flagged, not recommended, in §5.4.
- Autio's absence here means the doctrine question ("do we fight the SEO factory?") is **moot for the
  regional query**. We would not be fighting Autio. We'd be fighting Viator.

## 4. What the evidence says, by source quality

### 4.1 What the model providers actually control, and what they say `[primary]`

Every major provider documents a robots.txt lever. The ones that matter:

- **OpenAI** ([developers.openai.com/api/docs/bots](https://developers.openai.com/api/docs/bots)):
  `OAI-SearchBot` "surfaces websites in ChatGPT's search features" and — the operative sentence —
  *"Sites that are opted out of OAI-SearchBot will not be shown in ChatGPT search answers."* `GPTBot`
  is training-only. `ChatGPT-User` is user-initiated and *"robots.txt rules may not apply"*; it is
  *"not used to determine whether content may appear in Search."*
- **Anthropic** ([support.claude.com article 8896518](https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)):
  `ClaudeBot` (training), `Claude-User` (user-initiated fetches), `Claude-SearchBot` (search quality).
  Each blockable by name; `Crawl-delay` honored as a non-standard extension.
- **Google** ([google-common-crawlers](https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers)):
  `Google-Extended` is a **usage token, not a crawler** — it governs whether already-crawled content
  trains Gemini. Google states flatly that it *"does not impact a site's inclusion in Google Search"*
  and *"is not used as a ranking signal."* Blocking it therefore does **not** remove you from AI
  Overviews, which run off Googlebot.

**Implication:** the only crawler-level lever that plausibly gates *citation* is `OAI-SearchBot`, and
we already permit it. Our current blanket `User-agent: * / Allow: /` is, by the letter of the
providers' own docs, already the maximally-discoverable posture. **There is no posture upgrade
available.** (This is the finding that reduces candidate #1 to a no-op — see §5.1.)

### 4.2 Two things that are widely sold and do not work `[primary]`

- **`llms.txt` is not consumed by any provider that documents its behavior.** The proposal
  ([llmstxt.org](https://llmstxt.org/), Jeremy Howard, 2024-09-03) is informal, community-run, and
  makes **no claim of provider adoption** — its cited adopters are documentation projects and tooling.
  Google's AI-features guidance now says outright: *"You don't need to create new machine readable
  files, AI text files, markup, or Markdown to appear in Google Search (including its generative AI
  capabilities), as Google Search itself doesn't use them"*
  ([ai-features](https://developers.google.com/search/docs/appearance/ai-features)). Neither OpenAI's
  nor Anthropic's crawler documentation mentions it. A `[vendor]` crawl of 137k sites reportedly found
  97% of published `llms.txt` files were never requested by any bot — treat the exact number as
  unverified, but it is directionally consistent with the primary sources. **Do not build one.**
- **There is no magic schema.** Same Google page: *"There's also no special schema.org structured data
  that you need to add"* and *"There are no additional requirements to appear in AI Overviews or AI
  Mode."* Searching for an OpenAI equivalent returns **only `[vendor]` content** (including an
  unsourced *"2.5x higher chance of appearing in AI answers"* claim that traces to no study). **No
  provider documents structured data as a citation input.** This does not make JSON-LD worthless — see
  §5.2, where the justification is entity disambiguation and rich results, not AI citation.

### 4.3 What peer-reviewed work says does work `[primary]`

The one non-vendor study of the question: **Aggarwal, Murahari, Rajpurohit, Kalyan, Narasimhan,
Deshpande, "GEO: Generative Engine Optimization," KDD 2024** ([arXiv:2311.09735](https://arxiv.org/abs/2311.09735)).
Nine content methods against a benchmark of real queries:

- **Best: adding statistics (~+31%), citing sources (~+30%), adding quotations (~+28%), fluency
  optimization (~+27%)** on their position-adjusted visibility metric.
- **Worst: keyword stuffing — "little to no improvement," below baseline.** Classic SEO reflexes
  actively fail here.
- **Effects are domain-dependent** (cite-sources helps most on factual queries).
- **Lower-ranked sites benefit disproportionately** — they report up to a 115% visibility lift for a
  site ranked fifth, while top-ranked sites sometimes *lost* visibility.

**Read for us:** the last point is the genuinely encouraging one for a zero-authority domain, and the
first two say the winning shape is *cited, quantified, honest prose* — which is exactly what a
Wikidata-grounded project can write without inventing anything. This is the entire evidentiary basis
for Move B. Caveats: one paper, 2024, on then-current engines, using a proxy visibility metric rather
than measured referral traffic. It is the best evidence available and it is thin.

### 4.4 Which sources get cited — and the one number that decides §5.3 `[vendor]`

All published citation-share studies are vendor or PR-wire, with unauditable methodology. The most
cited synthesis (a PR firm's "AI Platform Citation Source Index 2026," claiming ~680M citations
consolidated from six prior studies) reports **Reddit #1 overall (~40%)**, **ChatGPT favoring Wikipedia
(~48% of its sources)**, and top-15 domains capturing ~68% of all citation share. Treat the decimals as
marketing. Treat the **ordering** — Wikipedia and Reddit at the top, far above any commercial site — as
probably real, because it is stable across independent vendors with different methods and it matches
what §3's live queries did.

**And it is the argument against the corpus→web build.** Our `pois.fact_sheet` is verbatim spans
selected from Wikipedia (`docs/decisions/corpus-enrichment.md`); `pois` is deduped by Wikidata QID.
So on the exact factual query a per-POI page targets, **the model's preferred source is the document
ours is derived from.** We would be asking a retrieval system to prefer a paraphrase over its original,
on a domain with no authority, at a moment when it already has the original indexed. That is not a
close call.

### 4.5 The entity problem nobody has named yet `[observed]`

Searching for the brand returns a cluster of *other* Skippers — a Signal-K **boating** instrument app,
"Smart Skipper" (boat monitoring), "Skipper: Auto Skip Podcast Ads," a NOAA charting app. The name sits
in a dense, well-established entity neighborhood, and **the dominant sense is nautical** — the precise
association the persona deliberately rejects (road-trip guide, *not* a boat).

This is a real, cheap-to-mitigate GEO liability. Entity disambiguation is one of the few things
structured data unambiguously does: `sameAs` links a name to its authoritative external identities.
Today `Base.astro` emits `Organization` + `WebSite` with **no `sameAs` and no application node** — so
nothing on the open web machine-links "Skipper" the brand to the App Store listing that *is* the
product. That's Move A.

### 4.6 Size of the prize `[measured]` + `[vendor]`

- **AI assistants are ~0.13–0.3% of referral traffic**, against ~26% for Google organic; one framing
  puts organic at ~345× the volume of ChatGPT + Gemini + Perplexity combined `[vendor]`, Similarweb-derived.
  The counter-argument — AI traffic converts far better (~7.1% cited) — is also `[vendor]` and also
  plausible. Both should be held loosely.
- **Cloudflare Radar `[measured]`** ([blog.cloudflare.com/ai-search-crawl-refer-ratio-on-radar](https://blog.cloudflare.com/ai-search-crawl-refer-ratio-on-radar/))
  publishes crawl-to-refer ratios with an explicit method (HTML requests by user-agent ÷ requests
  bearing that platform's `Referer`). Reported ratios run from ~1.5:1 (DuckAssistBot) and ~5:1
  (Googlebot) to four- and five-figure ratios for the AI training crawlers. **Cloudflare's own stated
  caveat is the important part:** native-app referrals *"do not include a `Referer:` header"*, so the
  ratios *"may overstate… but it is unclear by how much."* Which is to say: **the industry's headline
  number for "AI takes and doesn't give back" is measured with an instrument that structurally cannot
  see mobile-app-originated referrals.** For a company whose entire conversion event happens inside a
  phone app, that caveat is not a footnote — it is the whole story (§6).

## 5. The four candidates, sized

Each gets: cost / plausible return / what would have to be true / how you'd know it failed.

### 5.1 AI-crawler posture in `robots.txt` — **SKIP** (no-op, plus a footgun)

`apps/site/public/robots.txt` is `User-agent: * / Allow: /` + a sitemap line.

- **Cost:** 10 minutes.
- **Return: zero, mechanically.** Per §4.1 we already permit every documented AI crawler; a blanket
  allow is already maximal. Adding named `Allow:` groups changes no crawler's behavior.
- **It is worse than zero, because of a rule most people get wrong.** Google's robots spec `[primary]`:
  *"Only one group is valid for a particular crawler… User agent specific groups and global groups (\*)
  are not combined."* So the moment you write a `User-agent: GPTBot` group, GPTBot **stops inheriting
  the `*` group forever**. Any future `Disallow:` added to `*` (a staging path, an admin route, a
  paid-endpoint guard) silently will not apply to the six bots you helpfully named. You'd be trading
  zero benefit for a permanent, silent drift hazard in a file nobody re-reads.
- **What would have to be true to reverse this:** a provider starts requiring opt-*in* by name, or we
  put the site behind a CDN whose default is deny-AI-bots (Cloudflare ships such toggles) — then an
  explicit allow-list becomes load-bearing. Neither is true today.
- **The one real item in this bucket:** confirm the sitemap covers any page Move B adds. `sitemap()` in
  `astro.config.mjs` does this automatically for new pages under `src/pages/` — so it is already true,
  and it stays true only as long as nobody adds pages outside that convention.

### 5.2 JSON-LD on skipper.fm — **DO, but not the version the ask describes**

**The ask is out of date:** `apps/site/src/layouts/Base.astro:32` already emits a JSON-LD `@graph`
(`Organization` + `WebSite`), with a comment noting it's deliberately honest (no fake ratings). So this
is not "add structured data," it's "extend it."

- **Cost:** ~1 hour, one file, no new dependency, no build change, zero spend.
- **What to add:** a `MobileApplication` (or `SoftwareApplication`) node — `name`, `applicationCategory:
  "TravelApplication"`, `operatingSystem: "iOS"`, `url` → the App Store listing, `offers` with
  `price: "0"` (true: free app, premium is credits) — and **`sameAs` on the `Organization`** pointing at
  the App Store URL and any owned profile. `TouristTrip` and `TouristAttraction` are real core
  schema.org types (`TouristTrip`: Thing > Intangible > Trip > TouristTrip, schema.org v30.0
  `[primary]`) but I would **not** use them yet: they describe an itinerary or a place, and we should
  not assert a specific itinerary on a page that doesn't render one.
- **Plausible return:** *not* AI citation — Google explicitly disclaims that (§4.2). The return is
  **entity disambiguation** against the boating Skippers (§4.5) and eligibility for ordinary rich
  results. Small, but the cost is an hour and the correctness is unambiguous.
- **What would have to be true:** that anything reads it. Google does for rich results `[primary]`;
  whether any LLM does is undocumented and I could not establish it either way. **Do this because it is
  correct metadata about a real product, not because a vendor blog promised a lift.**
- **How you'd know it failed:** Search Console shows the new type parsed but never enhanced-eligible;
  brand-name queries still resolve to boating apps six months out. Failure here is cheap and silent —
  which is the honest reason to do it: it costs an hour and the downside is an hour.
- **⚠ Do not fabricate `aggregateRating` or `review`.** Zero users. That is `[primary]` a Google spam
  policy violation and it torches the one asset (honesty) the whole positioning rests on.

### 5.3 Programmatic region/POI pages from the corpus — **SHELVE**

The biggest build and, per `TODO.md`, "the corpus→web lever no competitor can match." I think it's a
trap, for four reasons, in descending order of how much they'd survive a counter-argument.

1. **You cannot out-cite your own source (§4.4).** Our POI stories derive from Wikipedia, and Wikipedia
   is the most-cited source in exactly this query class. A derivative on a zero-authority domain does
   not displace the original.
2. **⚠ CC BY-SA ShareAlike, and it is a strategic problem, not a compliance chore `[primary]`.**
   Wikipedia text is CC BY-SA 4.0. Per [Wikipedia:Reusing Wikipedia content](https://en.wikipedia.org/wiki/Wikipedia:Reusing_Wikipedia_content),
   a reuser must credit via link/URL/author list, include a licensing notice linking the license, and —
   *"if you make modifications or additions to the page you re-use, you must license them under the
   Creative Commons Attribution-Share-Alike License 4.0 or later."* Publishing `fact_sheet` verbatim
   spans on skipper.fm makes those pages CC BY-SA derivatives. **Meaning: the "asset Autio can't
   match" would be published under a license that explicitly lets Autio take it.** Whether the
   LLM-*written* narration script (facts are uncopyrightable; the expression is ours) is itself a
   derivative is a genuine grey zone I cannot resolve — it needs counsel, not an agent. Today the
   invariant is satisfied *inside the app*, where `narrations.attribution` rides the audio. The web
   changes the analysis.
3. **Scaled-content-abuse exposure `[primary]`.** Google's spam policy defines scaled content abuse as
   *"when many pages are generated for the primary purpose of manipulating search rankings and not
   helping users,"* naming *"using generative AI tools… to generate many pages without adding value."*
   Automation is not itself the violation — value is the test — but "a few hundred LLM-written pages
   restating Wikipedia" is close enough to the described pattern that it should not be waved off.
4. **Intent mismatch.** *"What's the story behind Vikingsholm"* is idle curiosity, answered in the
   answer box, with no install intent. The click-through-to-install rate is a product of two small
   numbers.

- **Cost if built anyway:** a new dynamic-route surface in a currently-static Astro app, a build-time
  corpus export (the API is behind the wire contract; the DB is not public), a per-page attribution
  renderer, a license-notice audit, and a release-gate join so **staged** narrations never leak to the
  web (`regions.released_at` / `narrations.released_at` —
  `docs/decisions/region-release-gate.md`). Days minimum, and it puts the corpus on a public surface
  where the release latch is now load-bearing in a second place.
- **What would have to be true to greenlight:** (a) counsel clears the ShareAlike question; (b) we can
  point to a query class where we'd be the *best available* answer rather than a paraphrase of one —
  the honest candidate is **the drive experience itself** (*"is there a narrated audio tour of the
  West Shore?"*), which is one hub page, **not** a per-POI factory; and (c) Move B has already shown
  that a single page can get indexed and retrieved at all. **(c) is the cheap prerequisite, and it is
  Move B — which is the actual reason to do Move B first.**
- **How you'd know it failed:** crawl logs show the pages fetched but never referred; Search Console
  shows impressions on POI-name queries with ~0 clicks (the answer box ate them); no measurable
  branded-search lift (§6).

### 5.4 Off-domain presence — **DO the free half; the paid half is a founder call**

Per §3 this is where the answers in this vertical actually come from, so it's the highest-return
candidate. It splits cleanly.

- **Free half — DO.** The **App Store listing is already a retrieval surface** (§3) and is already
  written (`docs/guides/app-store-submission.md`). The work is: keep it accurate, and treat the
  `TODO.md` "when Yosemite ships" metadata list as part of this workstream rather than an App Store
  chore. ⚠ Nothing here touches App Store Connect while the build is in review.
- **Free half — DO, with discipline.** Genuine participation in the places riders ask (r/tahoe,
  r/roadtrip, Tahoe forums). This is founder-owned, not agent-owned, and the rule is the obvious one:
  disclose, answer the question asked, don't astroturf. **But calibrate it down** — §3 found no Reddit
  corpus for this vertical, so this is planting rather than harvesting, and the `[vendor]` "Reddit is
  40% of citations" stat does not apply here.
- **Paid/BD half — NOT recommended now, flagged as the real answer.** Every competitor in §3 is on
  Viator / TripAdvisor / Expedia / GetYourGuide, several under white-label (Marriott). That is the
  channel. It is also a different business: marketplaces sell a *bookable product* at a *price* with a
  *commission*, which collides with free-app-plus-credits (`docs/decisions/credit-ledger.md`) and with
  charm-not-scale. Naming it as the honest highest-return option and declining it is a legitimate
  outcome — but it should be declined *knowingly*, not by omission. **This is the one item that would
  actually move the `autio-content-moat.md` "honest hole," and it isn't an engineering task.**
- **⚠ Reddit's content is licensed, not free-floating.** Reddit has paid licensing deals with Google
  (~$60M/yr, Feb 2024) and OpenAI (~$70M/yr, May 2024) `[vendor]`/trade press. Practical effect: Reddit
  content reaches those models through a commercial pipe, so a post's visibility is subject to
  Reddit's terms and API, not our robots.txt. It's a channel we rent on someone else's terms.

## 6. ROI estimate — and why the honest answer is "unmeasurable"

**Cost of the recommended subset:** ~half a day of builder time. $0 marginal spend — no `enrich`, no
TTS, no Cloud Run. That is the entire reason it clears the bar; it is not clearing a return threshold.

**Return, upper-bounded honestly.** I could not obtain search-volume data for *"lake tahoe audio tour"*
without a paid keyword tool, so I will not invent one. What can be reasoned: the query is
region-specific, seasonal, low-volume, and currently answered by four established products. The
addressable slice for a brand-new, Tahoe-only, iOS-only app is small in absolute terms — plausibly a
handful to low-tens of installs per month at *best*, and quite possibly zero for months. Against half a
day of work that's still fine; against the §5.3 build it is not remotely fine.

**⚠ The measurement problem is the real finding, and it is worse than it looks.** Trace the actual
path: rider asks ChatGPT on their phone → gets told "try Skipper" → **switches to the App Store and
types "skipper"**. Now check each instrument:

- **PostHog** (`apps/mobile/src/lib/analytics.tsx`) starts at first launch. Blind to everything upstream.
- **App Store Connect Sources** `[primary]` reports `Web Referrers` (domains) and `App Referrers`
  (apps). But Apple attributes iOS taps from **non-Safari browsers to the browser app**, and a tap from
  inside the ChatGPT app lands in `App Referrers` at best. The far more likely path — the user retypes
  the name — books as **`App Store Search`**, indistinguishable from every other branded search.
- **Cloudflare's own crawl-to-refer caveat (§4.6)** says native-app referrals carry no `Referer` at all.
  The industry can't see this path either; they just don't say so in the headline.

**So the only honest instrument is a proxy: branded App Store Search impressions for "skipper" +
qualifiers, tracked as a trend.** Baseline it the week the app goes live, before doing any of this.
⚠ That baseline is the one time-sensitive item in this doc — it expires the moment the app ships, and
it costs nothing today. A second proxy: server logs for `OAI-SearchBot` / `Claude-SearchBot` /
`PerplexityBot` hitting skipper.fm (Firebase Hosting → Cloud Logging), which at least proves the
*search-purpose* crawlers found the site, distinct from training crawlers.

**Failure criteria, stated in advance** (the point of writing them now is that they're unfalsifiable
later): six months after the app is live and Move A+B have shipped, if (a) no AI search-purpose
crawler has fetched skipper.fm, and (b) branded App Store Search impressions have not moved off
baseline, and (c) a live re-run of §3's queries still returns no Skipper — **the wedge is dead, stop.**
Do not respond by building §5.3; that is the sunk-cost move this doc exists to prevent.

## 7. Pre-mortem — it's twelve months on and this was a waste

1. **Nothing was measurable, so we tuned blind.** §6. Most likely single failure. Mitigation: take the
   branded-search baseline *now*; accept up front that this is a set-and-forget, not an iteration loop.
2. **We optimized for an aggregate that didn't describe our vertical.** We built Reddit presence on the
   strength of a "Reddit is 40% of citations" stat and §3's finding held: there was no Reddit corpus
   for Tahoe audio tours to be part of. Mitigation: §3's live-query check is cheap and repeatable — re-run
   it before any off-domain investment, and trust it over the industry average.
3. **The advice changed underneath us.** GEO tactics move faster than we ship. `llms.txt` went from
   "emerging standard" to explicitly-disclaimed-by-Google inside ~18 months. Anything we build to a
   2026 vendor blog is a liability. Mitigation: the recommended subset is *only* provider-documented
   and peer-reviewed items; nothing here is a bet on a tactic.
4. **We shipped a `robots.txt` allow-list and silently un-protected a path.** §5.1's named-group
   footgun, discovered later via a leaked staging URL. Mitigation: don't do it.
5. **We published the corpus and it got scraped — legally.** §5.3(2): CC BY-SA ShareAlike means a
   competitor's ingestion of our POI pages would be *licensed*, not theft. We'd have converted the one
   asset the strategy calls uncopyable into an openly-licensed one.
6. **The pages got classified as scaled content abuse** and the *whole domain* — including the pages
   that convert — lost standing. §5.3(3). Asymmetric downside for a small upside.
7. **Staged content leaked to the web.** The programmatic build joins the corpus to a public surface;
   miss the `released_at` gate and unreleased Yosemite clips are public before the region launches —
   which also breaks the `TODO.md` "⚠ do NOT pre-announce Yosemite" rule from an unexpected direction.
8. **We won the answer and it didn't convert.** ChatGPT recommends Skipper; the rider learns it's
   Tahoe-only; they're in Utah. Region-honesty is doctrine and correct — but it means the *qualified*
   audience for an LLM answer is narrower than the query volume suggests. Not fixable by GEO.
9. **The opportunity cost was the real loss.** Half a day is genuinely cheap. The scenario where this
   was a mistake is the one where it becomes a *program* — and per `autio-content-moat.md`, a content
   program is precisely the thing that caps out at Autio's plateau. **The discipline is the deliverable:
   this is a half-day of metadata hygiene, not a channel we staff.**

## 8. What would change this answer

- A provider publishes actual publisher/citation guidance (OpenAI or Anthropic documenting what earns
  a citation, the way Google documents Search). Today none exists — §4.2.
- A measurable attribution path appears — e.g. an LLM client that passes a `Referer` on app-store
  hand-offs, or ASC surfacing AI clients distinctly in `App Referrers`. That converts this from
  set-and-forget into something worth iterating on.
- Skipper stops being Tahoe-only. Region breadth changes the qualified-audience math in §7(8), and it
  is the one thing that would make a *hub* page (not a POI factory) worth more than it costs.
- Counsel clears the §5.3(2) ShareAlike question in a way that lets us publish corpus-derived prose
  without open-licensing it. That would reopen — not settle — the programmatic build.

## Sources

**`[primary]` — provider, standards, legal, peer-reviewed:**
- OpenAI crawlers: <https://developers.openai.com/api/docs/bots>
- Anthropic crawlers: <https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler>
- Google crawlers / `Google-Extended`: <https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers>
- Google AI features guidance (the "you don't need llms.txt or special schema" statements): <https://developers.google.com/search/docs/appearance/ai-features>
- Google robots.txt spec (group precedence — the §5.1 footgun): <https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt>
- Google spam policies (scaled content abuse): <https://developers.google.com/search/docs/essentials/spam-policies>
- `llms.txt` proposal: <https://llmstxt.org/>
- schema.org `TouristTrip` (v30.0, 2026-03-19): <https://schema.org/TouristTrip>
- Wikipedia reuse / CC BY-SA 4.0 ShareAlike: <https://en.wikipedia.org/wiki/Wikipedia:Reusing_Wikipedia_content>
- App Store Connect App Analytics sources: <https://developer.apple.com/app-store-connect/analytics/>
- Aggarwal et al., "GEO: Generative Engine Optimization," KDD 2024: <https://arxiv.org/abs/2311.09735>

**`[measured]` — first-party telemetry with published method:**
- Cloudflare Radar, crawl-to-refer ratios (read the native-app `Referer` caveat): <https://blog.cloudflare.com/ai-search-crawl-refer-ratio-on-radar/>

**`[vendor]` — unauditable method; cite the ordering, never the decimals:**
- "AI Platform Citation Source Index 2026" (PR-wire, 5W): <https://www.prnewswire.com/news-releases/5w-releases-ai-platform-citation-source-index-2026-the-50-websites-that-now-decide-what-brands-are-visible-inside-chatgpt-claude-perplexity-gemini-and-google-ai-overviews-302759804.html>
- Similarweb GEO stats (AI referral share): <https://www.similarweb.com/blog/marketing/geo/gen-ai-stats/>
- Reddit×Google / Reddit×OpenAI licensing (trade press): <https://www.cjr.org/analysis/reddit-winning-ai-licensing-deals-openai-google-gemini-answers-rsl.php> · <https://time.com/6979197/reddit-openai-partnership-chatgpt/>

**`[observed]` — live queries 2026-07-28, reproducible; a proxy for the answer surface, not a measurement of it.** §3.

**Repo cross-refs:** [autio-content-moat.md](../research/autio-content-moat.md) ·
[competitive-research.md](../research/competitive-research.md) ·
[credit-ledger.md](../decisions/credit-ledger.md) ·
[region-release-gate.md](../decisions/region-release-gate.md) ·
[corpus-enrichment.md](../decisions/corpus-enrichment.md) ·
[app-store-submission.md](../guides/app-store-submission.md) ·
`apps/site/src/layouts/Base.astro` (the existing JSON-LD) · `apps/site/public/robots.txt`
