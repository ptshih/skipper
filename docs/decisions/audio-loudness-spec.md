# Audio loudness master spec — Spotify-aligned targets for Skipper audio

**Status:** LOCKED 2026-06-25 (founder): the narration master is **PROD-natural**, a researched spoken-word
chain that REPLACED the old single heavy `alimiter`. Order: **corrective EQ (high-pass 90 + 300 Hz mud cut)
→ light denoise (`afftdn nr=6`) → noise gate → gentle compression (4:1) → single-pass loudnorm I=−14**. It
LANDS **~−15.6 LUFS (median) / max −1.2 dBTP** at 64k AAC (10-clip validation) — in the −14…−16 spoken-word
window (AES TD1008 / Apple −16); we do NOT force a hotter target (that needs the squash). Shared with the **−14** music bed (`AUDIO_LOUDNESS` in
`@skipper/shared`): **11 LU range**, EBU R128, −1.0 dBTP delivery ceiling. The old `normal14`/`loud13` limiter
presets are RETIRED (history below). Chain lives in `loudnorm.ts` `masteringChain()`; tune + regen — see §1.

## The spec

The narration chain (`loudnorm.ts` `masteringChain()`, in order) + the music bed (`AUDIO_LOUDNESS`):

| Stage | Filter | Why |
|---|---|---|
| 1. De-bass (sub) | `highpass=f=90` | drop rumble/proximity boom the deep voice doesn't use |
| 2. De-bass (mud) | `equalizer=f=300:t=q:w=1.0:g=-3` | scoop 200–400 Hz so the voice cuts through (the "quiet" fix) |
| 3. Denoise | `afftdn=nr=6` | LIGHT — nr=12 smeared ("underwater"); de-bass uncovers the TTS hiss |
| 4. Gate | `agate=threshold=0.004:…:range=0.003` | silence the lead-in/gaps ("static at the start") |
| 5. Compress | `acompressor=threshold=-22dB:ratio=4:…` | gentle density, NOT a brute-limit squash |
| 6. Loudnorm | `loudnorm=I=-14:TP=-3.0:LRA=11` | EBU R128; its internal TP limiter is the final peak guard |

