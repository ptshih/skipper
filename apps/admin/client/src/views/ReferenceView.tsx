import type { ReactNode } from 'react'
import { DataTable, type Column } from '@/components/ui/data-table'
import { SectionLabel } from '@/components/ui/section-label'
import { Badge } from '@/components/ui/badge'
import { Callout } from '@/components/ui/callout'
import { PageHeader } from '@/components/PageHeader'

// A static cheat-sheet so the operator remembers what each control does — above all which
// actions spend money or delete bytes. Pure presentation, no data fetch.
//
// DEFINITION OF DONE — this page is the operator's source of truth, and nothing here is fetched or
// tested, so it only stays accurate if it rides along. Any apps/admin change that adds/removes a
// console PAGE or run kind, or changes what an action SPENDS / DELETES / RELEASES, must update this
// file in the SAME commit (CLAUDE.md › Git workflow). Keep "Pages" in sync with the sidebar NAV
// (components/Layout.tsx) and "Run kinds" with the jobKind vocabulary (@skipper/shared › enums.ts).
export function ReferenceView() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Reference"
        description="What each part of the console does — and which actions spend money or delete data."
      />

      <Callout variant="info">
        <span className="font-medium text-foreground">The loop:</span> discover a region's POI corpus (from the
        Regions page) → enrich the story POIs into fact sheets → generate the narrations → ear-pass them on the
        POIs page (each POI's Narration tab: listen, read the script) → tune (re-synth / regenerate) → release to
        the public. The console defaults to safe — spending, deleting, and releasing are always opt-in.
      </Callout>

      <Section title="Pages">
        <Dl
          cols={['Page', 'What it does']}
          rows={[
            ['Jobs', 'Admin-triggered Cloud Run jobs, newest first — status, cost, who triggered them; click a row for run details + Cloud Run logs.'],
            ['Evals', 'Generation + Re-score runs with their pass verdict and dimension scores (g / tts / div — grounding reddens below the 0.75 gate); click a row for the per-place gate report.'],
            ['Regions', 'The regions the corpus is keyed to — each with its discovery bbox (the area Discover + Generate sweep), a live POI count, and a Draft / Released status. ⚠ A region IS a bbox, and bboxes may overlap — so a place inside two of them belongs to BOTH, and these counts deliberately do not sum to the corpus size. The POIs page shows every region a place is in, which is also the set a region release will publish it from. Discover POIs and Release both launch here — a row’s own Discover / Release button, or select multiple rows for a bulk run.'],
            ['POIs', 'The shared POI corpus — sources, enrichment, narration coverage + freshness, and per-POI curation. Discover POIs (top right) sweeps a region’s bbox into the corpus. Quick-filters across the top triage it — “Needs attention” is the combined remediation queue (stale facts, defects, unattributed or drifted clips); “Off-road” lists POIs with no road-snapped anchor in a snapped region (genuine backcountry — they fire off their centroid or never, so they won’t trigger on a drive). Open a POI for its detail sheet: Facts (with Re-fetch facts), Location (speakable anchor, the ROAD CLASS its anchor snapped to, and eligibility), Narration (play the telling; Regenerate / Re-synth / Release), and Corrections (fact-edits). An amber “minor road” chip on Location means the anchor sits on a residential or unclassified road — real pavement, but usually not one a drive takes, so the stop triggers from a street nobody is on. EXCLUDE (also on Location) hides a place that exists but can’t be told as a stop — a numbered highway, an administrative boundary: it disappears from NEW drives immediately, but audio is KEPT and already-saved drives keep the stop (a drive’s selection is frozen at build, so nobody loses a stop they spent a credit on). Restoring needs no regeneration. ⚠ ONE EXCEPTION, and it is why Exclude and Delete are both REFUSED there: a place named by a group whose FUSED telling is already RELEASED. That clip’s trigger point is derived from its surviving members on every request, so removing one MOVES a live clip inside drives riders have already downloaded, and removing the last one deletes it from them — the one case where the “frozen selection” promise does not hold. Regenerate the group’s telling first, or exclude the whole group. A reason is required and is shown as a banner on every tab of the sheet. Location also shows GROUPING when a place is part of one: the treatment (cluster or district), the title a driver would use, and the members. Grouping is read-only here — it is decided in bulk by the `classify-treatments` CLI, so a hand edit would be overwritten by the next classification. A place in a group whose FUSED telling is live carries an “in a fused clip” chip: it has no clip of its own any more, and it is NOT a generation gap — the group’s single telling names it. Those places are deliberately absent from new drives, because a rider on one block should hear one story, not nine.'],
            ['Places', 'A region’s CURATED real-world hubs + pitstops that feed the drive endpoint picker (separate from the POI/narration corpus). Each row is tagged Endpoint (a start / end / midpoint) and/or Break (a pitstop), with Featured floating the popular ones to the top of the rider’s picker, shown on a map. Coords are resolved + stored at curation, so the rider’s picker makes zero live Places calls. Curate (interactive — see Run kinds) seeds a region; Add a place is the manual escape hatch.'],
            ['Users', 'Accounts and their drive-credit ledger — Granted (lifetime cap), Used (drives generated), Remaining (live balance). Grant credits from a row to comp or top up an account; it’s free (it hands the USER generations, not a GCP spend) and append-only — there is no un-grant.'],
          ]}
        />
      </Section>

      <Section title="Run kinds" subtitle="What the console can trigger — and what each one costs.">
        <DataTable columns={RUN_KIND_COLUMNS} rows={RUN_KINDS} rowKey={(k) => k.kind} />
      </Section>

      <Section title="Preview, Apply & confirmation" subtitle="Safe by default; spending or deleting is always an explicit opt-in.">
        <Dl
          cols={['Control', 'What it does']}
          rows={[
            ['Preview', 'The dry-run button in every job dialog: shows what would change (counts, cost estimate, the queue in the run log) and touches nothing.'],
            ['Apply', 'The primary button: actually narrates, synthesizes, re-fetches, or deletes. A paid or destructive Apply is gated server-side (confirm) before it runs.'],
            ['Confirm dialog', 'In-page destructive / paid actions (Sweep orphans, Delete POI, Re-synth, Regenerate) pop a confirm before they fire — no typing required. Releasing a clip or region is confirm-gated too, and is IRREVERSIBLE — it can never be undone.'],
          ]}
        />
      </Section>

      <Section title="Eval dimensions" subtitle="Scored on eval runs (Generate Narration + Re-score corpus), shown on the Evals page (0–1, higher is better).">
        <Dl
          cols={['Dimension', 'What it measures']}
          rows={[
            ['grounding', 'Every claim is backed by the fetched facts — anti-hallucination GATE. Generate + Re-score.'],
            ['tts', 'The script is synthesis-safe (no markup/emoji) — GATE. Generate + Re-score.'],
            ['diversity', 'Clips don’t repeat the same shtick — advisory. Generate + Re-score.'],
            ['charm', 'Persona & delivery quality — advisory (Opus). Opt-in on Re-score corpus.'],
            ['veracity', 'The facts themselves are correct vs the web — advisory (Opus + search). Opt-in on Re-score corpus.'],
            ['pacing', 'Estimated clip runs over-long — advisory (free, deterministic; flags overshoot). Generate.'],
          ]}
        />
        <Callout variant="warning" className="mt-4">
          <span className="font-medium text-foreground">grounding + tts are a fail-closed gate.</span> On Generate, a
          clip that still fails after bounded auto-retakes is WITHHELD — never synthesized, never shipped — and flagged
          on the Evals page. Silence beats a bad telling.
        </Callout>
        <div className="mt-5">
          <SectionLabel className="mb-2">Two pages: Jobs and Evals</SectionLabel>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Badge>Jobs</Badge> Admin-triggered Cloud Run jobs — status, cost, who triggered them.
            </span>
            <span className="flex items-center gap-2">
              <Badge variant="outline">Evals</Badge> Generation runs with pass + dimension scores (the gate report).
            </span>
          </div>
        </div>
      </Section>

      <Section title="Release gate" subtitle="A second, HUMAN gate after the automated eval gate: every clip is born staged, and going public is a one-way latch.">
        <Callout variant="warning">
          <span className="font-medium text-foreground">Releasing is permanent.</span> A clip or region can never be
          un-released — that would orphan saved drives and break offline downloads. Ear-check first; testers can hear
          staged clips in the app before anyone else.
        </Callout>
        <div className="mt-3">
          <Dl
            cols={['Term', 'What it means']}
            rows={[
              ['Staged', 'A generated narration that is NOT yet public — testers (and you) hear it in the real app, nobody else. Every clip is born staged.'],
              ['Released', 'Public — playable in drives for everyone. The read paths gate on this bit alone.'],
              ['Release a region', 'Regions page → Release. Opens the region AND auto-releases every staged clip in its bbox at once — per-POI tellings AND the FUSED cluster tellings whose members sit in the bbox. ⚠ Releasing a fused telling also RETIRES its members: those places stop appearing in new drives, because the group’s clip now speaks for them. Re-running it (“Release new”) publishes EVERY clip in the bbox that is still staged — the predicate is `released_at IS NULL`, with no since-date, so it is not limited to what changed recently. ⚠ A place inside two overlapping region bboxes belongs to BOTH, so a release can publish clips another region also claims; the POIs page shows every region a place is in, so that set is visible before you click. Permanent.'],
              ['Release a clip', "A POI's Narration tab → Release. The trickle case: publish one freshly ear-checked clip inside an already-open region. It publishes EXACTLY ONE clip — the POI's own telling if it has one, and only if it doesn't, the fused telling of the group it belongs to. ⚠ That second case releases a clip the Narration tab does not play (the tab is per-POI), and a fused telling speaks for every member of its group — so releasing it also retires them from new drives. Permanent either way."],
              ['Regenerating a public clip', 'Updates the audio in place and stays live — a released clip is never yanked back to staged; the automated eval gate is the safety net.'],
            ]}
          />
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span className="flex items-center gap-2">
            <Badge variant="warning">staged</Badge> Not public yet — testers only.
          </span>
          <span className="flex items-center gap-2">
            <Badge variant="success">Released</Badge> Public. (Shown on each POI row + its Narration tab.)
          </span>
        </div>
      </Section>

      <Section title="Example: corpus for a new region" subtitle="Discover first (free), then enrich + generate. Always preview before applying.">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            Regions page → <Step>Add region</Step> — set the slug + a discovery bbox (the lookup helps find one).
          </li>
          <li>
            Regions page → the new region row’s <Step>Discover</Step> button (or select multiple rows for a bulk run; the POIs page has a <Step>Discover POIs</Step> picker too) → hit <Step>Preview</Step> to dry-run the sweep (counts candidates) → verify the POI list in the job log.
          </li>
          <li>
            Hit <Step>Discover</Step> — upserts the shared POI corpus that drives draw from (one job per selected region, each on the Jobs page). Free; no confirm needed.
          </li>
          <li>
            Select the eligible story POIs → <Step>Enrich</Step> — scouts each into a verbatim fact sheet (pois.fact_sheet). Preview shows the exact count + cost; Apply spends.
          </li>
          <li>
            Select the enriched story POIs (or filter by region) → <Step>Narrate</Step> — hit <Step>Preview</Step> to see the queue + a cost estimate, then <Step>Generate</Step> to narrate + synthesize a narration for every enriched, story-grade POI in the selection.
          </li>
          <li>
            Ear-pass on the POIs page — open a POI, the <Step>Narration</Step> tab plays its telling and shows the script; <Step>Re-synth</Step> any dud take (or <Step>Regenerate</Step> after a fact-edit).
          </li>
          <li>
            <Step>Release</Step> when it sounds right — one clip from its Narration tab, or the whole region from the Regions page once you've checked them. Permanent (see Release gate above).
          </li>
        </ol>
      </Section>

      <Section title="Heads-up">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            <Step>Generation writes to PROD</Step> and bills real GCP/LLM credits — the preview defaults, the explicit confirm dialog, and the optional spend cap (max-cost) are the guardrails.
          </li>
          <li>
            <Step>Cost shown is an estimate</Step> of the LLM spend the pipeline self-reports — not the GCP bill (TTS + infra aren’t included).
          </li>
          <li>A failed run that hangs in “running” settles itself once you open it (a reconcile against its Cloud Run execution).</li>
          <li>
            <Step>Cancel a live run</Step> from its drawer (Cancel run) to halt a spending job mid-flight — it settles as “canceled”.
          </li>
        </ul>
      </Section>
    </div>
  )
}

