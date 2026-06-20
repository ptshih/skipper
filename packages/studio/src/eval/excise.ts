// Targeted excision — the REPAIR half of the grounding flywheel.
//
// The grounding gate (grounding.ts) decomposes a script into claims and names the UNGROUNDED ones.
// Historically a failing clip was either fully RE-NARRATED (whack-a-mole: the persona just reaches
// for a different flourish) or WITHHELD (a lost clip). But the body of a withheld clip is almost
// always fully grounded and charming — one reaching line sinks it. So instead of regenerating or
// withholding, we EXCISE: hand a finished script + the exact flagged claims to an editor that
// removes ONLY those lines, smooths the seam, and ADDS NOTHING — then re-gate. General (it repairs
// any ungrounded claim, not a per-failure rule), voice-preserving, and it converts withholds into
// trims. This is Anthropic's own recommended hallucination technique ("for each claim find a
// supporting quote; if you can't, remove the claim") applied to our gate's output.
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

const SYSTEM = `You are EDITING a finished tour-narration script — not rewriting it. You are given the SCRIPT and a list of UNGROUNDED CLAIMS an auditor flagged: statements the narrator was not entitled to make, because they were not on its source. Your only job is to remove each flagged claim and leave everything else exactly as it was.

- Delete the phrase, clause, or sentence that carries each flagged claim. If a whole sentence exists only to make a flagged claim, cut the whole sentence.
- Change as little as possible. Re-join the neighbors only if a cut left them dangling, so the result still reads as smooth, natural, spoken narration.
- Add NOTHING. No new fact, name, number, date, place, or description — and no softened restatement of a flagged claim. You are deleting, not patching.
- Keep the narrator's exact voice, wording, and jokes everywhere you did not cut.
- If a cut leaves the ending weak, end on the nearest earlier concrete sentence — never write a new closer.
- The result is read aloud: plain spoken prose, no markdown, no brackets, no notes.

Return the edited script through the tool.`

const REPAIR_TOOL: Anthropic.Tool = {
  name: 'repaired',
  description: 'Return the edited narration with the flagged claims removed and nothing added.',
  input_schema: {
    type: 'object',
    properties: {
      script: {
        type: 'string',
        description: 'the edited narration — spoken prose only, the flagged claims removed, nothing added',
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

/** The user message: the flagged claims to remove, then the script to edit. Exported for tests. */
export function buildExciseUser(script: string, flagged: string[]): string {
  return [
    'FLAGGED UNGROUNDED CLAIMS — remove each one, change nothing else:',
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
  call: ExciseModelCall,
): Promise<string> {
  if (flagged.length === 0) return script
  const response = await call({
    system: SYSTEM,
    tools: [REPAIR_TOOL],
    messages: [{ role: 'user', content: buildExciseUser(script, flagged) }],
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
