// The LLM model ids, single-sourced. These literals were hardcoded as bare strings across package
// boundaries that can't share packages/studio/src/models.ts — apps/api (planner.ts), apps/admin
// (server/index.ts), and packages/studio itself — because the apps don't depend on @skipper/studio.
// @skipper/shared IS the common dependency, so the ids live here as the one source of truth.
// (studio/src/models.ts keeps its own TIER constants — NARRATION_/JUDGMENT_/ENRICH_ — with their
// calibration rationale; those reference these values.)
//
// Dep-free, like the rest of @skipper/shared: the Gen AI SDK is imported only by the three packages
// that call a model, each of which builds its own lazy client from the settings below.

// ---------------------------------------------------------------------------
// PROVIDER: Gemini on Google Cloud Vertex AI (founder call, 2026-09-23 — "switch it … to gcp gemini
// flash 3.8"). Every text-model call in this repo goes through `@google/genai`'s `GoogleGenAI` client in
// Vertex mode. It replaced Claude Opus 4.6 on Amazon Bedrock (2026-09-17 → 2026-09-23); the why, the
// probes and the request-shape translation live in docs/decisions/gemini-3-8-flash.md.
//
// ⚠ AUTH IS APPLICATION DEFAULT CREDENTIALS, NOT AN API KEY. Cloud Run services and jobs authenticate
// as their runtime service account, which needs `roles/aiplatform.user`; locally it is the
// service-account key file named by GOOGLE_APPLICATION_CREDENTIALS (or `gcloud auth application-default
// login`). The one env var every readiness guard checks is `VERTEX.projectEnv` — the same billing
// project Cloud TTS already bills to. ⚠ That key path is RELATIVE TO THE REPO ROOT in
// `.env.development`, and `bun --filter` runs each app from its own directory, so every client factory
// resolves it against the root before handing it to the SDK (apps/admin/server/jobs.ts found this first).
// ---------------------------------------------------------------------------
export const VERTEX = {
  /** The env var holding the Google Cloud project that bills every model call. ONE name, read here
   *  and nowhere else by string: a readiness check that spells it differently is a deploy that boots
   *  green and fails on the first paid call. Set in `.env.development` AND `.env.production` (they are
   *  the same deployment — see CLAUDE.md). */
  projectEnv: 'GOOGLE_CLOUD_PROJECT',
  /** The US MULTI-REGION endpoint (`aiplatform.us.rep.googleapis.com`), carried over from the founder's
   *  Bedrock call on 2026-09-17 ("make sure we are using the US profile"): ML processing stays inside
   *  the United States. It bills Google's "non-global" rate, +10% over `global` — MODEL_PRICING carries
   *  the rate actually billed. The SDK derives the `.rep.` host from this value itself (verified in the
   *  installed 2.24.0 client), so no base URL is configured anywhere. */
  location: 'us',
  /** Gemini 3.8 Flash, GA 2026-09-02. Verified against Google's model page on 2026-09-23: supports
   *  function calling (incl. forced `ANY` mode), structured output, thinking levels LOW/MEDIUM/HIGH
   *  (MINIMAL is a 400 on this model), Google Search grounding, and the `us` multi-region. */
  flash38: 'gemini-3.8-flash',
} as const

/** Gemini 3 thinking depth. Gemini 3.8 Flash ALWAYS thinks — there is no "off", and `MINIMAL` is
 *  rejected — so every call site picks one of these explicitly rather than inheriting the MEDIUM
 *  default by accident. ⚠ `maxOutputTokens` bounds thinking PLUS visible output in one budget (probed
 *  2026-09-23: a 150-token cap on HIGH spent 143 on thought and stopped MAX_TOKENS after three words),
 *  so raising a level without raising that site's cap buys a truncated answer, not a better one.
 *  String literals rather than the SDK enum so this package stays dependency-free; they are the
 *  SDK's `ThinkingLevel` values verbatim. */
export type ThinkingLevelName = 'LOW' | 'MEDIUM' | 'HIGH'

export const LLM_MODELS = {
  /** ⚠ EVERY KEY BELOW RESOLVES TO THE SAME MODEL (founder, 2026-09-23: all calls to Gemini 3.8
   *  Flash). The keys are TIER names, not model names, because ~20 call sites and their tests select by
   *  role and the separation is still the point: a future founder call can re-split a tier by editing
   *  ONE key without touching a call site.
   *   · `quality` — narration, every calibration-tier judge, and the admin propose/curate helpers
   *   · `enrich`  — the corpus-scale fact-sheet builder (the old Sonnet tier)
   *   · `summary` — the in-job summarizer and the delivery-register classifier (the old Haiku tier)
   *   · `planner` — the one RIDER-triggered call, below
   *
   *  What moving off Claude means, recorded so nobody reads an older calibration note as current:
   *   · the fail-closed eval gate was last CALIBRATED on Opus 4.6 (2026-09-17). Those numbers describe
   *     a model this repo no longer runs — re-run `eval/calibrate.ts` before trusting a grounding or
   *     charm score from this one.
   *   · the forced tool call every judge depends on is Gemini's function-calling mode `ANY` narrowed by
   *     `allowedFunctionNames`, and unlike Claude's non-strict tool use it ENFORCES the schema. The
   *     zod validation at each site stays anyway: it is also where the domain checks live.
   *   · a multi-step tool loop must send the model's own turn back VERBATIM, thought signatures included
   *     — Gemini 3 returns a 400 when one is missing (probed). pipeline/scout.ts is the one loop left.
   *   · `temperature`/`top_p`/`top_k` are ignored on Gemini 3 and the penalty params are a 400 — nothing
   *     here sends any of them. */
  quality: VERTEX.flash38,
  enrich: VERTEX.flash38,
  summary: VERTEX.flash38,
  /** The LIVE PLANNER's model — the only one of these that runs inside a rider request.
   *
   *  ⚠ STILL A SEPARATE KEY even though it holds the same value as `quality`, and it must stay one.
   *  The whole point is that a future bump of one cannot silently repoint the other: editing `quality`
   *  moves NARRATION_MODEL, JUDGMENT_MODEL, ENRICH_MODELS.opus and two admin job models at once — a
   *  paid-run behaviour change disguised as a constant edit, on prose gated by a fail-closed eval panel
   *  calibrated against the CURRENT model. (Same reasoning as JUDGMENT_MODEL and NARRATION_MODEL
   *  coinciding in studio/models.ts and staying separate anyway.)
   *
   *  ⚠ Thinking is always on for this model family (INV-8's requirement is now structural rather than a
   *  flag someone can drop), so the lever is DEPTH: `thinkingLevel`, bounded together with visible
   *  output by `PLANNER_MAX_TOKENS` (apps/api/src/limits.ts). */
  planner: VERTEX.flash38,
} as const
