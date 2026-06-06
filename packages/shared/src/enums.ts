import { z } from 'zod'

/**
 * The Dad-Joke-O-Meter notches. A v1 GENERATION-time parameter (part of the
 * poi_content cache key), NOT a live playback toggle.
 */
export const jokeLevel = z.enum(['off', 'mild', 'dad', 'dadpocalypse'])
export type JokeLevel = z.infer<typeof jokeLevel>

/**
 * story  = factual narration (needs a poi_content row + audio).
 * scenic = delivery-only ambient audio, no facts — but STILL needs a poi_content
 *          row + non-null audio to satisfy the ready gate.
 * break  = food/rest stop; no audio.
 */
export const stopType = z.enum(['story', 'scenic', 'break'])
export type StopType = z.infer<typeof stopType>

/** Where a POI came from. Stored for dedup + attribution (Wikipedia is CC BY-SA). */
export const poiSource = z.enum(['wikipedia', 'google_places'])
export type PoiSource = z.infer<typeof poiSource>

export const tourStatus = z.enum(['draft', 'generating', 'ready', 'failed'])
export type TourStatus = z.infer<typeof tourStatus>

/** v1: whole curated corridors at a few fixed durations. No arbitrary trimming. */
export const durationBucket = z.enum(['short', 'standard', 'long'])
export type DurationBucket = z.infer<typeof durationBucket>

/** Interest filters applied to STORY candidates (changes stop density, not route). */
export const interest = z.enum(['history', 'nature', 'geology', 'culture', 'food', 'quirky'])
export type Interest = z.infer<typeof interest>

/** v1 persona: the Jungle Cruise skipper. */
export const persona = z.enum(['skipper'])
export type Persona = z.infer<typeof persona>
