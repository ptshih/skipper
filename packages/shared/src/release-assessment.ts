import { z } from 'zod'

// Audio-input + structured-output support verified against Google's model documentation.
// https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-pro
export const RELEASE_ASSESSMENT_MODEL = 'gemini-3.1-pro-preview'
export const RELEASE_ASSESSMENT_POLICY = 'skipper-release-v2'
const score = z.number().int().min(1).max(10)
export const releaseJudgment = z.object({
  scores: z.object({ sourceSupport: score, roadContext: score, writing: score, delivery: score, audioFidelity: score }),
  scriptMatchesAudio: z.boolean(),
  confidence: z.number().min(0).max(1),
  uncertain: z.boolean(),
  summary: z.string().min(1).max(2000),
  heardOpening: z.string().min(1).max(1000),
  heardEnding: z.string().min(1).max(1000),
  issues: z.array(z.object({ dimension: z.enum(['sourceSupport', 'roadContext', 'writing', 'delivery', 'audioFidelity']),
    severity: z.enum(['minor', 'major']), detail: z.string().min(1).max(2000),
    atSeconds: z.number().min(0).nullable() })).max(30),
  advisoryExplanation: z.string().max(4000),
}).strict()
export type ReleaseJudgment = z.infer<typeof releaseJudgment>

/** Passing a model judge is the founder's default acceptance, not a claim of certainty.
 * Weak factual support, changed/missing speech, uncertainty and major defects need attention.
 */
export function acceptsReleaseJudgment(j: ReleaseJudgment): boolean {
  return j.scriptMatchesAudio && !j.uncertain && j.confidence >= 0.8 && j.scores.sourceSupport >= 9
    && j.scores.audioFidelity >= 9 && j.scores.roadContext >= 7
    && j.scores.writing >= 7 && j.scores.delivery >= 7
    && !j.issues.some(i => i.severity === 'major')
}

export const releaseAssessmentResult = z.object({
  model: z.literal(RELEASE_ASSESSMENT_MODEL), policyVersion: z.literal(RELEASE_ASSESSMENT_POLICY),
  inputFingerprint: z.string().min(1), audioSha256: z.string().length(64),
  judgedAt: z.string(), judgment: releaseJudgment,
  technical: z.object({ ok: z.boolean(), advisory: z.boolean().optional(), message: z.string(),
    durationMs: z.number().optional(), checkedAt: z.string().optional() }),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative() }),
})
export type ReleaseAssessmentResult = z.infer<typeof releaseAssessmentResult>

/** Standard global pricing includes audio input and reasoning output; never price Gemini
 * through the Anthropic-only spend helper (unknown models there would silently cost zero).
 * https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing
 */
export function releaseAssessmentCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * (inputTokens > 200000 ? 4 : 2) + outputTokens * (inputTokens > 200000 ? 18 : 12)) / 1000000
}
