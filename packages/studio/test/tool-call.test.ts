// Pins the three properties `callTool` exists to guarantee: the reply is VALIDATED, the spend is
// recorded EVEN WHEN VALIDATION FAILS, and a calibrated call site can keep its hand-written schema
// byte-for-byte. Rationale: docs/designs/studio-structured-output-hardening.md.
//
// The client arrives as an argument. `mock.module` is deliberately avoided — mocks are PROCESS-WIDE here
// and a file green in isolation poisons another, which has already produced a false pass count.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { FunctionCallingConfigMode, ThinkingLevel, type GenerateContentParameters, type GenerateContentResponse } from '@google/genai'
import { z } from 'zod'
import { llmSpentUsd, resetSpendTally } from '@skipper/shared'
import { callTool, parseToolReply, toolInputSchema, type ToolCallClient } from '../src/pipeline/tool-call'
import { JUDGMENT_MODEL } from '../src/models'

const VERDICT = z.object({
  score: z.number().int().min(1).max(10),
  note: z.string().describe('one line'),
  rec: z.enum(['ship', 'tune']),
})

/** A Gemini reply with these parts, shaped the way the live API returns one (probed 2026-09-23): one
 *  candidate, a STOP finish even when it carries a function call, usage in `usageMetadata`. */
const reply = (parts: unknown[], finishReason = 'STOP'): GenerateContentResponse =>
  ({
    candidates: [{ content: { role: 'model', parts }, finishReason }],
    usageMetadata: { promptTokenCount: 10_000, candidatesTokenCount: 1_500, thoughtsTokenCount: 500 },
  }) as unknown as GenerateContentResponse

/** A fake that records what was actually sent, so the byte-identical claim can be asserted rather than
 *  trusted. Usage is non-zero so a missing `recordModelUsage` shows up as $0.00. */
function recordingClient(parts: unknown[], finishReason?: string): {
  client: ToolCallClient
  bodies: GenerateContentParameters[]
} {
  const bodies: GenerateContentParameters[] = []
  return {
    bodies,
    client: {
      models: {
        generateContent: async (body) => {
          bodies.push(body)
          return reply(parts, finishReason)
        },
      },
    },
  }
}

const toolUse = (args: unknown, name = 'report'): unknown => ({
  functionCall: { id: 'call_1', name, args },
  thoughtSignature: 'c2ln',
})

const args = <T>(client: ToolCallClient, schema: z.ZodType<T>, extra: Record<string, unknown> = {}) => ({
  model: JUDGMENT_MODEL,
  system: 'sys',
  user: 'u',
  maxTokens: 512,
  thinkingLevel: 'LOW' as const,
  tool: { name: 'report', description: 'Report it.' },
  schema,
  label: 'test judge',
  client,
  ...extra,
})

beforeEach(() => resetSpendTally())
// The tally is module-global in @skipper/shared, so leave it clean for whatever file runs next.
afterEach(() => resetSpendTally())

