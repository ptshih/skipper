// Pins the three properties `callTool` exists to guarantee: the reply is VALIDATED, the spend is
// recorded EVEN WHEN VALIDATION FAILS, and a calibrated call site can keep its hand-written schema
// byte-for-byte. Rationale: docs/designs/studio-structured-output-hardening.md.
//
// The client arrives as an argument. `mock.module` is deliberately avoided — mocks are PROCESS-WIDE here
// and a file green in isolation poisons another, which has already produced a false pass count.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import { llmSpentUsd, resetSpendTally } from '@skipper/shared'
import { callTool, parseToolReply, toolInputSchema, type ToolCallClient } from '../src/pipeline/tool-call'
import { JUDGMENT_MODEL } from '../src/models'

const VERDICT = z.object({
  score: z.number().int().min(1).max(10),
  note: z.string().describe('one line'),
  rec: z.enum(['ship', 'tune']),
})

/** A fake that records what was actually sent, so the byte-identical claim can be asserted rather than
 *  trusted. Usage is non-zero so a missing `recordModelUsage` shows up as $0.00. */
function recordingClient(content: unknown[]): {
  client: ToolCallClient
  bodies: Anthropic.MessageCreateParamsNonStreaming[]
} {
  const bodies: Anthropic.MessageCreateParamsNonStreaming[] = []
  return {
    bodies,
    client: {
      messages: {
        create: async (body) => {
          bodies.push(body)
          return { content, usage: { input_tokens: 10_000, output_tokens: 2_000 } } as unknown as Anthropic.Message
        },
      },
    },
  }
}

const toolUse = (input: unknown, name = 'report'): unknown => ({ type: 'tool_use', id: 't1', name, input })

const args = <T>(client: ToolCallClient, schema: z.ZodType<T>, extra: Record<string, unknown> = {}) => ({
  model: JUDGMENT_MODEL,
  system: 'sys',
  messages: [{ role: 'user' as const, content: 'u' }],
  maxTokens: 512,
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
  const content = (blocks: unknown[]) => blocks as readonly Anthropic.ContentBlock[]

  it('validates and returns the reply', () => {
    const out = parseToolReply({
      content: content([toolUse({ score: 7, note: 'fine', rec: 'ship' })]),
      toolName: 'report',
      schema: VERDICT,
      label: 'judge',
    })
    expect(out).toEqual({ score: 7, note: 'fine', rec: 'ship' })
  })

  it('throws on a violation, naming the site and the field', () => {
    expect(() =>
      parseToolReply({
        content: content([toolUse({ score: 11, note: 'x', rec: 'ship' })]),
        toolName: 'report',
        schema: VERDICT,
        label: 'judge',
      }),
    ).toThrow(/judge: report reply did not match its schema[\s\S]*score/)
  })

  it('bills NOTHING by itself — the site that owns the call owns the tally', () => {
    // The reason this layer exists: it must be safe to call OUTSIDE a `withRetry`, which retries every
    // error four times and would otherwise re-bill a paid Opus call on a deterministic schema failure.
    expect(() =>
      parseToolReply({ content: content([]), toolName: 'report', schema: VERDICT, label: 'judge' }),
    ).toThrow(/no report tool call/)
    expect(llmSpentUsd()).toBe(0)
  })
})

describe('callTool', () => {
  it('returns the reply validated, and forces the named tool', async () => {
    const { client, bodies } = recordingClient([toolUse({ score: 7, note: 'fine', rec: 'ship' })])
    const out = await callTool(args(client, VERDICT))
    expect(out).toEqual({ score: 7, note: 'fine', rec: 'ship' })
    expect(bodies[0]?.tool_choice).toEqual({ type: 'tool', name: 'report' })
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
    const { client } = recordingClient([{ type: 'text', text: 'sorry' }])
    await expect(callTool(args(client, VERDICT))).rejects.toThrow(/no report tool call/)
    expect(llmSpentUsd()).toBeGreaterThan(0)
  })

  it('ignores a tool call under a different name', async () => {
    const { client } = recordingClient([toolUse({ score: 7, note: 'x', rec: 'ship' }, 'something_else')])
    await expect(callTool(args(client, VERDICT))).rejects.toThrow(/no report tool call/)
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
    const sent = bodies[0]?.tools?.[0] as { input_schema: Record<string, unknown> }
    expect(sent.input_schema).toEqual(handWritten)
    // The derived schema's bounds must be absent — that absence IS the byte-identical guarantee.
    expect((sent.input_schema.properties as Record<string, Record<string, unknown>>).score?.minimum).toBeUndefined()
  })
})
