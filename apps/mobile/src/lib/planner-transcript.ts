// The conversation transcript, as the CLIENT holds it — and the one translation from it to the wire.
//
// Pure and native-free (type-only imports from @skipper/shared, zero runtime imports) so it runs under
// `bun test` — same split as connectivity-util.ts / offline-util.ts. The screen owns the React state;
// every rule about what a transcript IS lives here, where it can be tested.
//
// D10: the planner is STATELESS. There is no `conversations` table and no server copy — the client
// holds the whole transcript and re-sends it on every turn. Which also means: this array is the ONLY
// copy that exists. Nothing here persists it (INV-13); it dies with the screen, on purpose.
//
// ⚠ INV-13: nothing in this file logs. Every string that passes through is rider content.

import type { PlannedRoute, PlannerTurn } from '@skipper/shared'

/**
 * One line of the on-screen conversation.
 *
 * `wire` is the whole reason this type exists instead of `PlannerTurn`. Some turns are rendered but
 * must NEVER be sent (the cold-open greeting, a client-authored outage line — words the model never
 * said), and some client-authored turns MUST be sent (a seeded example reply, so the model knows what
 * it "already said"). There is no way to derive that from the text, so it is carried.
 *
 * `route` rides on the skipper turn that arrived with it so the wrap-up bar can offer the most recent
 * route the rider was shown even when the final turn carried none (design §7 case 2). It is display /
 * client state and is dropped by `toWire` — the model re-emits a route when it means one.
 */
export interface Turn {
  role: 'rider' | 'skipper'
  text: string
  wire: boolean
  route?: PlannedRoute | null
}

/**
 * The transcript as `POST /drives/plan` takes it — or `null` when it is not a legal transcript.
 *
 * ⚠ THIS IS THE SHARPEST FUNCTION IN THE CLIENT. `apps/api/src/planner.ts` `toModelMessages` drops
 * blank-text turns and then requires the first AND last survivor to be the rider's (a leading assistant
 * turn is rejected by the vendor API outright; a trailing one is read as an assistant PREFILL and 400s).
 * The handler catches that and answers 200 with the in-persona "radio's out" line — so a transcript
 * this function gets wrong surfaces as a PERMANENT FAKE OUTAGE with nothing in any log, on both ends.
 * The rules below mirror that server filter deliberately; if it changes, this changes with it.
 *
 * `null` is a BUG GUARD, not a rider-facing state: the screen refuses to POST rather than spending an
 * anonymous Opus call (INV-11) on a shape the server will reject.
 */
export function toWire(turns: readonly Turn[]): PlannerTurn[] | null {
  const kept = turns.filter((t) => t.wire && t.text.trim().length > 0)
  const first = kept[0]
  const last = kept[kept.length - 1]
  if (!first || !last || first.role !== 'rider' || last.role !== 'rider') return null
  // A second wall in front of role injection: the wire object is BUILT from two named fields, never
  // spread from a Turn. A `system` (or any other) role cannot reach the model through this seam even
  // if one is somehow present at runtime, and `wire`/`route` cannot leak onto the wire by accident.
  for (const t of kept) if (t.role !== 'rider' && t.role !== 'skipper') return null

  // ⚠ COLLAPSE CONSECUTIVE SAME-ROLE TURNS, and this is not tidiness either. Two client-authored beats
  // can legitimately land back to back — a seeded reply followed by the "that road is quiet" line, or
  // two rider lines when one turn failed between them — and Anthropic's own documentation contradicts
  // itself on whether `messages` must alternate (the error-code reference lists "roles must alternate"
  // as a 400; the SDK guide says consecutive same-role messages are merged). We do not need to resolve
  // that: merging is byte-equivalent to the permissive reading and legal under the strict one, so it is
  // correct either way. Left unmerged and the strict reading true, the failure is the worst shape
  // available here — the server catches the vendor 400 and answers 200 with the in-persona outage line,
  // so the rider watches the skipper apologise forever and NOTHING is logged on either end.
  const merged: PlannerTurn[] = []
  for (const t of kept) {
    const prev = merged[merged.length - 1]
    if (prev && prev.role === t.role) prev.text = `${prev.text}\n\n${t.text}`
    else merged.push({ role: t.role, text: t.text })
  }
  return merged
}

/**
 * The rider just said something. Always `wire: true` and there is deliberately no option: a rider line
 * the model cannot see would desync the conversation from what the rider can read on screen.
 */
export const appendRider = (turns: readonly Turn[], text: string): Turn[] => [
  ...turns,
  { role: 'rider', text, wire: true },
]

/**
 * A skipper line. `wire` is REQUIRED — no default — because both answers are legitimate and the wrong
 * one is the fake-outage bug above: a model turn is `true`, a client-authored line (the cold open, an
 * outage apology) is `false`. Forcing the caller to say which is the cheapest possible guard.
 */
export const appendSkipper = (
  turns: readonly Turn[],
  text: string,
  opts: { wire: boolean; route?: PlannedRoute | null },
): Turn[] => [...turns, { role: 'skipper', text, wire: opts.wire, route: opts.route ?? null }]

/**
 * Seed a tapped example ask + its hand-authored reply (D17): one rider turn and one skipper turn, no
 * network, no model call — the app's highest-traffic turn costs zero dollars.
 *
 * BOTH ride the wire: the model must see the answer it "already gave", or its next turn re-asks a
 * question the rider can plainly read that it already asked. The pair ends on a SKIPPER turn, so it is
 * never sendable alone — it only ever ships as a prefix with the rider's next line appended.
 */
export const seedExample = (turns: readonly Turn[], ask: string, reply: string): Turn[] =>
  appendSkipper(appendRider(turns, ask), reply, { wire: true })

/**
 * "Change it up" — the skipper inviting a revision, seeded with no model call and no dollars, the
 * same way a tapped example is. Rides the wire: the rider's next line is an ANSWER to this question,
 * and without it the model's reply reads as a non-sequitur.
 *
 * IDEMPOTENT ON THE TAIL, and that is the whole reason this is a function rather than a bare
 * `appendSkipper` at the call site. The button sits on EVERY card in the transcript and stays live
 * after it is tapped, so "tap it twice" and "tap it on card A then card B" are both one gesture away
 * — and each would otherwise stack a second identical line under the first, which reads as the
 * skipper repeating himself rather than waiting. When the invitation is already the last thing said,
 * the standing one is left alone and the SAME ARRAY comes back, so React re-renders nothing and the
 * scroll does not twitch under a rider who is already typing.
 */
export const seedAdjust = (turns: Turn[], prompt: string): Turn[] => {
  const last = turns[turns.length - 1]
  if (last && last.role === 'skipper' && last.text === prompt) return turns
  return appendSkipper(turns, prompt, { wire: true })
}

/**
 * "Start fresh" (design §7) — back to an empty conversation. Pass the cold-open line to re-seed it in
 * the same call; it is stamped `wire: false` here so no caller can forget the flag that matters.
 */
export const resetTranscript = (opening?: string): Turn[] =>
  opening === undefined ? [] : [{ role: 'skipper', text: opening, wire: false, route: null }]

/**
 * The most recent route the rider has been shown, or null.
 *
 * Needed because `done: true` can land on a turn that carried no route while an earlier turn did — the
 * wrap-up bar still owes that rider a "Draw it up" (design §7 case 2), and with no route ever offered
 * it must show only "Start fresh" rather than a CTA that cannot do anything.
 */
export function lastRouteOf(turns: readonly Turn[]): PlannedRoute | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    const r = turns[i]?.route
    if (r) return r
  }
  return null
}
