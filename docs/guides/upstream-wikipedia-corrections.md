# Upstream Wikipedia corrections — drafts for a human to file

**Status:** 📝 **DRAFTED 2026-08-03, UNFILED.** Three talk-page posts for the three `active`
`poi_overrides` rows sitting at `upstream_status = 'not_filed'`. Every claim below was re-verified
against the LIVE article and the LIVE source on 2026-08-03 — all three errors still stand. Delete a
draft's section and set the row's `upstream_status` → `filed` (+ `upstream_url`) once it is posted;
delete this file when all three are filed.

## Why this is a human's job

Posture from [`../decisions/fact-overrides-and-veracity.md`](../decisions/fact-overrides-and-veracity.md):
**agent drafts, human submits.** Wikipedia's bot policy (WP:BOT) and COI norms rule out an agent
editing directly. We correct these locally in `poi_overrides` so the Skipper's clips are right; fixing
the source is the other half of the deal, and the correction only exists because a rider would
otherwise hear a confidently-narrated error.

**Talk page, not a direct edit** — for each of these we are an outside party asserting a correction
against text that is already cited. Proposing it on the talk page with the source is the low-friction,
low-COI move; a drive-by edit to a cited sentence invites a revert.

⚠ **Verify before you post.** These drafts quote sources an agent fetched; read the source yourself
first. Anything below marked ⚠ is a known weakness in the argument, not a formality.

---

## 1. Emerald Bay State Park — "Leonard Palme" → "Lennart Palme"

