import type { ReactNode } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Callout } from '@/components/ui/callout'
import { PageHeader } from '@/components/PageHeader'
import { STOP_TYPE_COLOR } from '@/components/RouteMap'
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
        <span className="font-medium text-foreground">The loop:</span> generate a tour → ear-pass it on
        its detail page (listen, read scripts, eyeball the route) → tune (patch a clip / resynth) → repeat.
        The console defaults to safe — spending and deleting are always opt-in.
      </Callout>

      <Section title="Pages">
        <Dl
          rows={[
            ['Runs', 'Every run, newest first — admin-triggered Cloud Run jobs AND historical CLI generations. “New run” triggers a skipper-gen Cloud Run Job.'],
            ['Tours', 'The full catalog, drafts included. Click a tour to open its detail.'],
            ['Tour detail', 'The ear-pass: route map, latest-eval scores, run history, and the itinerary (audio + scripts) for every stop.'],
            ['Create tour', 'Draft a new tour — the skipper proposes a route, you approve it on a map, it freezes into a draft you can then generate.'],
          ]}
        />
      </Section>

      <Section title="Run kinds" subtitle="What “New run” can do — and what each one costs.">
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

      <Section title="Dry-run, Apply & confirmation" subtitle="Safe by default; spending or deleting is always an explicit opt-in.">
        <Dl
          rows={[
            ['Generate → “Dry-run” (ON by default)', 'Writes scripts + runs the eval, NO TTS audio spend. Heads-up: LLM narration still costs ~$0.30. Turn it OFF for a real run that synthesizes audio.'],
            ['Patch / Resynth / Sweep → “Apply” (OFF by default)', 'OFF = a dry-run preview (shows what would change, touches nothing). ON = actually re-synthesize or delete.'],
            ['Typed confirmation', 'Any run that spends money or deletes bytes makes you type the target id before the button enables.'],
            ['Max cost ($) — Generate', 'Aborts a generate before audio if narration would exceed it. PRE-TTS only — LLM spend already incurred is not refunded.'],
          ]}
        />
      </Section>

      <Section title="Generate options">
        <Dl
          rows={[
            ['Tour slug', 'Which tour to (re)generate, e.g. emerald-bay-run.'],
            ['Joke level', 'off · mild · dad · dadpocalypse. Default dadpocalypse (today it’s dadpocalypse-only). Baked into the narration — not a playback toggle.'],
            ['Duration', 'short · standard · long — a longer/shorter drive by keeping more or fewer stops.'],
          ]}
        />
      </Section>

      <Section title="Tour detail — legends">
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <SubHead>Stop types (route-map pins)</SubHead>
            <div className="space-y-1.5 text-sm">
              <Legend color={STOP_TYPE_COLOR.story} name="story" desc="Fact-grounded narration about a place." />
              <Legend color={STOP_TYPE_COLOR.scenic} name="scenic" desc="Delivery-only ambient — no facts." />
              <Legend color={STOP_TYPE_COLOR.break} name="break" desc="A curated side-of-road stop (name only, no volatile data)." />
              <Legend color="#10b981" name="start" desc="The tour’s start anchor." />
              <Legend color="#ef4444" name="end" desc="The tour’s end anchor." />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              A pin sits at each stop’s trigger point (where the clip fires on the road), inside its trigger-radius circle.
            </p>
          </div>
          <div>
            <SubHead>Eval dimensions (0–1, higher is better)</SubHead>
            <Dl
              compact
              rows={[
                ['grounding', 'Every claim is backed by the fetched facts (anti-hallucination gate).'],
                ['veracity', 'The facts themselves are correct.'],
                ['diversity', 'Stops don’t repeat the same shtick.'],
                ['charm', 'Persona & delivery quality.'],
                ['tts', 'Synthesis / pronunciation quality.'],
              ]}
            />
          </div>
        </div>
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

      <Section title="Create a tour — the flow">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            <Step>Propose</Step> — pick a region + rough start/end + vibe; the skipper proposes named waypoints, geocoded to coordinates.
          </li>
          <li>
            <Step>Approve</Step> — edit the headline/anchors and drag the waypoint pins on the map. You’re the curator; the LLM only drafts.
          </li>
          <li>
            <Step>Create draft</Step> — freezes the route (a Google Routes polyline) into a <code>draft</code> tour.
          </li>
          <li>
            <Step>Generate</Step> — open the draft → New run → Generate to narrate + synthesize it.
          </li>
        </ol>
      </Section>

      <Section title="Example: roam corpus for a new region" subtitle="Discover first (free), then generate. Always preview before applying.">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            POIs page → <Step>Discover POIs</Step> — pick the region, hit <Step>Preview</Step> to dry-run → verify the POI list in the job log.
          </li>
          <li>
            Hit <Step>Discover</Step> — upserts the shared POI corpus that tours + roam both select from. Free; no confirm needed.
          </li>
          <li>
            New run → <Step>Generate roam</Step> — set <Step>Limit = 3</Step> for a smoke test. Run dry to see the corpus size and cost estimate.
          </li>
          <li>
            Run again with <Step>Apply</Step> (Limit = 3) — synthesizes 3 clips. Type <code>roam-corpus</code> to confirm.
            Ear-test them before the full run.
          </li>
          <li>
            Once clips sound good, run <Step>Generate roam</Step> with Apply and no Limit — narrates + synthesizes the full corpus.
          </li>
          <li>
            Use <Step>Force</Step> only if you need to regenerate clips whose facts haven't changed — e.g. after a persona prompt tweak.
          </li>
        </ol>
      </Section>

      <Section title="Heads-up">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            <Step>Generation writes to PROD</Step> and bills real GCP/LLM credits — the dry-run defaults, typed-confirm, and max-cost are the guardrails.
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
    does: 'Discover Wikidata-pinned places in a region, join Wikipedia, tier them, and upsert the shared POI corpus — the foundational first step that BOTH tours and roam select from.',
    cost: 'Free — WDQS + MediaWiki only, no LLM or TTS.',
    safe: 'Apply OFF — previews the POI list, writes nothing.',
  },
  {
    kind: 'Generate',
    does: 'Discover places → narrate in the skipper voice → eval → (real run) synthesize TTS audio, for one tour slug.',
    cost: <span>LLM always (~$0.30+); <span className="text-foreground">TTS</span> only on a real (non-dry) run.</span>,
    safe: 'Dry-run ON — scripts + eval, no audio.',
  },
  {
    kind: 'Patch clip',
    does: 'Find/replace text in ONE stop or frame — or re-voice it unchanged — then re-synthesize just that clip.',
    cost: 'TTS for one clip (when applied).',
    safe: 'Apply OFF — preview the change.',
  },
  {
    kind: 'Resynth tour',
    does: 'Re-synthesize EVERY clip of a tour — e.g. after a voice or style-prompt change.',
    cost: 'TTS for the whole tour (when applied).',
    safe: 'Apply OFF — preview.',
  },
  {
    kind: 'Sweep orphans',
    does: 'Delete R2 audio clips that no track or frame references anymore.',
    cost: 'Deletes bytes (when applied).',
    safe: 'Apply OFF — lists, deletes nothing.',
  },
  {
    kind: 'Generate roam',
    does: 'Narrate + synthesize free-roam encounter clips for every story-grade poi in the corpus bbox.',
    cost: <span>LLM per clip (~$0.10); <span className="text-foreground">TTS</span> per clip (when applied).</span>,
    safe: 'Apply OFF — shows corpus size + cost estimate.',
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

function Legend({ color, name, desc }: { color: string; name: string; desc: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground">— {desc}</span>
    </div>
  )
}

function Step({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>
}
