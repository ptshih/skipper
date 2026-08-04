// Forced-tool-use replies: derive the wire schema from Zod, and CHECK the answer instead of casting it.
//
// The pattern this replaces, duplicated ten times across eight files:
//
//     const call = response.content.find((b) => b.type === 'tool_use')
//     return call.input as CharmVerdict          // ← nothing checks this
//
// Anthropic tool schemas are NOT grammar-enforced unless `strict: true` is set, which studio sets
// nowhere — and even under strict, `minimum`/`maximum`/`maxItems` are documented as unenforced. So the
// schema is a REQUEST and the cast is a promise the model never made.
//
// ⚠ READ THIS BEFORE "FIXING" ANY OTHER CALL SITE. A 2026-08-04 sweep first counted eight unvalidated
// sites by grepping for `input as`. That count was WRONG, and the correction is the useful part: SIX of
// the eight validate by hand at the point of use, several of them better than a generic schema check
// because they encode a domain decision that a schema cannot:
//   · `eval/grounding.ts`   — distinguishes an ABSENT `claims` key (malformed → fails closed) from
//                             `claims: []` (a legitimate verdict). A schema would accept both or neither.
//   · `eval/veracity.ts`    — throws unless `checked` is an array, so a truncated report cannot read as
//                             a vacuous clean pass.
//   · `curate-places.ts`    — filters on `typeof rank === 'number'` ON PURPOSE, because rank 0 is valid
//                             and a truthiness check would silently drop a 0-indexed model's best places.
//   · `classify-register.ts`— checks the four legal registers and defaults to 'story', the documented
//                             safe catch-all.
//   · `eval/excise.ts`      — requires a non-empty string and otherwise returns the ORIGINAL script.
//   · `pipeline/scout.ts`   — dedupes and clamps span indices to the article's real range.
// Do not replace those with a schema; you would be deleting judgment and calling it hardening. Only two
// sites were genuinely blind — `eval/charm.ts` (a raw cast straight into scoring) and
// `classify-treatments.ts` — and those are the two that use this module.
//
// Full assessment, including why an LLM framework was declined for this:
// docs/designs/studio-structured-output-hardening.md.

import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { recordModelUsage } from '@skipper/shared'
import { getAnthropic } from '../models'

/* -------------------------------------------------------------------------- */
/*  The parse — usable WITHOUT owning the call, and that is the whole point     */
/* -------------------------------------------------------------------------- */

export interface ParseToolReplyArgs<T> {
  content: readonly Anthropic.ContentBlock[]
  /** The forced tool's name. A block under any other name is ignored, not coerced. */
  toolName: string
  schema: z.ZodType<T>
  /** Names the call site in the thrown error. */
  label: string
}

/**
 * Find the forced tool call in a reply and return its input VALIDATED against `schema`. Throws on a
 * missing call or a shape mismatch.
 *
 * ⚠ THIS IS SPLIT OUT FROM `callTool` FOR A COST REASON, not a style one. `pipeline/http.ts`'s
 * `withRetry` retries EVERY error four times — its comment reasons that "a non-transient error just
 * fails ~a few seconds later, harmlessly", which is true of a free failure and false of a billed model
 * call. A site that wraps its own call in `withRetry` must therefore validate OUTSIDE the retry, or a
 * deterministic schema failure re-bills Opus four times, silently, per item. So: sites that own their
 * call (because they retry, loop, or return a graceful null) use this; a plain one-shot call uses
 * `callTool` below, which cannot be wrapped wrong because it does not retry.
 */
