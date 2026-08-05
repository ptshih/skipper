// planner-copy — the words the APP says on the skipper's behalf, served rather than compiled in.
//
// ⚠ WHY THIS FILE EXISTS, and it is a bug rather than a preference. Two of these lines are SEEDED into
// the transcript as the skipper's own prior sentences and re-sent to the model on the next turn, which
// makes them prompt surface: a sentence the planner prompt forbids becomes in-context precedent
// contradicting the instructions before the rider has typed anything. While they lived in the app they
// could only be corrected by shipping a build, and on 2026-08-04 that is exactly what went wrong — a
// tapped suggestion seeded "About how long do you want to be out?" for a day after the prompt banned
// that ask. No test could see it (there was no model turn to score), the eval passed, and deploying the
// prompt fixed nothing. Served from here, the prompt and the words it governs deploy together.
//
// ⚠ THIS IS NOT THE PLANNER PROMPT AND MUST NOT BECOME IT. `planner-prompt.ts` governs what the model
// GENERATES; this file holds what the app says WITHOUT a model call. They are reviewed together
// precisely because they can contradict each other — but a rule for the model does not belong here, and
// a rider-facing sentence does not belong there.
//
// ⚠ WHAT IS SAFE TO PUT HERE. A chip's `ask` is the RIDER's line, and a rider sentence cannot
// contradict the prompt — there are no rules about what a rider may say. `adjustSay` and `noStopsSay`
// are the SKIPPER's, and those are the ones that need this file. Adding another skipper line is fine;
// adding one that answers a question the prompt says he must ask is not.
//
// STATIC — no DB read, no region parameter, no model call, nothing billed. The templates do not vary by
// region: `{a}`/`{b}`/`{c}` are filled from the region's own names on the CLIENT, which already owns the
// launch-rotation counter and the name cleaning.

import type { PlannerCopy } from '@skipper/shared'

/**
 * The cold-open suggestions, in DISPLAY ORDER.
 *
 * ⚠ SHAPES, NOT DESTINATIONS. A list of places would rebuild the tap-to-pick picker that 1.1 deleted;
 * each row instead demonstrates a different way to ASK, and the region's own names are poured in
 * client-side. Order is also PRIORITY: the client spends names from a shared cursor down this list, so
 * whatever sits first is what a thin region can still afford.
 *
 * ⚠ NO LOOP SHAPE, and adding one is a product decision rather than a copy change. A loop is an
 * explicit-ask exception (docs/decisions/no-same-road-loops.md §8) — the skipper may not offer a shape
 * he cannot know the roads support, and a suggestion the app authored makes that offer in his voice.
 *
 * ⚠ NO SEEDED REPLY, ever. Each of these is only the rider's line; the planner answers it for real. The
 * reply that used to ride alongside is the drift this whole file exists to stop.
 */
const EXAMPLES: PlannerCopy['examples'] = [
  // ⚠ The two-name row leads because it is the shape the product is actually for.
  { shape: 'aToB', title: 'Drive somewhere', ask: '{a} to {b}, the scenic way.' },
  // Costs three names — the first row a thin region loses.
  { shape: 'via', title: 'Pass through somewhere', ask: '{a} to {b}, by way of {c}.' },
  // One name each. These are what survive a region too thin for the rows above.
  { shape: 'fromStart', title: "Say where I'm starting", ask: 'Starting from {a}.' },
  // ⚠ `{a}`, NOT `{b}` — the tokens are POSITIONAL (1st/2nd/3rd name this row was given), never roles.
  // `{b}` reads more naturally for a destination and is wrong: a one-name row is handed one name, so
  // `{b}` would never be filled and the client's leftover-brace guard would silently DROP the row
  // rather than render a brace. Caught exactly that way, on the live endpoint, before it shipped.
  { shape: 'toEnd', title: "Say where I'm going", ask: 'Take me to {a}.' },
  // ⚠ Costs NO names, so it is the one row that survives a region with none at all — including one
  // that has not loaded yet. It can therefore never be allowed to depend on a place name.
  // ⚠ `askRegion` names the REGION (`{r}`), which is a different source from the curated anchor names
  // the other rows use. Keeping them separate is what lets this row be region-specific while still
  // having a form that works when there is nothing curated to name.
  {
    shape: 'open',
    title: 'Let the skipper pick',
    ask: 'Surprise me: somewhere pretty.',
    askRegion: 'Surprise me: somewhere pretty around {r}.',
  },
]

/**
 * The whole payload. A plain constant: no DB, no session, no model, nothing to bill.
 *
 * ⚠ Both `*Say` lines below are SEEDED as skipper turns and ride the WIRE, so they are re-read by the
 * model as its own words. Change them only against the current planner prompt.
 */
export const PLANNER_COPY: PlannerCopy = {
  examples: EXAMPLES,
  // ⚠ "longer, shorter" IS DELIBERATE and is not a duration ask sneaking back in. It is what riders
  // genuinely want to say, and the prompt was taught to answer it honestly rather than the copy being
  // bent to hide it: `== Once it is drawn ==` teaches that shorter means a NEARER far end and asks
  // which end moves. Do not "fix" this line to avoid the request — the conversation is the product.
  adjustSay: 'What would you change — longer, shorter, somewhere else?',
  // ⚠ States that the road came back quiet ON HIM, never that the road is dull. The prompt gives the
  // character no basis for judging a road ("not whether it is any good"), so a verdict about the place
  // would be him claiming knowledge he was never given.
  noStopsSay: 'That road came back quiet on me — nothing to tell out that way. Give me another pair and I’ll see what I’ve got.',
}
