# Audio compression spike — get clips off uncompressed WAV

**Status:** spike / recommendation (not yet implemented). 2026-06-08.
**Owner decision needed:** one ear test (see §6) before locking the format.

## 1. Why

TTS clips are stored as **uncompressed LINEAR16 WAV** (24 kHz / 16-bit / mono =
384 kbps ≈ 48 KB/s). A 2-minute story clip is ~5.8 MB. That single fact is the root
cause behind the two highest QA findings on the preview player:

- Clips are slow to buffer on weak signal → the stall-watchdog skips narration (the
  product *is* the narration). _(QA #1)_
- The future "download the whole tour before driving" (offline-first for Tahoe dead
  zones, per CLAUDE.md) would pull tens of MB of WAV. _(amplifies the M1 in-car bet)_

The encoding was always meant to be revisited — `models.ts` says so verbatim:

> LINEAR16 … MP3 / OGG_OPUS would be ~10x smaller but their duration is not
> byte-linear — a later size optimization, not an M1 concern.

This spike resolves that "later." It does **not** change the player or API — they
consume a presigned URL + a duration; the codec is invisible to them.

## 2. Authoritative facts (grounded in docs, per CLAUDE.md — re-verify before acting)

- **Gemini-TTS (`gemini-2.5-pro-tts`) unary `text:synthesize` can emit compressed
  audio directly.** Supported encodings (unary): **LINEAR16, ALAW, MULAW, MP3,
  OGG_OPUS, PCM**. (Streaming is narrower — PCM/ALAW/MULAW/OGG_OPUS, no MP3 — but we
  use unary, so MP3 is available to us.)
  Source: https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
- **MP3 from Cloud TTS is fixed at "MP3 audio at 32kbps"** (no bitrate knob).
  **OGG_OPUS** is "Opus … wrapped in an ogg container … can be played natively on
  Android, and in browsers" — pointedly **not iOS**.
  Source: https://docs.cloud.google.com/text-to-speech/docs/reference/rest/Shared.Types/AudioEncoding
- **iOS playback:** AVPlayer (which `expo-audio` uses) does **not** decode Opus/Ogg —
  it raises AVFoundation error `-11828` "media format not supported." It plays **MP3
  and AAC** reliably. → **OGG_OPUS is disqualified for the phone player**, despite
  being the smallest.
  Source: Apple Developer Forums thread 128011; Expo Audio SDK docs.
- Cloud TTS returns **no duration field** in the response (the reason LINEAR16 was
  chosen — duration was derived from byte length, exact because PCM is byte-linear).
  Any compressed format must recover duration another way (§5).

## 3. Measured PoC (local `ffmpeg` 8.1.1, 60.0s @ 24 kHz/16-bit/mono — the `GEMINI_PCM` profile)

| Format | Size | vs WAV | iOS plays? | Notes |
|---|---:|---:|:--:|---|
| LINEAR16 WAV (today) | 2.88 MB | 1.0× | ✓ | byte-linear duration |
| **MP3 32k (Gemini direct)** | **240 KB** | **11.9×** | ✓ | one API call; 32k is the floor |
| AAC 48k (local transcode) | 368 KB | 7.8× | ✓ | needs ffmpeg; better quality |
| AAC 32k (local transcode) | 248 KB | 11.6× | ✓ | ~MP3-32k size, better quality |
| OGG_OPUS 24k | 151 KB | 19× | ✗ | best size, **iOS can't play** |

**Duration recoverability (MP3-32k):** byte-linear CBR estimate `bytes*8/32000` =
**60.107s** vs true **60.0s** → **±0.18%** (~107 ms over 60s; ~210 ms over a 2-min
clip), the small constant being LAME's Xing/Info header + encoder padding. Exact
duration is available by summing MP3 frame durations (pure-code parse, §5).

> Real speech compresses slightly *better* than the pink-noise stress proxy used
> here, so these ratios are conservative. Absolute quality must still be judged by
> ear on the real Algenib voice (§6) — creds weren't available in the spike env.

## 4. Options & recommendation

Three live options after disqualifying Opus (iOS) and the raw status quo:

**A. MP3-direct (32 kbps) — `audioEncoding: 'MP3'`. ← recommended default.**
- + One API call; **zero new infrastructure / no ffmpeg dependency**; no env to add to CI.
- + Universal playback (iOS + Android).
- + **~12× smaller** — directly fixes QA #1/#2 and shrinks the offline download.
- − 32 kbps is the only bitrate Cloud TTS offers; it's the quality *floor*. For a
  gravelly, low-and-slow spoken delivery this is usually fine, but it must be
  ear-checked (§6) — the persona is the product.
- − Duration needs an MP3 frame-parser (replaces the PCM byte trick).

**B. LINEAR16 → local AAC (.m4a/.aac) transcode @ ~48 kbps — quality fallback.**
- + **Exact duration unchanged** — keep requesting LINEAR16 and the existing,
  unit-tested `toWavWithDuration`; transcode *after* measuring. Lowest risk to the
  "ready-gate needs a real duration" invariant.
- + Free codec/bitrate choice; **AAC@32k ≈ MP3@32k in size but clearly better
  quality**, or AAC@48k for a quality cushion at 7.8×.
- − Adds **ffmpeg as an environmental dependency** of the generator (an offline
  builder batch tool — acceptable, but document it; any machine/CI that generates
  needs it). ffmpeg→.m4a can't stream to a pipe (mp4 needs seek) → temp file, or
  emit ADTS `.aac` which is pipe-friendly and iOS-playable.

**C. OGG_OPUS — rejected.** 19× and a clean Ogg-granule duration parse, but **iOS
AVPlayer can't play it.** Revisit only if a tour ever targets Android/web *only*.

**Recommendation:** ship **A (MP3-direct)** — it's the smallest blast radius, kills
the QA bugs immediately, and needs no new infra. **Gate the lock on one ear test:**
synth a canonical clip as 32k MP3 vs a locally-transcoded AAC@48k and listen. If 32k
MP3 audibly dulls the deadpan, switch to **B** (ffmpeg is already on the builder
machine). The player/API are codec-agnostic either way, so A↔B is a generator-only
swap.

## 5. Duration strategy (the only real engineering in option A)

Replace the PCM byte-length derivation with an **MP3 frame-sum parser** in the
generator (pure code, no deps — mirrors the existing `wav.ts` parser style; add a new
`pipeline/mp3.ts` + `mp3.test.ts`):

- Walk MP3 frames from the sync word `0xFFE`; read the MPEG version + bitrate +
  sample-rate bits per frame header; samples-per-frame is fixed by version/layer
  (MPEG-2 @ 24 kHz Layer III = 576 samples/frame). `duration = Σ(samplesPerFrame /
  sampleRate)`. Exact to sub-frame; robust to the leading Xing/Info header (skip it)
  and to CBR/VBR alike.
- Keep a cheap byte-linear cross-check (`bytes*8/32000`) as a unit-test assertion
  (±1% tolerance) so a parser regression is caught.
- Validate once against ground truth: synth a clip, compare the parser to `ffprobe
  -show_entries format=duration`. (Spike showed the byte-linear proxy at ±0.18%;
  frame-sum will be tighter.)

`audioDurationMs` flows unchanged into `upsertPoiContent` → the ready-gate, the
preview timeline, the signed-clip `durationMs`, and trigger lead-time. Accuracy bar:
within a few tens of ms — both methods clear it.

## 6. Open decision — the ear test (blocks the lock)

The persona's voice is the product and the Algenib delivery is **founder-blessed**
(`models.ts` `SKIPPER_TTS_STYLE_PROMPT`, the read in canonical preview `9813e519`).
32 kbps MP3 is the bitrate floor. **Before committing, synth one or two canonical
clips and judge by ear: 32k MP3 (option A) vs locally-transcoded AAC@48k (option B).**
If A holds up → ship A. If it dulls the low-and-slow read → ship B. This needs GCP
ADC creds (absent in the spike env), so it's the builder's call.

## 7. Implementation plan (option A) & blast radius

Generator-only; **no mobile/API code change** (they take a URL + duration; expo-audio
plays MP3 by content-type/extension).

- `models.ts`: `TTS_AUDIO_ENCODING 'LINEAR16'→'MP3'`, `TTS_AUDIO_CONTENT_TYPE
  'audio/wav'→'audio/mpeg'`, `TTS_CLIP_EXTENSION 'wav'→'mp3'`; revisit whether
  `sampleRateHertz` is still honored for MP3 (32k is fixed — may be ignored). Rewrite
  the §2 decision comment to record the new choice + this doc.
- `pipeline/tts.ts`: the response is now MP3 bytes (base64) — stop calling
  `toWavWithDuration`; call the new `mp3DurationMs(bytes)`. `SynthResult.audio` = MP3.
- `pipeline/mp3.ts` (new) + `mp3.test.ts`: the frame-sum parser (§5).
- `pipeline/storage.ts`: **already** says "Upload an MP3" and derives key/content-type
  from the constants → `clips/.../<poi>.mp3` + `audio/mpeg` come for free.
- `patch-clip.ts`: inherits the new format on re-synth — no change beyond the above.
- `wav.ts` + `wav.test.ts`: keep (still valid if option B / any LINEAR16 fallback);
  no longer on the hot path for A.

**Migration (one-time):**
- Re-synth every existing `poi_content` clip → new `.mp3` keys; `audioUrl` updates;
  `audioDurationMs` re-derived (should match within ms). Canonical preview `9813e519`
  is 10 clips — re-run the generator / `patch-clip` for them.
- Old `.wav` objects become orphaned in R2 (the key extension changed) → delete them
  after the re-synth verifies (`audioExists` on the new keys, then sweep the `.wav`).
- Per CLAUDE.md's M4 note: format/extension is **not** in the `poi_content` cache key
  (`(poi, persona, voice, joke_level)`), so a re-synth cleanly overwrites the row; no
  key change needed. Mind the same forward-only caution — verify on `isPreview=true`.

**Validation after switch:** (1) `mp3.test.ts` green + matches `ffprobe` on a real
clip; (2) re-synth the preview, confirm `audioDurationMs` ≈ prior WAV durations; (3)
play the preview end-to-end on an iOS device/sim — clips load faster, no stall-skips;
(4) spot-check total tour download size (~12× smaller).

## 8. PoC artifacts

Reproduced via local ffmpeg in `$CLAUDE_JOB_DIR/tmp` (ephemeral):
`anoisesrc d=60 r=24000 mono s16 → ref.wav`, then `libmp3lame -b:a 32k`,
`aac -b:a 48k/32k`, `libopus -b:a 24k`; sizes via `stat`, durations via `ffprobe`.
Numbers in §3.
