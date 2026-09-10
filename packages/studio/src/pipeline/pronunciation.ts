// Pronunciation lexicon — per-NAME spoken hints for the TTS, applied at SYNTHESIS.
//
// WHY a lexicon (not the narrator's job): pronunciation is a STABLE property of a NAME, not of a
// telling — the same place name rides many narrations. An LLM asked to respell a name will
// confidently get a LOCAL pronunciation wrong ("Genoa, Nevada" is "juh-NOH-uh," not the Italian
// "JEN-oh-ah") and bake that guess into a frozen clip, and the respelling would pollute the script
// the grounding gate reads. So we solve it ONCE per name, downstream, like regionLabel / kind.
//
// WHY via the style PROMPT (not SSML): our model — Gemini-TTS `gemini-3.1-flash-tts-preview` — has
// NO SSML, no <phoneme> tag, and no customPronunciations field; pronunciation is steerable ONLY
// through the natural-language style prompt (verified against Google's Gemini-TTS + SSML docs,
// 2026-06-20). So at synth we detect which lexicon names appear in a clip's TEXT and append a
// one-line guide to the style prompt (input.prompt). The stored script stays CLEAN (the real name);
// the hint rides only the synth call, so the gate, the displayed text, and shared-atom reuse are
// untouched.
//
// CURATED + EAR-VERIFIED, and GROWN REACTIVELY: prompt-level pronunciation is model-INTERPRETED, not
// deterministic, so each entry is confirmed by ear; names the TTS botches in QA earn a new entry.
// Seed kept SMALL and high-confidence on purpose — only add a name once it's confirmed mis-said,
// so we never over-articulate a name the voice already handles. Respellings are plain syllables
// (CAPS = stress), which is what the Gemini prompt understands — never IPA.

export const PRONUNCIATIONS: Record<string, string> = {
  // Local-pronunciation TRAPS — the obvious reading is WRONG; the TTS will almost certainly miss these.
  Nevada: 'nuh-VAD-uh', // the flat "a" (rhymes with "had") — locals are particular; NOT "nuh-VAH-duh"
  'Genoa, Italy': 'JEN-oh-uh', // an explicit foreign referent must outrank the Nevada hint
  Genoa: 'juh-NOH-uh', // the Nevada town — NOT the Italian "JEN-oh-ah"
  Verdi: 'VER-dye', // the Nevada town — NOT the composer "VAIR-dee"
  // Indigenous / regional names a TTS voice tends to mangle (verify + extend by ear).
  // Yosemite review caught Merced read as "mer-SAY"; retain the final d.
  // https://www.dictionary.com/browse/merced
  Merced: 'mer-SED',
  // https://documents.law.yale.edu/pronouncing-dictionary (Tioga)
  Tioga: 'tie-OH-guh',
  Washoe: 'WAH-show',
  Wabuska: 'wuh-BUS-kuh',
  Carnelian: 'car-NEEL-yun',
}

/** Escape a lexicon key for use inside a RegExp (names are plain words today, but be safe). */
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The pronunciation clause to append to a clip's TTS style prompt — ONLY the lexicon names that
 * actually appear in this clip's text (whole-word, case-insensitive), so it never bloats a clip
 * with names it does not say. Returns '' when none apply (the common case → byte-identical prompt).
 * Pure + unit-tested; `lexicon` is injectable for tests.
 */
export function pronunciationClause(
  text: string,
  lexicon: Record<string, string> = PRONUNCIATIONS,
): string {
  const matching = Object.entries(lexicon).filter(([name]) =>
    new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(text))
  // A qualified name is stronger evidence than a bare regional homonym. Do not send
  // contradictory hints for "Genoa, Italy" and "Genoa" in the same synthesis prompt.
  const hits = matching.filter(([name]) => !matching.some(([other]) =>
    other !== name && new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(other)))
    .map(([name, say]) => `"${name}" as "${say}"`)
  if (hits.length === 0) return ''
  return ` Pronounce these place names exactly as written: ${hits.join('; ')}.`
}