describe('toolInputSchema', () => {
  it('derives what the hand-written schemas carry, minus $schema', () => {
    const s = toolInputSchema(VERDICT) as Record<string, unknown>
    expect(s.$schema).toBeUndefined()
    expect(s.type).toBe('object')
    expect(s.additionalProperties).toBe(false)
    expect(s.required).toEqual(['score', 'note', 'rec'])
    const props = s.properties as Record<string, Record<string, unknown>>
    expect(props.note?.description).toBe('one line')
    expect(props.rec?.enum).toEqual(['ship', 'tune'])
  })

  it('⚠ pins the byte-drift that justifies the inputSchema escape hatch: an int is NOT bare', () => {
    // The hand-written judge schemas say `{type:'integer'}`. Zod renders safe-integer BOUNDS, and there
    // is no zod spelling that avoids it — `z.int()` and `z.number().int()` both do this. That is why a
    // calibrated site must pass its own schema instead of deriving one. If this ever starts producing a
    // bare integer, the escape hatch stops being necessary and this test is how you find out.
    const bare = toolInputSchema(z.object({ n: z.number().int() })) as Record<string, unknown>
    const props = bare.properties as Record<string, Record<string, unknown>>
    expect(props.n?.type).toBe('integer')
    expect(props.n?.minimum).toBe(Number.MIN_SAFE_INTEGER)
    expect(props.n?.maximum).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('refuses a non-object schema rather than letting the API 400 mid-run', () => {
    expect(() => toolInputSchema(z.string())).toThrow(/must be an object/)
  })
})

describe('parseToolReply — the layer a site with its own retry must use', () => {
  it('validates and returns the reply', () => {
    const out = parseToolReply({
      response: reply([toolUse({ score: 7, note: 'fine', rec: 'ship' })]),
      toolName: 'report',
      schema: VERDICT,
      label: 'judge',
    })
    expect(out).toEqual({ score: 7, note: 'fine', rec: 'ship' })
  })

  it('throws on a violation, naming the site and the field', () => {
    expect(() =>
      parseToolReply({
        response: reply([toolUse({ score: 11, note: 'x', rec: 'ship' })]),
        toolName: 'report',
        schema: VERDICT,
        label: 'judge',
      }),
    ).toThrow(/judge: report reply did not match its schema[\s\S]*score/)
  })

  it('bills NOTHING by itself — the site that owns the call owns the tally', () => {
    // The reason this layer exists: it must be safe to call OUTSIDE a `withRetry`, which retries every
    // error four times and would otherwise re-bill a paid call on a deterministic schema failure.
    expect(() => parseToolReply({ response: reply([]), toolName: 'report', schema: VERDICT, label: 'judge' })).toThrow(
      /no report tool call/,
    )
    expect(llmSpentUsd()).toBe(0)
  })

  // ⚠ A call can SURVIVE a truncation with args that still parse — a report whose `stops` array was cut
  // short validates fine and reads as a smaller, cleaner verdict. The finish reason is the only witness.
  it('THROWS on a MAX_TOKENS reply even when the call it carries would validate', () => {
    expect(() =>
      parseToolReply({
        response: reply([toolUse({ score: 7, note: 'fine', rec: 'ship' })], 'MAX_TOKENS'),
        toolName: 'report',
        schema: VERDICT,
        label: 'judge',
      }),
    ).toThrow(/judge: report reply was truncated \(finish MAX_TOKENS\)/)
  })

  it('names the finish reason when the call is missing, so a truncation or a block reads as one', () => {
    expect(() =>
      parseToolReply({ response: reply([{ text: 'Let me th' }], 'MAX_TOKENS'), toolName: 'report', schema: VERDICT, label: 'judge' }),
    ).toThrow(/report reply was truncated \(finish MAX_TOKENS\)/)
    expect(() =>
      parseToolReply({ response: reply([], 'SAFETY'), toolName: 'report', schema: VERDICT, label: 'judge' }),
    ).toThrow(/no report tool call \(finish SAFETY\)/)
  })
})

describe('callTool', () => {
  it('returns the reply validated, and forces the named tool', async () => {
    const { client, bodies } = recordingClient([toolUse({ score: 7, note: 'fine', rec: 'ship' })])
    const out = await callTool(args(client, VERDICT))
    expect(out).toEqual({ score: 7, note: 'fine', rec: 'ship' })
    // Gemini's forced call: mode ANY narrowed to the one function — the equivalent of Claude's
    // `tool_choice: {type:'tool'}`, which every judge depends on.
    expect(bodies[0]?.config?.toolConfig?.functionCallingConfig).toEqual({ mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['report'] })
    expect(bodies[0]?.config?.thinkingConfig).toEqual({ thinkingLevel: ThinkingLevel.LOW })
    expect(bodies[0]?.config?.maxOutputTokens).toBe(512)
    expect(bodies[0]?.config?.systemInstruction).toBe('sys')
    expect(bodies[0]?.contents).toEqual([{ role: 'user', parts: [{ text: 'u' }] }])
    expect(llmSpentUsd()).toBeGreaterThan(0)
  })

  it('THROWS on a reply that violates the schema — the cast used to let this through', async () => {
    // A score of 11 is exactly what `minimum`/`maximum` never enforced on the wire.
    const { client } = recordingClient([toolUse({ score: 11, note: 'x', rec: 'ship' })])
    await expect(callTool(args(client, VERDICT))).rejects.toThrow(/did not match its schema/)
  })

  it('records the spend EVEN WHEN validation fails — a malformed reply must not lose the charge', async () => {
    const { client } = recordingClient([toolUse({ score: 'seven', note: 'x', rec: 'nope' })])
    await expect(callTool(args(client, VERDICT))).rejects.toThrow()
    // The ordering property, and the whole reason the tally lives inside the helper: this is the defect
    // eval/charm.ts hit on 2026-08-02 and classify-treatments carried until 2026-08-04.
    expect(llmSpentUsd()).toBeGreaterThan(0)
  })

  it('throws — and still bills — when the model returns no tool call at all', async () => {
    const { client } = recordingClient([{ text: 'sorry' }])
    await expect(callTool(args(client, VERDICT))).rejects.toThrow(/no report tool call/)
    expect(llmSpentUsd()).toBeGreaterThan(0)
  })

  it('ignores a tool call under a different name', async () => {
    const { client } = recordingClient([toolUse({ score: 7, note: 'x', rec: 'ship' }, 'something_else')])
    await expect(callTool(args(client, VERDICT))).rejects.toThrow(/no report tool call/)
  })

  it('passes per-request HTTP options through, so a settling job keeps its short timeout', async () => {
    const { client, bodies } = recordingClient([toolUse({ score: 7, note: 'x', rec: 'ship' })])
    await callTool(args(client, VERDICT, { requestOptions: { timeout: 20_000, retries: 1 } }))
    expect(bodies[0]?.config?.httpOptions).toEqual({ timeout: 20_000, retryOptions: { attempts: 2 } })
  })

  it('sends a supplied inputSchema VERBATIM, so a calibrated judge keeps its request bytes', async () => {
    const handWritten = {
      type: 'object' as const,
      additionalProperties: false,
      required: ['score'],
      properties: { score: { type: 'integer' } },
    }
    const { client, bodies } = recordingClient([toolUse({ score: 7, note: 'x', rec: 'ship' })])
    await callTool(args(client, VERDICT, { inputSchema: handWritten }))
    const sent = bodies[0]?.config?.tools?.[0] as { functionDeclarations: { parametersJsonSchema: Record<string, unknown> }[] }
    const schema = sent.functionDeclarations[0]!.parametersJsonSchema
    expect(schema).toEqual(handWritten)
    // The derived schema's bounds must be absent — that absence IS the byte-identical guarantee.
    expect((schema.properties as Record<string, Record<string, unknown>>).score?.minimum).toBeUndefined()
  })
})