type RunKind = { kind: string; does: string; cost: ReactNode; safe: string }

const RUN_KINDS: RunKind[] = [
  {
    kind: 'Discover POIs',
    does: 'Discover Wikidata-pinned places in a region, join Wikipedia, tier them, and upsert the shared POI corpus — the foundational first step that drives select from.',
    cost: 'Free — WDQS + MediaWiki only, no LLM or TTS.',
    safe: 'Preview — lists the POIs, writes nothing. Free, so no confirm.',
  },
  {
    kind: 'Enrich corpus',
    does: 'Scout each eligible story POI into a curated verbatim fact sheet (pois.fact_sheet) that narrations ground on. A story telling REQUIRES a sheet.',
    cost: 'LLM per POI (when applied).',
    safe: 'Preview — shows the exact count + cost, makes no model calls.',
  },
  {
    kind: 'Generate Narration',
    does: 'Narrate + synthesize the one shared narration for every enriched, story-grade POI in the region.',
    cost: <span>LLM per narration (~$0.10); <span className="text-foreground">TTS</span> per narration (when applied).</span>,
    safe: 'Preview — shows the queue + cost estimate, makes no model calls.',
  },
  {
    kind: 'Fuse clusters',
    does: "Write ONE fused telling per cluster in a region — a single narration covering a group of places a driver experiences as one stop (Emerald Bay = Vikingsholm + Fannette Island + Eagle Falls). The row carries cluster_id with poi_id NULL. Member clips are left ALONE; this only adds. Run from a region's row on the Regions page. Clusters are taken widest-first, so start at a limit of 1 and listen.",
    cost: <span>LLM per fused telling; <span className="text-foreground">TTS</span> on apply.</span>,
    safe: '⚠ Preview SPENDS here — unlike Generate narration, it narrates and scores before deciding what to keep, so a preview costs an apply minus the TTS. Confirm fires on both. A fused clip lands STAGED and goes public with the region release.',
  },
  {
    kind: 'Regenerate narration',
    does: "Re-narrate ONE POI from its CURRENT facts + corrections (a fresh script), then re-score + re-synthesize — the single-POI form of Generate Narration. Run from the POI's Narration tab after a fact-edit. (Re-synth, below, only re-voices the existing script.)",
    cost: <span>LLM + <span className="text-foreground">TTS</span> for one narration (when applied).</span>,
    safe: 'Confirm before it spends.',
  },
  {
    kind: 'Re-score corpus',
    does: 'Re-score the EXISTING story narrations (grounding / tts / diversity always; charm + veracity opt-in) WITHOUT regenerating or re-synthesizing — a quality read on what is already shipped. Records an offline_audit run; its scores show on the Evals page. Read-only on narrations.',
    cost: <span>LLM grounding per clip (~$0.06, Opus, when applied); charm = one batch call; veracity web-checks each clip (pricier). Free tts + diversity run in Preview.</span>,
    safe: 'Preview — counts the narrations + estimates the spend, makes no model calls.',
  },
  {
    kind: 'Re-synth narration',
    does: "Re-voice ONE POI's narration unchanged — e.g. after a voice or style-prompt change, or a dud TTS take. Run from the POI's Narration tab.",
    cost: 'TTS for one narration (when applied).',
    safe: 'Confirm before it spends.',
  },
  {
    kind: 'Re-fetch facts',
    does: "Re-fetch a POI's upstream facts (Wikipedia extract). Updates facts_hash, which flags any grounded narration as stale.",
    cost: 'Free — MediaWiki only, no LLM or TTS.',
    safe: 'Free — no confirm needed.',
  },
  {
    kind: 'Curate places',
    does: "Build a region's curated drive endpoints + break pitstops on the Places page — interactive: Opus DRAFTS the hubs (writes nothing), you prune the list, then RESOLVE the keepers against Google Places and upsert them role-tagged. Re-runnable (OR-merges roles). Runs inline on the Places page — NOT a Jobs-page run. Add a place is the single-place manual form.",
    cost: <span>LLM (Opus draft) + <span className="text-foreground">Google Places</span> (resolve) — a few cents each (when applied).</span>,
    safe: 'Draft writes nothing — review the picks first; “Resolve & add” is the spend.',
  },
  {
    kind: 'Sweep orphans',
    does: 'Delete R2 audio clips that no narration references anymore.',
    cost: 'Deletes bytes (when applied).',
    safe: 'Confirm before it deletes.',
  },
]

const RUN_KIND_COLUMNS: Column<RunKind>[] = [
  { header: 'Kind', cellClassName: 'whitespace-nowrap align-top font-medium', cell: (k) => k.kind },
  { header: 'What it does', cellClassName: 'align-top text-muted-foreground', cell: (k) => k.does },
  { header: 'Spends / deletes', cellClassName: 'align-top', cell: (k) => k.cost },
  { header: 'Safe default', cellClassName: 'align-top text-muted-foreground', cell: (k) => k.safe },
]

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  )
}

// A two-column key/value table — same `DataTable` scaffold as the "Run kinds" table above, so every
// section on the page reads as one consistent table style (and shares the one border/header/cell treatment).
function Dl({ cols, rows }: { cols: [string, string]; rows: [string, ReactNode][] }) {
  const columns: Column<[string, ReactNode]>[] = [
    { header: cols[0], cellClassName: 'whitespace-nowrap align-top font-medium', cell: ([term]) => term },
    { header: cols[1], cellClassName: 'align-top text-muted-foreground', cell: ([, desc]) => desc },
  ]
  return <DataTable columns={columns} rows={rows} rowKey={([term]) => term} />
}

function Step({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>
}