**Article:** [Emerald Bay State Park](https://en.wikipedia.org/wiki/Emerald_Bay_State_Park) ·
**Talk:** [Talk:Emerald Bay State Park](https://en.wikipedia.org/wiki/Talk:Emerald_Bay_State_Park) ·
**Override row:** `40cb1b47` · **Confidence: HIGH — file this one.**

**Current text:** "The architect was Leonard Palme, who was hired by his aunt Lora Josephine Knight to
design and build Vikingsholm."

**The argument, and it is unusually clean: the article contradicts the source it already cites.** That
sentence's own footnote is an archived vikingsholm.org history page, and that page reads: *"She
commissioned her nephew by marriage, Lennart Palme, a Swedish architect, to design the plans."* So this
needs no new source at all — only that the sentence be brought into line with its existing one. (It
also fixes a second, smaller error in the same clause: **nephew by marriage**, not "his aunt".)

> **Architect's name: "Lennart", not "Leonard"**
>
> The article currently says "The architect was Leonard Palme, who was hired by his aunt Lora Josephine
> Knight". The source already cited for that sentence — the archived vikingsholm.org history page —
> spells it differently: "She commissioned her nephew by marriage, Lennart Palme, a Swedish architect,
> to design the plans."
>
> "Lennart Palme" is also the spelling used by other coverage of the house, and it is the expected form
> for a Swedish-born architect; "Leonard" appears to be an anglicisation that crept in here.
>
> Proposed: "The architect was Lennart Palme, a Swedish-born architect and the nephew by marriage of
> [[Lora Josephine Knight]], who commissioned him to design Vikingsholm." That matches the cited
> source on both the spelling and the relationship. Any objection to my making the change?

⚠ **The override row's own stated reason is wrong and should be corrected in the admin console.** It
says the correct spelling is what "Wikipedia's own Vikingsholm article" has — but the
[Vikingsholm](https://en.wikipedia.org/wiki/Vikingsholm) article names **no architect at all** (it says
only "Knight and her architect travelled to Scandinavia"). Verified 2026-08-03: zero occurrences of
"Palme". Do not use that argument in the post; the archived footnote above is the real evidence.

⚠ Row's `source_url` is `https://vikingsholm.com/`, which **did not respond** on 2026-08-03 (connection
reset, twice, two different clients). Not evidence it is gone — but do not cite a dead link. The
archived vikingsholm.org page the article already cites is the better citation anyway.

---

## 2. Pope Estate — wrong builder AND wrong decade

**Article:** [Pope Estate](https://en.wikipedia.org/wiki/Pope_Estate) ·
**Talk:** [Talk:Pope Estate](https://en.wikipedia.org/wiki/Talk:Pope_Estate) ·
**Override row:** `4077fb42` · **Confidence: HIGH on the facts; needs care because TWO places are wrong.**

**Current text:** "The home was originally built by Lloyd Tevis, former president of Wells Fargo Bank,
in the 1880s."

⚠ **The infobox is wrong too** — `built = {{Start date|1884}}`. The override only rewrites the prose (it
is a find→replace on the fetched extract, and the infobox is not in the extract), so an upstream fix has
to cover both or the article will contradict itself.

**Source, re-read live 2026-08-03** —
[Tallac Historic Site history](https://taylortallac.org/history-of-tallac-historic-site/), from the
site's own operator: *"Baldwin leased the land to George Tallant in 1894, and Tallant built the original
2,000 square feet of the Pope House. In 1899, Baldwin sold the property to the Tevis family after
Tallant decided to move."*

> **Builder and date: George Tallant, 1894 — not Lloyd Tevis in the 1880s**
>
> The article says the home was "originally built by Lloyd Tevis, former president of Wells Fargo Bank,
> in the 1880s", and the infobox gives a build date of 1884.
>
> The Tallac Historic Site's own published history says otherwise: Baldwin leased the land to George
> Tallant in 1894, Tallant built the original ~2,000 sq ft of the Pope House, and Baldwin sold the
> property to the Tevis family in 1899 — after it was built.
> https://taylortallac.org/history-of-tallac-historic-site/
>
> That makes the Tevis family the second owners rather than the builders, and moves the construction
> date from the 1880s to 1894.
>
> Proposed: "The home was built in 1894 by George Tallant, who leased the land from [[Elias Jackson
> Baldwin|Lucky Baldwin]]; Baldwin sold the property to the Tevis family in 1899." — and the infobox
> `built` date changed from 1884 to 1894 to match. Does anyone have a source for the 1884/Tevis version
> that I should weigh against this?

⚠ The article's build-date claim may trace to the **NRHP nomination** (the infobox carries
`refnum = 87000495`). If the nomination form itself says 1884, expect pushback — and the honest
resolution is probably to present both ("listed as 1884 in the NRHP nomination; the site's operator
history dates it to 1894"), not to simply overwrite. Worth pulling the nomination PDF before posting.

---

## 3. Chambers Lodge — "first established in 1854" → 1863

**Article:** [Chambers Lodge, California](https://en.wikipedia.org/wiki/Chambers_Lodge,_California) ·
**Talk:** [Talk:Chambers Lodge, California](https://en.wikipedia.org/wiki/Talk:Chambers_Lodge,_California) ·
**Override row:** `e6b1d6ca` · **Confidence: MEDIUM — file last, or not at all. See the caveat.**

**Current text:** "It was one of the oldest recreational lodges on Lake Tahoe, first established in
1854." — **and it is CITED**, to a 24 Nov 1968 newspaper item ("Perini Group purchases Tahoe's Chambers
Lodge"). This is the one draft that argues against a sourced claim, so it has to engage that source
rather than talk past it.

> **Founding date: 1863 rather than 1854?**
>
> The article gives 1854 as the founding date, cited to a 1968 newspaper item. Several accounts of the
> site instead date it to 1863, when John Washington McKinney established Hunter's Retreat here — for
> example https://donsnotes.com/tahoe/chambers-landing.html ("started by John Washington McKinney when
> he founded Hunter's Retreat in 1863").
>
> 1854 also sits awkwardly against the wider settlement history of the west shore, which is generally
> dated to the 1860s.
>
> I don't want to overwrite a cited date on the strength of self-published pages. Does anyone have
> access to the 1968 article, or to a stronger source either way? If the 1968 piece is the only
> support for 1854, the two dates may be worth presenting side by side.

⚠ **This draft is deliberately a QUESTION, not a correction.** `donsnotes.com` is a personal notes site
— by Wikipedia's sourcing standards it is not a reliable source and will not, on its own, displace a
newspaper citation. The override row also names the Rubicon Trail Foundation, tahoecountry.com and
L.W. Currey as agreeing; **none of those was re-verified on 2026-08-03**, and finding one that qualifies
as an RS is the actual prerequisite for this filing.
⚠ Our local override is still correct to apply regardless — we are grounding a narration, not writing an
encyclopedia, and the founder adjudicated it from a `--veracity` finding on 2026-06-09.

---

## Not on this list

**Tahoe Keys** (`796430c6`) is `active = false` — Wikipedia removed the dated construction sentence, so
there is nothing left to file. It stays on the books for provenance; do not revive it.

## After filing

Per row: `upstream_status` → `filed`, `upstream_url` → the talk-page section or diff URL, via the admin
console (`poi_overrides` is curated there; the seed CLI was removed 2026-06-19). ⚠ Filing does **not**
retire the local override — the fix has to actually land upstream AND propagate through a re-fetch
first. A merged correction eventually makes the `find` string stop matching, which the studio pipeline
warns about; that warning is the signal to retire the row, and `active = false` is how (never a delete).
