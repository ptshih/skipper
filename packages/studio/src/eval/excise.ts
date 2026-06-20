// Targeted excision — the REPAIR half of the grounding flywheel.
//
// The grounding gate (grounding.ts) decomposes a script into claims and names the UNGROUNDED ones.
// Historically a failing clip was either fully RE-NARRATED (whack-a-mole: the persona just reaches
// for a different flourish) or WITHHELD (a lost clip). But the body of a withheld clip is almost
// always fully grounded and charming — one reaching line sinks it. So instead of regenerating or
// withholding, we EXCISE: hand a finished script + its FACT SHEET + the exact flagged claims to an
// editor that, per claim, makes the SMALLEST grounding edit — GENERALIZE the unsupported specific
// back to what the sheet supports ("lions" → the sheet's "big cats", keeping the beat) or, when no
// grounded core remains, DELETE the line and smooth the seam — adding NOTHING new, then re-gate.
// General (it repairs any ungrounded claim, not a per-failure rule), voice-preserving, and it
// converts withholds into trims. This is Anthropic's own recommended hallucination technique ("for
// each claim find a supporting quote; if you can't, remove the claim") applied to our gate's output.
// It's safe to let the editor reword (not just delete): the gate RE-RUNS on its output, so a reword
// that reaches is caught and the clip falls back to the prior take — the downside is bounded to a
// withhold, never a shipped invention.
//
// The model call is INJECTED (ExciseModelCall), so the build/extract logic is unit-tested with a
// deterministic fake and zero API spend. Mirrors classify-register.ts / grounding.ts.

import Anthropic from '@anthropic-ai/sdk'
import { NARRATION_MODEL } from '../models'
import { recordModelUsage } from '../pipeline/spend'

// Editing is a forced-tool turn on the NARRATION model (Opus) — same model that wrote it, so the
// voice stays consistent; a forced tool guarantees a clean script back, never a preamble. A repaired
// script is at most a narration's length, so the cap is generous.
const EXCISE_MAX_TOKENS = 2_000

const SYSTEM = `You are EDITING a finished tour-narration script — not rewriting it. An auditor flagged some UNGROUNDED CLAIMS: statements the narrator was not entitled to make because the FACT SHEET (the only facts it was allowed to use) does not support them. Make each flagged claim grounded with the SMALLEST possible edit, and leave everything else exactly as written.

For each flagged claim, take the least-invasive fix that lands:
- GENERALIZE toward the sheet when a grounded core remains: replace an unsupported SPECIFIC with the broader term the sheet actually gives ("lions" → "big cats" when the sheet says only "big cats"), or drop the unsupported half of a sentence and keep the grounded half. This preserves the beat and the joke where it can.
- DELETE the phrase, clause, or sentence when it has no grounded core. If a sentence exists only to carry a flagged claim, cut the whole sentence.
- Re-join the neighbors only if a cut left them dangling, so the result still reads as smooth, natural, spoken narration.

Hard rules — you may only REMOVE or GENERALIZE-TOWARD-THE-SHEET, never add:
- Add NO fact, name, number, date, place, ranking, comparison, or description that is not on the FACT SHEET, and never restate a flagged claim in softer or hedged words.
- A generalization must be strictly LESS specific than a sheet line and fully entailed by it. If no sheet line supports even a broader version, DELETE instead. When in doubt, delete.
- Keep the narrator's exact voice, wording, and jokes everywhere you did not cut.
- If a cut leaves the ending weak, end on the nearest earlier concrete sentence — never write a new closer.
- The result is read aloud: plain spoken prose, no markdown, no brackets, no notes.

Return the edited script through the tool.`

const REPAIR_TOOL: Anthropic.Tool = {
  name: 'repaired',
  description: 'Return the edited narration with each flagged claim removed or generalized to the sheet, nothing new added.',
  input_schema: {
    type: 'object',
    properties: {
      script: {
        type: 'string',
        description: 'the edited narration — spoken prose only; flagged claims removed or generalized toward the sheet, nothing added',
      },
    },
    required: ['script'],
    additionalProperties: false,
  },
}

/** One model turn — injectable for tests. */
export type ExciseModelCall = (args: {
  system: string
  tools: Anthropic.Tool[]
  messages: Anthropic.MessageParam[]
}) => Promise<Anthropic.Message>

/** The user message: the fact sheet (what a fix may generalize toward), the flagged claims, then the
 *  script to edit. Exported for tests. */
export function buildExciseUser(script: string, flagged: string[], well: string[]): string {
  return [
    'FACT SHEET — the ONLY facts the narrator was entitled to use. A fix may keep or generalize TOWARD these lines, never beyond them:',
    ...(well.length > 0 ? well.map((f) => `- ${f}`) : ['(empty — this stop was given no place-facts)']),
    '',
    'FLAGGED UNGROUNDED CLAIMS — make each grounded by the smallest edit (generalize toward the sheet, else delete):',
    ...flagged.map((f) => `- ${f}`),
    '',
    'SCRIPT:',
    script,
  ].join('\n')
}

/**
 * Remove the flagged ungrounded claims from a finished script, changing nothing else. Returns the
 * edited script — or the ORIGINAL unchanged when there is nothing to remove or the model reply is
 * malformed/empty. A no-op return is deliberate: it reads as "no improvement" to the optimize loop,
 * whose not-worse + thrash guards then hold the prior take (i.e. the clip falls back to today's
 * withhold behavior rather than shipping a botched edit).
 */
export async function exciseUngrounded(
  script: string,
  flagged: string[],
  well: string[],
  call: ExciseModelCall,
): Promise<string> {
  if (flagged.length === 0) return script
  const response = await call({
    system: SYSTEM,
    tools: [REPAIR_TOOL],
    messages: [{ role: 'user', content: buildExciseUser(script, flagged, well) }],
  })
  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  const edited = (toolUse?.input as { script?: unknown } | undefined)?.script
  return typeof edited === 'string' && edited.trim().length > 0 ? edited.trim() : script
}

/** The real Haiku-free Anthropic call backing exciseUngrounded (forced tool_choice → always a script). */
export function makeExciseCall(getAnthropic: () => Anthropic): ExciseModelCall {
  return async ({ system, tools, messages }) => {
    const response = await getAnthropic().messages.create({
      model: NARRATION_MODEL,
      max_tokens: EXCISE_MAX_TOKENS,
      system,
      tools,
      tool_choice: { type: 'tool', name: 'repaired' },
      messages,
    })
    recordModelUsage(NARRATION_MODEL, response.usage)
    return response
  }
}