Asks loudnorm for −14, **lands ~−15.6 LUFS median / max −1.2 dBTP decoded** (gentle compression doesn't crush
crest enough to reach −14 on the peak-bound source — and that's correct per the research). 64k AAC, **TP=−3.0**
pre-encode for the peaky-take AAC overshoot (see History 2026-06-26). The QA meter judges against the
**landing** (`ACTIVE_MASTER_TARGET_LUFS = −15.6`, ±1.2 LU), not the asked-for −14.
Music bed target lives in `AUDIO_LOUDNESS`; the voice chain + landing in `loudnorm.ts`.

## Where it applies

1. **Studio TTS narration.** Every shipped take is mastered by `masteringChain()` in
   `packages/studio/src/pipeline/loudnorm.ts` — the 6-stage PROD-natural chain above (EQ → denoise → gate →
   gentle compression → single-pass `loudnorm`), fused with the single AAC encode. Each stage's parameters
   live as their own constant in `loudnorm.ts` (only the LRA is shared from `AUDIO_LOUDNESS`). Edge-case
   safety (full-scale peaks, silence, ultra-short, DC, a real take) is pinned by the standalone
   `test-mastering-chain.ts` harness — run it before any chain tweak. Applies on the next (re)synthesis —
   existing clips re-master on regen.

2. **Bundled drive-music rotation → −14.** The 17 tracks in `apps/mobile/assets/audio/*.mp3`
   (`src/lib/driveMusic.ts`) are mastered OFFLINE to `AUDIO_LOUDNESS` (−14 / −1.0) — a one-time ffmpeg
   re-encode, NOT a runtime path. Recipe + per-track sources/licenses: `apps/mobile/assets/audio/SOURCE.md`.

The voice lands ~−14.9 — numerically ~1 dB under the −14 bed, but speech reads ~2–3 dB louder than music at
equal LUFS (AES TD1008), so the Skipper still sits ON TOP perceptually; and the bed ducks to SILENCE under a
narration anyway (it doesn't play under the voice), so the relationship only shows when music swells back
after a clip. Verify on the on-device A/B (Open).

## Post-encode verification (the QA meter)

The target used to be **asserted by construction and never read back** — the −14.7…−15.5 undershoot spread
and the +1.4/+2.4 dBTP overshoot were both found BY HAND. `verifyMasteredLoudness` (`loudnorm.ts`) now
re-decodes every shipped `.m4a` with `ffmpeg ebur128=peak=true` and checks the measured integrated loudness
(within ±1.2 LU of the **landing** `ACTIVE_MASTER_TARGET_LUFS` = −15.6, not the asked-for −14) + the
**decoded-AAC true peak** (the inter-sample overshoot the
pre-encode PCM ceiling is blind to) against the −1.0 dBTP delivery ceiling. **ADVISORY (mark-and-flag):** an
off-spec clip fails its `tts` eval row for the human-review pass (`applyLoudnessOutcomes`) but is **never
withheld** — promote to fail-closed only after the gate has run a corpus clean. Pairs with the best-of-3
tail-collapse retake + the 4 s last-words probe (`tts.ts`/`tail.ts`).

## History

- Narration shipped at −14 LUFS / **−1.5 dBTP** 2026-06-11 (the loudnorm mechanism;
  `audio-compression-spike.md`).
- **2026-06-19 — TP ceiling raised −1.5 → −1.0.** Founder feedback "still a bit too quiet"; a measured
  clip read −14.9 LUFS because the −1.5 ceiling bound (peaks already −0.77 dBTP post-AAC) and the
  linear gain undershot −14. −1.0 recovers the headroom so loudnorm reaches the target.
- **2026-06-19 — drive music matched to −14 / −1.0.** Previously the 16 added tracks were at ~−13
  (with `drive_loop.mp3` left un-normalized at ~−15) — ~1 dB louder than the voice and uneven. Re-mastered
  the full rotation to the spec (192 kbps stereo MP3, metadata stripped); the level spread (−11.7 … −15.0)
  collapsed to a uniform ≈−14.
- **2026-06-19 — spec centralized** into `AUDIO_LOUDNESS` (`@skipper/shared`) so narration and music
  reference one definition instead of scattered magic numbers (founder: "make sure these are defined
  somewhere for future").
- **2026-06-20 — peak-limiter master (the louder/cleaner fix), after a false start.** A first attempt
  (an `acompressor` BEFORE the two-pass linear loudnorm) shipped + was reverted same day: a stateful
  filter breaks the two-pass "measured == gained" assumption, so the TP limit hit the wrong peaks and
  the 48 kbps AAC overshot to **+2.4 dBTP (clipping)** while still landing ~−15. Root-caused on REAL raw
  TTS (the first attempt was mis-validated on already-mastered clips): Gemini TTS is **peak-bound** — it
  crests at ~0 dBFS, so a plain loudnorm can't gain up and undershoots −14 inconsistently (−14.7…−15.5).
  Fix = the broadcast move done right: a true-peak `alimiter` makes the headroom, then a **single-pass**
  dynamic loudnorm hits −14 (no measure/apply gap), with a **−2 dBTP pre-encode ceiling** for AAC
  overshoot. Validated on 3 clips → consistent ~−14.1…−14.5, clean peaks, LRA cost ~1 LU. (This is
  exactly Spotify Loud's mechanism — gain + limiter.) `LOUDNORM_TRUE_PEAK_DB` retired: the master owns
  its pre-encode TP now.
- **2026-06-20 — pushed narration to −13 (louder), bitrate 48k→64k.** Founder "push to −13". −13 isn't a
  free target bump (peak-bound), so it took MORE limiter gain (`LIMITER_INPUT_GAIN` 3→6) + a deeper −3
  pre-encode ceiling. The canary caught two things the default-style validation missed: the register-
  varied resynth voice is ~1.8 dB PEAKIER than a default-style synth (so validate on the real resynth
  path, not standalone), and at 48k AAC one clip (US-395) overshot to **+1.4 dBTP (clipping)** while 5
  others were clean — 48k's overshoot is the wall. Raised AAC 48k→64k (overshoot −3 dB → US-395 −1.58) and
  resynthed all 6: consistent −13.0…−13.4, clean −1.6…−2.1. `LOUDNORM_TARGET_LUFS` retired (narration owns
  its −13 in `loudnorm.ts`; `AUDIO_LOUDNESS` −14 now governs only the music bed).
- **2026-06-20 — reverted ACTIVE preset to −14, parked −13.** Founder: keep −13's tuning but ship −14 for
  now. Refactored the two recipes into `MASTERS` presets in `loudnorm.ts` (`normal14` ACTIVE, `loud13`
  OFF) so neither is lost — flipping is one `MASTER =` line + a regen. The 6 Reno clips were resynthed
  back to −14. `loud13` stays fully validated, ready when wanted.
- **2026-06-20 — full-corpus resynth → `normal14` RE-TUNED to loud13's peak discipline.** Ran the new
  limiter master across the whole corpus (306 off-spec clips → `resynth-narration --include-ids`; corpus
  defects fell 306→98). A read-only `audit-loudness.ts` sweep then proved the original GENTLE `normal14`
  (gain 3 / ceiling 0.794 / TP −2 / 48k) **ran hot**: single-pass dynamic loudnorm doesn't hard-cap
  true-peak, so peaky register-varied (town/landscape) takes overshot — **41/460 clipped, worst +4.7 dBTP**
  (worse than un-mastered). The original gentle params had been validated only on 3 story-register clips,
  missing the peakier registers. Fix = give `normal14` loud13's headroom at the −14 target (gain 3→6,
  ceiling 0.794→0.707, TP −2→−3, 48k→64k). 64k ≈ +33% download size — justified by the clipping data.
  Validated on the 12 worst clippers, then the master-fixable residual was re-resynthed.

- **2026-06-21 — the tail retake is structural-collapse-aware.** The best-of-N retake fired up to
  `RETAKE_LIMIT` extra PAID synths on every collapsed take — including the ~16 STRUCTURAL West-Shore codas,
  where the script cues a soft landing so a fresh take re-collapses at the same level and the extra synths
  can't escape it. `retakeStalled` (`tail.ts`, pure + tested) now stops the loop once a retake re-collapses
  within `STRUCTURAL_RETAKE_EPSILON_DB` (1 dB) of the prior best; the STOCHASTIC Dam-class catch (a fresh
  take comes back clean and exits via the loop's own gate) is untouched, as is the advisory
  `TAIL_COLLAPSE_DB`=3 audit/flag threshold. Code-only, no regen — applies on the next (re)synthesis. A
  separate paid-retake THRESHOLD split (decouple the audit flag from the retake trigger) is deferred to the
  founder ear-pass, which must set the number — drop-dB anti-correlates with defect-suspicion (the candidate
  swallowed-clause clips drop LESS than the clear keep-buttons), so a blind raise would protect the wrong
  clips.

- **2026-06-25 — PROD-natural chain, replacing the single heavy limiter (founder dogfood + cited research).**
  A real-drive listen surfaced "too quiet / too bass-y", then "static at the start" + "underwater" as fixes
  were tried. Root causes, each pinned on a fresh REAL TTS take (the proxy of re-mastering shipped 64k clips
  lied — a double AAC encode adds its own crackle): (a) the deep Charon voice has untamed low-mid mud and a
  faint HF noise floor; (b) a naive +2 dB presence boost AMPLIFIED that noise floor into audible static; (c)
  the de-bass high-pass then UNCOVERED the hiss (the low end had masked it); (d) `afftdn nr=12` removed it but
  SMEARED the voice ("underwater"); (e) pushing loudness to −11 squashed it. A cited deep-research pass
  (AES TD1008, Apple/Auphonic, the loudnorm author) reframed the loudness goal: **−14 already exceeds the
  spoken-word ceiling** ("never louder than −16 for speech"), and speech reads ~2–3 dB louder than music at
  equal LUFS — so "quiet" is a CLARITY problem (fix with EQ + gentle compression), not a level one. Final
  chain (founder A/B-picked, the **HYB-1** hiss treatment): high-pass 90 → −3 dB @ 300 Hz → `afftdn nr=6`
  (light) → `agate` → `acompressor` 4:1 → single-pass `loudnorm` I=−14, in the researched order (corrective
  EQ → cleanup → dynamics → loudness). Lands ~−14.9 / −1.3 dBTP at 64k. The old `alimiter` `MASTERS`
  (`normal14`/`loud13`) are retired; the QA landing constant moved −14 → −14.8 (±1 → ±1.2). New
  `test-mastering-chain.ts` edge-case harness (7 cases, all green). **Validated on ONE clip (Red Dog Saloon);
  the full-corpus resynth is the next paid step — audit-loudness the result + re-confirm the −14.8 landing.**

- **2026-06-26 — pre-encode TP −2.0 → −3.0 after the 10-clip validation; landing −14.8 → −15.6.** A 10-clip
  batch (duration-spread; registers town/landscape/civic/story) through the REAL resynth path exposed the
  historical peaky-clip overshoot the single Red Dog test missed: at TP=−2.0, 64k AAC overshot to
  **−0.6/−0.9 dBTP on the town/landscape takes** (Climate Center, Barnard) — over the −1.0 ceiling. Deepened
  the pre-encode ceiling −2.0 → −3.0 (the gentle no-limiter chain has no brick-wall, so headroom is the only
  lever; a louder target would need the squash). Re-validated: **max −1.2 dBTP, 0 over ceiling, 0 clipping** —
  fixed. Cost: loudness median **−15.6** (p5/p95 −16.5/−15.0), ~0.7 LU under the −2.0 trial — sub-JND, still
  spoken-word band. `ACTIVE_MASTER_TARGET_LUFS` −14.8 → −15.6. (Aside: 3 of 10 tail-collapsed — Red Dog /
  Galaxy / Mount Rose Summit — the structural deadpan coda, NOT a master defect; flagged for the ear-pass.)

- **2026-06-26 — full-corpus resynth DONE.** Ran `resynth-narration.ts --all --apply` over the whole live
  corpus (459/460, ~$18.26; the new `--all` flag — a full-table load, not a 460-id IN clause neon-http can't
  carry). Audit: **median −15.7** (p5/p95 −16.5/−15.1), confirming `ACTIVE_MASTER_TARGET_LUFS` −15.6. A small
  cleanup resynth fixed the genuine defects: 1 transient TTS-400 failure + **3 clips that overshot to
  +0.4…+1.9 dBTP** (the peaky distribution tail; fresh takes landed ≤ −1.3) + 1 take that **rambled to 196 s**
  (→ 81 s). Corpus is now consistent on PROD-natural.

## Open

- **Tail-collapse (41 clips, ~9%) — the deadpan/somber endings.** The TTS style prompt CANNOT fix it (tested
  2026-06-26: a sharper anti-fade tweak left Galaxy/Red Dog still collapsed at 7–18 dB — the model reads the
  closing CONTENT's somber/wry tone as low volume, and no delivery instruction overrides it). The only lever
  is the NARRATION prompt's ending style (firmer closing beats) — a charm trade, tonally wrong for somber
  stops, so a separate project. Mostly intended; the per-clip ear-pass splits a swallowed line from a dry button.
- **Overlong-take guard — DONE 2026-06-26.** `synthesizeNotOverlong` (`tts.ts`) re-rolls any take longer than
  `OVERLONG_RATIO` (1.5×) its script's word-count estimate, keeping the shortest — closing the gap where a 2×
  ramble shipped unflagged (best-of-N only retook on tail-collapse). Calibrated from the corpus (legit max
  1.32×, rambles alone at ~2.1×); re-rolled both live rambles (Nevada Museum of Art 196→81s, Mount Tallac
  126→62s — the guard fired in production on the latter).
- **Tail-collapse flag RELAXED 3 → 4 dB (2026-06-26).** At 3 dB the full-corpus audit flagged 41 clips,
  mostly the Skipper's intended dry/deadpan landings (a somber close like Galaxy measures ~5 dB and is
  correct); 4 dB → 18. `TAIL_COLLAPSE_DB` drives BOTH the audit flag and the synth retake trigger, so this
  also stops wasting paid retakes on mild structural drops. The genuine-defect subset (a swallowed clause vs
  a dry coda) still awaits a founder in-car ear-pass; the per-clip fix or a flag/retake-threshold split is
  gated on it. The `retakeStalled` early-out (skip futile retakes once a fresh take re-collapses within 1 dB)
  is unchanged.
- **On-device A/B vs Spotify** of the PROD-natural voice + bed on the real drive.
- **Louder?** Don't chase a hotter integrated target — the research is explicit that −14.9 already sits at
  the loud end of the spoken-word range, and forcing −14/−13/−11 means heavy limiting (the squash). For more
  voice-over-bed separation, drop the *bed* instead. The lever for "clearer/more present" is the EQ (mud cut),
  not level.
- **Drive-music bed** stays plain offline loudnorm at −14 / −1.0 (pre-mastered, low-overshoot MP3 — no
  limiter needed).
