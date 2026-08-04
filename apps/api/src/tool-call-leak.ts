// INV-8's failure mode, as ONE pattern: did the model serialize a TOOL CALL into rider-visible prose
// instead of emitting a tool_use block?
//
// ⚠ WHY THIS IS ITS OWN FILE. There are two readers and they must never disagree: ./plan-route
// SUPPRESSES a leak in production, and ../eval/checks COUNTS one — "a suppressed defect an eval cannot
// see is a defect that silently grows". They cannot share the pattern by importing each other: the
// eval's pure half is required to run under `bun test` with no network, no key and no spend
// (../test/planner-eval.test.ts states that outright), and ./plan-route drags in @anthropic-ai/sdk and
// @skipper/db. So the rule lives here, importing NOTHING, and both sides read it.
//
// ⚠ THEY HAD ALREADY DRIFTED, WHICH IS WHY THIS EXISTS. The eval carried `/<(invoke|function_calls|
// parameter)\b/i` — the FIRST cut of the production pattern, from before it was widened. It matched
// neither a CLOSING tag nor a NAMESPACED one, so the exact leak shape production had been fixed to
// catch was scored CLEAN by the eval, on a run that spends real money to produce the score.

/**
 * Matched on the BLOCK SHAPE rather than the tool name, since a leak can name any tool, and kept
 * deliberately narrow so ordinary prose about a drive can never trip it.
 *
 * ⚠ NOT HYPOTHETICAL — observed on the live model 2026-08-03 during an eval replay, on a turn that
 * should have drawn: `say` came back as `<invoke name="plan_route"><parameter name="say">…` and the
 * route was never emitted. The turn succeeds, no error is raised, nothing upstream can tell — and the
 * rider reads raw XML in a chat bubble from a character who is supposed to be a man at a car window.
 *
 * ⚠ THE NAMESPACE PREFIX IS NOT OPTIONAL TO MATCH, AND LEAVING IT OUT WAS A HOLE. The first cut listed
 * the bare names only (`<invoke`, `<parameter`), which is the form the 2026-08-03 leak happened to take
 * — but the tag family these models emit is routinely namespace-qualified (`<ns:invoke`), and a
 * prefixed tag matched NOTHING: the guard passed the markup straight through to the rider's bubble.
 * Verified by probe before widening. The `<` is still REQUIRED, which is what keeps ordinary prose safe
 * ("we'll pass the parameter road" and "the Invoke overlook" both stay clean) — the prefix is matched as
 * an optional `word:` and never as bare words.
 *
 * ⚠ Still narrow ON PURPOSE, and one shape is knowingly out of scope: a tool call the model writes as
 * JSON prose (`{"name":"plan_route",…}`) is not matched, because every pattern loose enough to catch it
 * also catches a rider being shown a legitimate object. On the serving side that case degrades to
 * `route_untranslatable` (no tool_use block ⇒ no route), which is the correct outcome — ugly prose, but
 * never a wrong drive.
 */
export const LEAKED_TOOL_CALL = /<\/?(?:[a-z][\w.-]*:)?(?:invoke|function_calls|parameter)\b/i
