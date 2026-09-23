// Forced-tool-use replies: derive the wire schema from Zod, and CHECK the answer instead of casting it.
//
// The pattern this replaces, duplicated ten times across eight files:
//
//     const call = response.content.find((b) => b.type === 'tool_use')
//     return call.input as CharmVerdict          // ← nothing checks this
//
// That was written on Claude, whose tool schemas are not grammar-enforced unless `strict: true` — so the
// schema was a REQUEST and the cast a promise the model never made. Gemini's forced mode (`ANY`) does
// enforce the schema, but the parse stays: it is where each site's DOMAIN checks live, it is what makes a
// missing call (a MAX_TOKENS stop) a named error instead of `undefined`, and a provider switch is exactly
// when "the vendor guarantees it" is least worth betting a fail-closed gate on.
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

import { FunctionCallingConfigMode, ThinkingLevel, type Content, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai'
import { z } from 'zod'
import { geminiUsage, recordModelUsage, type ThinkingLevelName } from '@skipper/shared'
import { getGemini } from '../models'

/* -------------------------------------------------------------------------- */
/*  Reading a reply — usable WITHOUT owning the call, and that is the whole point */
/* -------------------------------------------------------------------------- */

/** The slice of a Gemini reply these helpers read. Structural, so a test fake is a plain object and a
 *  real `GenerateContentResponse` (a class with getters) satisfies it as-is. */
export type ReplyLike = Pick<GenerateContentResponse, 'candidates'>

/** The first candidate's parts — Gemini's equivalent of Claude's `content` blocks. Never throws. */
export function replyParts(response: ReplyLike): NonNullable<NonNullable<Content['parts']>> {
  return response.candidates?.[0]?.content?.parts ?? []
}

/** Why the reply stopped (`STOP`, `MAX_TOKENS`, `SAFETY`, `MALFORMED_FUNCTION_CALL`, …). ⚠ A reply that
 *  CARRIES a function call still finishes `STOP` — Gemini has no `tool_use` stop reason (probed) — so a
 *  site decides "did it call?" from the parts, and uses this only to explain an absence. */
export function finishReason(response: ReplyLike): string {
  return String(response.candidates?.[0]?.finishReason ?? 'NONE')
}

/** The named function call's ARGS, unvalidated — or undefined when the reply has none by that name.
 *  For sites that validate by hand (see the header): they own the judgment, this only finds the call. */
export function toolArgs(response: ReplyLike, toolName: string): unknown {
  return replyParts(response).find((p) => p.functionCall?.name === toolName)?.functionCall?.args
}

/** The concatenated visible text of a reply. `thought` parts are excluded — they are never ours to use,
 *  and on this API they only appear when explicitly requested, which nothing here does. */
export function replyText(response: ReplyLike): string {
  return replyParts(response)
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('')
}

export interface ParseToolReplyArgs<T> {
  response: ReplyLike
  /** The forced tool's name. A call under any other name is ignored, not coerced. */
  toolName: string
  schema: z.ZodType<T>
  /** Names the call site in the thrown error. */
  label: string
}

/**
 * Find the forced tool call in a reply and return its args VALIDATED against `schema`. Throws on a
 * missing call or a shape mismatch.
 *
 * ⚠ THIS IS SPLIT OUT FROM `callTool` FOR A COST REASON, not a style one. `pipeline/http.ts`'s
 * `withRetry` retries EVERY error four times — its comment reasons that "a non-transient error just
 * fails ~a few seconds later, harmlessly", which is true of a free failure and false of a billed model
 * call. A site that wraps its own call in `withRetry` must therefore validate OUTSIDE the retry, or a
 * deterministic schema failure re-bills the model four times, silently, per item. So: sites that own
 * their call (because they retry, loop, or return a graceful null) use this; a plain one-shot call uses
 * `callTool` below, which cannot be wrapped wrong because it does not retry.
 */
export function parseToolReply<T>(args: ParseToolReplyArgs<T>): T {
  const { response, toolName, schema, label } = args
  // ⚠ BEFORE the lookup: a call can survive a truncation with args that still validate — a report whose
  // list was cut short reads as a smaller, cleaner verdict. The finish reason is the only witness.
  if (finishReason(response) === 'MAX_TOKENS') {
    throw new Error(`${label}: ${toolName} reply was truncated (finish MAX_TOKENS) — refusing a possibly partial answer.`)
  }
  const call = replyParts(response).find((p) => p.functionCall?.name === toolName)?.functionCall
  if (!call) throw new Error(`${label}: model returned no ${toolName} tool call (finish ${finishReason(response)}).`)

  const parsed = schema.safeParse(call.args)
  if (!parsed.success) {
    throw new Error(`${label}: ${toolName} reply did not match its schema.\n${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

/* -------------------------------------------------------------------------- */
/*  Schema derivation                                                          */
/* -------------------------------------------------------------------------- */

/** A function's parameter schema: plain JSON Schema, sent as Gemini's `parametersJsonSchema` (NOT the
 *  OpenAPI-subset `parameters` field). Probed 2026-09-23: `additionalProperties`, `required`, `enum`,
 *  integer bounds, `maxItems`, nested objects and `type: [x, 'null']` are all accepted as written, so
 *  the hand-written judge schemas travel byte-for-byte. */
export type ToolParameters = { type: 'object'; [k: string]: unknown }

/** Derive a function's parameter schema from a Zod object schema.
 *
 *  `$schema` is stripped: it is a JSON Schema self-description, not part of a declaration, and every
 *  byte here is prompt the model pays for. Everything studio hand-writes comes through already —
 *  `additionalProperties: false`, `required`, `.describe()` → `description`, enums, bounds.
 *
 *  ⚠ NOT byte-identical to a hand-written schema, which matters for the CALIBRATED judges. Measured
 *  2026-08-04: an integer renders as `{type:'integer', minimum:-9007199254740991, maximum:9007199254740991}`
 *  where the hand-written schemas carry a bare `{type:'integer'}` — and NO zod spelling avoids it
 *  (`z.int()` and `z.number().int()` both emit the bounds). The tool schema is part of the prompt, and
 *  the judge rubrics are calibrated against it: *"moving this would silently shift every score (re-run
 *  eval/calibrate.ts after any bump)."* So a calibrated site keeps its hand-written schema and validates
 *  the REPLY only — deriving the schema there is a re-calibration, not a refactor. */
export function toolInputSchema(schema: z.ZodType): ToolParameters {
  const { $schema: _dropped, ...json } = z.toJSONSchema(schema) as Record<string, unknown>
  if (json.type !== 'object') {
    // A function's arguments are an object. Caught here rather than as a 400 mid-run, because a paid
    // batch discovering this on item 300 has already spent on 299.
    throw new Error(`tool-call: input schema must be an object, got ${String(json.type)}.`)
  }
  return json as ToolParameters
}

/* -------------------------------------------------------------------------- */
/*  The one-shot call                                                          */
/* -------------------------------------------------------------------------- */

/** Per-request overrides handed straight to the SDK. Narrow on purpose — a per-request value beats the
 *  client default, which is how a caller keeps a short leash without touching the shared client's
 *  6-attempt retry (tuned for narration surviving a sustained overload, wrong for a settling job).
 *  `retries` counts RE-tries: 1 means one extra attempt. */
export interface ToolCallRequestOptions {
  timeout?: number
  retries?: number
}

/** The one method this helper uses, as a structural type — the seam that makes it testable.
 *
 *  Studio's existing idiom is an INJECTED seam (`CharmJudge` is "injectable so the StopEval mapping is
 *  testable without spend"), never `mock.module`: mocks here are PROCESS-WIDE and a file green in
 *  isolation poisons another, which is documented and has already cost a false 96-pass result. So the
 *  fake arrives as an argument rather than by patching the module graph. */
export interface ToolCallClient {
  models: {
    generateContent(params: GenerateContentParameters): Promise<GenerateContentResponse>
  }
}

export interface ForcedToolCallArgs {
  model: string
  system: string
  /** The conversation. A string is one user turn — the shape every one-shot judge sends. */
  user: string | Content[]
  /** Caps thinking PLUS the call's JSON in one budget (see ThinkingLevelName). */
  maxTokens: number
  /** Required, never defaulted: Gemini 3.8 always thinks, and depth is a per-site cost/quality call. */
  thinkingLevel: ThinkingLevelName
  /** The function the model is FORCED to call. `description` is prompt surface — it is what the model
   *  reads to decide what belongs in each field, so it is worth writing properly. */
  tool: { name: string; description: string; parameters: ToolParameters }
  label: string
  requestOptions?: ToolCallRequestOptions
  /** Test seam. Defaults to the shared lazy singleton — and stays LAZY, so a test that injects never
   *  needs Google credentials and production still gets the one client `models.ts` promises. */
  client?: ToolCallClient
}

/** Build the request for ONE forced function call. Exported so a site that must own its call (a retry
 *  wrapper, a vote loop) sends byte-for-byte what `callTool` would. */
export function forcedToolRequest(args: Omit<ForcedToolCallArgs, 'label' | 'client'>): GenerateContentParameters {
  const { model, system, user, maxTokens, thinkingLevel, tool, requestOptions } = args
  return {
    model,
    contents: typeof user === 'string' ? [{ role: 'user', parts: [{ text: user }] }] : user,
    config: {
      systemInstruction: system,
      maxOutputTokens: maxTokens,
      thinkingConfig: { thinkingLevel: ThinkingLevel[thinkingLevel] },
      tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parametersJsonSchema: tool.parameters }] }],
      // ANY + one allowed name = "call exactly this function" — Claude's `tool_choice: {type:'tool'}`.
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [tool.name] } },
      ...(requestOptions ? { httpOptions: httpOptionsFor(requestOptions) } : {}),
    },
  }
}

function httpOptionsFor(o: ToolCallRequestOptions): { timeout?: number; retryOptions?: { attempts: number } } {
  return {
    ...(o.timeout !== undefined ? { timeout: o.timeout } : {}),
    ...(o.retries !== undefined ? { retryOptions: { attempts: o.retries + 1 } } : {}),
  }
}

/**
 * One forced function call, billed: send it, record what it cost, return the raw reply.
 *
 * For sites that validate by hand (grounding, excise, classify-register — see the header). Records
 * BEFORE returning, so a reply the caller then rejects has still been charged.
 */
export async function forcedToolCall(args: ForcedToolCallArgs): Promise<GenerateContentResponse> {
  const response = await (args.client ?? getGemini(args.label)).models.generateContent(forcedToolRequest(args))
  recordModelUsage(args.model, geminiUsage(response.usageMetadata))
  return response
}

export interface ToolCallArgs<T> extends Omit<ForcedToolCallArgs, 'tool'> {
  tool: { name: string; description: string }
  /** The shape the answer must have. Doubles as the wire schema unless `inputSchema` overrides it. */
  schema: z.ZodType<T>
  /** Escape hatch for a CALIBRATED site: send this schema verbatim and validate the reply only. See the
   *  byte-drift warning on `toolInputSchema`. */
  inputSchema?: ToolParameters
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
  const { tool, schema, inputSchema, label } = args

  // ⚠ RECORD BEFORE THE PARSE CAN THROW. The tokens are billed the moment the call returns, so a
  // malformed reply must not also lose the charge — the ordering eval/charm.ts learned on 2026-08-02,
  // when the charm judge's share of every run read $0.00. `forcedToolCall` records inside, so it cannot
  // be forgotten at a call site; that is the property, not the two saved lines.
  const response = await forcedToolCall({
    ...args,
    tool: { ...tool, parameters: inputSchema ?? toolInputSchema(schema) },
  })

  return parseToolReply({ response, toolName: tool.name, schema, label })
}
