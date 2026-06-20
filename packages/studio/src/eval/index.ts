// @skipper/studio eval panel — a standing, multi-dimension scorecard over a generated
// tour (the keystone of the agentic-generation build order; see TODO.md + the design thread).
// This slice ships the GROUNDING gate; charm/diversity/pacing/tts plug in as more evaluators
// returning the same StopEval shape.

export * from './types'
export * from './grounding'
export * from './tts'
export * from './diversity'
export * from './pacing'
export * from './charm'
export * from './veracity'
export * from './scorecard'
export * from './optimize'
export * from './golden'
