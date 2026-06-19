import type { ReactNode } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Callout } from '@/components/ui/callout'
import { PageHeader } from '@/components/PageHeader'
import { cn } from '@/lib/utils'

// A static cheat-sheet so the operator remembers what each control does — above all which
// actions spend money or delete bytes. Pure presentation, no data fetch.
export function ReferenceView() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Reference"
        description="What each part of the console does — and which actions spend money or delete data."
      />

      <Callout variant="info">
        <span className="font-medium text-foreground">The loop:</span> discover a region's POI corpus →
        enrich the story POIs into fact sheets → generate the narrations → ear-pass them on the POIs page
        (each POI's Narration tab: listen, read the script) → tune (re-synth) → repeat. The console defaults
        to safe — spending and deleting are always opt-in.
      </Callout>

      <Section title="Pages">
        <Dl
          rows={[
            ['Runs', 'Every run, newest first — admin-triggered Cloud Run jobs AND historical CLI generations. Click a row for details.'],
            ['Regions', 'The regions the corpus is keyed to, each with its discovery bbox (the area Discover + Generate Narration sweep).'],
            ['POIs', 'The shared POI corpus — sources, enrichment, narration coverage + freshness, and per-POI curation (fact-edits + speakable anchor). Each POI’s Narration tab plays its one telling and re-synths it.'],
          ]}
        />
      </Section>

      <Section title="Run kinds" subtitle="What the console can trigger — and what each one costs.">
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                {['Kind', 'What it does', 'Spends / deletes', 'Safe default'].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {RUN_KINDS.map((k) => (
                <TableRow key={k.kind}>
                  <TableCell className="whitespace-nowrap align-top font-medium">{k.kind}</TableCell>
                  <TableCell className="align-top text-muted-foreground">{k.does}</TableCell>
                  <TableCell className="align-top">{k.cost}</TableCell>
                  <TableCell className="align-top text-muted-foreground">{k.safe}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Preview, Apply & confirmation" subtitle="Safe by default; spending or deleting is always an explicit opt-in.">
        <Dl
          rows={[
            ['Preview', 'The dry-run button in every job dialog: shows what would change (counts, cost estimate, the queue in the run log) and touches nothing.'],
            ['Apply', 'The primary button: actually narrates, synthesizes, re-fetches, or deletes. A paid or destructive Apply is gated server-side (confirm) before it runs.'],
            ['Confirm dialog', 'In-page destructive / paid actions (Sweep orphans, Re-synth narration, Delete POI) pop a confirm before they fire — no typing required.'],
          ]}
        />
      </Section>

      <Section title="Eval dimensions" subtitle="Surfaced on historical eval runs in the run drawer (0–1, higher is better).">
        <Dl
          compact
          rows={[
            ['grounding', 'Every claim is backed by the fetched facts (anti-hallucination gate).'],
            ['veracity', 'The facts themselves are correct.'],
            ['diversity', 'Clips don’t repeat the same shtick.'],
            ['charm', 'Persona & delivery quality.'],
            ['tts', 'Synthesis / pronunciation quality.'],
          ]}
        />
        <div className="mt-5">
          <SubHead>Run source (Runs list)</SubHead>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Badge>job</Badge> Admin-triggered Cloud Run job — has status, cost, who triggered it.
            </span>
            <span className="flex items-center gap-2">
              <Badge variant="outline">eval</Badge> A historical CLI generation — has pass + dimension scores.
            </span>
          </div>
        </div>
      </Section>

      <Section title="Example: corpus for a new region" subtitle="Discover first (free), then enrich + generate. Always preview before applying.">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            Regions page → <Step>Add region</Step> — set the slug + a discovery bbox (the lookup helps find one).
          </li>
          <li>
            POIs page → <Step>Discover POIs</Step> — pick the region, hit <Step>Preview</Step> to dry-run → verify the POI list in the job log.
          </li>
          <li>
            Hit <Step>Discover</Step> — upserts the shared POI corpus that roam + drives select from. Free; no confirm needed.
          </li>
          <li>
            Select the eligible story POIs → <Step>Enrich</Step> — scouts each into a verbatim fact sheet (pois.fact_sheet). Preview shows the exact count + cost; Apply spends.
          </li>
          <li>
            <Step>Generate Narration</Step> — pick the region, hit <Step>Preview</Step> to see the queue + a cost estimate, then <Step>Generate Narration</Step> to narrate + synthesize a narration for every enriched, story-grade POI.
          </li>
          <li>
            Ear-pass on the POIs page — open a POI, the <Step>Narration</Step> tab plays its telling and shows the script; <Step>Re-synth</Step> any dud take.
          </li>
        </ol>
      </Section>

      <Section title="Heads-up">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            <Step>Generation writes to PROD</Step> and bills real GCP/LLM credits — the preview defaults, typed-confirm, and max-cost are the guardrails.
          </li>
          <li>
            <Step>Cost shown is an estimate</Step> of the LLM spend the pipeline self-reports — not the GCP bill (TTS + infra aren’t included).
          </li>
          <li>A failed run that hangs in “running” settles itself once you open it (a reconcile against its Cloud Run execution).</li>
        </ul>
      </Section>
    </div>
  )
}

const RUN_KINDS: { kind: string; does: string; cost: ReactNode; safe: string }[] = [
  {
    kind: 'Discover POIs',
    does: 'Discover Wikidata-pinned places in a region, join Wikipedia, tier them, and upsert the shared POI corpus — the foundational first step that roam + drives select from.',
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
    kind: 'Re-score corpus',
    does: 'Re-score the EXISTING story narrations (grounding / tts-cleanliness / diversity) WITHOUT regenerating or re-synthesizing — a quality read on what is already shipped. Records an offline_audit run, viewable in the Runs report. Read-only on narrations.',
    cost: <span>LLM grounding per clip (~$0.06, Opus, when applied); the free tts + diversity checks run in Preview.</span>,
    safe: 'Preview — counts the narrations + estimates the grounding spend, makes no model calls.',
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
    kind: 'Sweep orphans',
    does: 'Delete R2 audio clips that no narration references anymore.',
    cost: 'Deletes bytes (when applied).',
    safe: 'Confirm before it deletes.',
  },
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

function SubHead({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>
}

function Dl({ rows, compact }: { rows: [string, ReactNode][]; compact?: boolean }) {
  return (
    <dl className="divide-y overflow-hidden rounded-xl border">
      {rows.map(([term, desc]) => (
        <div
          key={term}
          className={cn('grid gap-1 px-4 sm:grid-cols-[minmax(0,18rem)_1fr] sm:gap-4', compact ? 'py-2' : 'py-3')}
        >
          <dt className="text-sm font-medium">{term}</dt>
          <dd className="text-sm text-muted-foreground">{desc}</dd>
        </div>
      ))}
    </dl>
  )
}

function Step({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>
}