export function parseToolReply<T>(args: ParseToolReplyArgs<T>): T {
  const { content, toolName, schema, label } = args
  const call = content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === toolName)
  if (!call) throw new Error(`${label}: model returned no ${toolName} tool call.`)

  const parsed = schema.safeParse(call.input)
  if (!parsed.success) {
    throw new Error(`${label}: ${toolName} reply did not match its schema.\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

/* -------------------------------------------------------------------------- */
/*  Schema derivation                                                          */
/* -------------------------------------------------------------------------- */

/** Derive Anthropic's `input_schema` from a Zod object schema.
 *
 *  `$schema` is stripped: it is a JSON Schema self-description, not part of a tool definition, and every
 *  byte here is prompt the model pays for. Everything studio hand-writes comes through already —
 *  `additionalProperties: false`, `required`, `.describe()` → `description`, enums, bounds.
 *
 *  ⚠ NOT byte-identical to a hand-written schema, which matters for the CALIBRATED judges. Measured
 *  2026-08-04: an integer renders as `{type:'integer', minimum:-9007199254740991, maximum:9007199254740991}`
 *  where the hand-written schemas carry a bare `{type:'integer'}` — and NO zod spelling avoids it
 *  (`z.int()` and `z.number().int()` both emit the bounds). The tool schema is part of the prompt, and
 *  `models.ts` warns that the judge rubrics were calibrated against Opus-tier judging: *"moving this
 *  would silently shift every score (re-run eval/calibrate.ts after any bump)."* So a calibrated site
 *  keeps its hand-written schema and validates the REPLY only — deriving the schema there is a
 *  re-calibration, not a refactor. */
export function toolInputSchema(schema: z.ZodType): Anthropic.Tool['input_schema'] {
  const { $schema: _dropped, ...json } = z.toJSONSchema(schema) as Record<string, unknown>
  if (json.type !== 'object') {
    // Anthropic requires an object at the top level. Caught here rather than as a 400 mid-run, because a
    // paid batch discovering this on item 300 has already spent on 299.
    throw new Error(`tool-call: input schema must be an object, got ${String(json.type)}.`)
  }
  return json as Anthropic.Tool['input_schema']
}

/* -------------------------------------------------------------------------- */
/*  The one-shot call                                                          */
/* -------------------------------------------------------------------------- */

/** Per-request overrides handed straight to the SDK. Narrow on purpose — a per-request value beats the
 *  client default, which is how a caller keeps a short timeout without touching the shared client's
 *  `maxRetries: 5` (tuned for narration surviving a sustained overload, wrong for a settling job). */
export interface ToolCallRequestOptions {
  timeout?: number
  maxRetries?: number
}

/** The one method this helper uses, as a structural type — the seam that makes it testable.
 *
 *  Studio's existing idiom is an INJECTED seam (`CharmJudge` is "injectable so the StopEval mapping is
 *  testable without spend"), never `mock.module`: mocks here are PROCESS-WIDE and a file green in
 *  isolation poisons another, which is documented and has already cost a false 96-pass result. So the
 *  fake arrives as an argument rather than by patching the module graph. */
export interface ToolCallClient {
  messages: {
    create(
      body: Anthropic.MessageCreateParamsNonStreaming,
      options?: ToolCallRequestOptions,
    ): Promise<Anthropic.Message>
  }
}

export interface ToolCallArgs<T> {
  model: string
  system: string | Anthropic.TextBlockParam[]
  messages: Anthropic.MessageParam[]
  maxTokens: number
  /** The tool the model is FORCED to call. `description` is prompt surface — it is what the model reads
   *  to decide what belongs in each field, so it is worth writing properly. */
  tool: { name: string; description: string }
  /** The shape the answer must have. Doubles as the wire schema unless `inputSchema` overrides it. */
  schema: z.ZodType<T>
  /** Escape hatch for a CALIBRATED site: send this schema verbatim and validate the reply only. See the
   *  byte-drift warning on `toolInputSchema`. */
  inputSchema?: Anthropic.Tool['input_schema']
  label: string
  requestOptions?: ToolCallRequestOptions
  /** Test seam. Defaults to the shared lazy singleton — and stays LAZY, so a test that injects never
   *  needs `ANTHROPIC_API_KEY` and production still gets the one client `models.ts` promises. */
  client?: ToolCallClient
}

/**
 * One forced tool call: record what it billed, then return the answer validated.
 *
 * Throws on a missing tool call or a schema mismatch, and throwing is the point — doctrine here is
 * *"absence of failure is not success; assert the work happened."* A caller that must not fail catches
 * it and degrades out loud; that is already how the charm judge's only caller behaves (*"advisory; a
 * failure is non-fatal, skipped"*). It returns `T` rather than a result union deliberately: a union lets
 * a caller destructure past the failure, which is how the silent casts arose in the first place.
 *
 * ⚠ Do NOT wrap this in `withRetry` — see the cost note on `parseToolReply`. If a site needs retry,
 * it should own its call and use `parseToolReply` outside the retry.
 */
export async function callTool<T>(args: ToolCallArgs<T>): Promise<T> {
  const { model, system, messages, maxTokens, tool, schema, inputSchema, label, requestOptions } = args

  const response = await (args.client ?? getAnthropic(label)).messages.create(
    {
      model,
      max_tokens: maxTokens,
      system,
      tools: [{ name: tool.name, description: tool.description, input_schema: inputSchema ?? toolInputSchema(schema) }],
      tool_choice: { type: 'tool', name: tool.name },
      messages,
    },
    requestOptions,
  )

  // ⚠ RECORD BEFORE THE PARSE CAN THROW. The tokens are billed the moment the call returns, so a
  // malformed reply must not also lose the charge — the ordering eval/charm.ts learned on 2026-08-02,
  // when the charm judge's share of every run read $0.00. Inside the helper, it cannot be forgotten at a
  // call site; that is the property, not the two saved lines.
  recordModelUsage(model, response.usage)

  return parseToolReply({ content: response.content, toolName: tool.name, schema, label })
}
